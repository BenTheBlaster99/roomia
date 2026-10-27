import { spawn } from 'node:child_process'
import { appendFile, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BLENDER, guardMemory, SCENE_SETUP_SCRIPT, withBlenderSlot } from './blender-render'
import { FINISH_ROUGHNESS } from './material-roles'
import { GPT_IMAGE_MODEL } from './openai-client'
import { loadSharp } from './load-sharp'
import { generatePhotoreal, IMAGE_QUALITY } from './photoreal'
import { blenderLighting, NEUTRAL_CAPTURE_LIGHT, type Lighting } from './render-lighting'
import { buildSceneRenderPrompt } from './scene-render-prompt'
import { lensHfov, type SceneCamera } from './scene-cameras'
import { listPhotos } from './scene-photos'
import { readCameras, readMaterialRoles, sceneDir, sourcePath } from './scene-store'

/**
 * The virtual tour of a scene: for every saved view, the Roomia photo (made by the normal photo
 * step) and a 360° panorama rendered by Blender from the same spot, plus a plan of the floor seen
 * from above with each viewpoint on it.
 */

const PYTHON = process.env.ROOMIA_PYTHON ?? 'python3'
/** Each cube face of a panorama; the stitched panorama is 4 faces wide. */
/** Pixels per cube face of the Blender 360° (ROOMIA_TOUR_FACE_SIZE for test runs only). */
const FACE_SIZE = Number(process.env.ROOMIA_TOUR_FACE_SIZE ?? 1024)
const PANO_WIDTH = 4096
const PLAN_SIZE = 1800
/** The panoramas are not touched by the AI, so they carry their own light: late afternoon sun and the room's lights on. */
const TOUR_LIGHTING: Lighting = { time: 'apres-midi', sun: true, interior: true }

export const tourDir = (sceneId: string) => path.join(sceneDir(sceneId), 'tour')
const statusPath = (sceneId: string) => path.join(tourDir(sceneId), 'status.json')
const tourPath = (sceneId: string) => path.join(tourDir(sceneId), 'tour.json')

/** Files the tour route may serve. */
export const TOUR_FILE = /^(pano-\d{1,3}(-ai(-[a-z0-9]{1,12})?)?\.jpg|plan(-hd(-traits)?)?\.png)$/

export interface TourViewPoint {
  index: number
  name: string
  /** Panorama file in the tour folder, or null when that view's faces failed. */
  pano: string | null
  /** Position on the plan, in plan pixels, and the direction the saved view looks (degrees, clockwise from right). */
  plan: { x: number; y: number; angle: number } | null
  /** The camera stands outside the building (a SketchUp scene that hid a wall): left out of the tour. */
  outside?: boolean
  /** The saved view looks at a wall a metre away (same cause): its photo is left out, the 360° stays. */
  facesWall?: boolean
  /** The same 360° made photoreal by the image model (pano-N-ai.jpg), when it has been ordered. */
  panoAi?: string | null
  /** A person has checked the AI 360° against the Blender one; until then clients see the Blender one. */
  panoAiApproved?: boolean
  /** The AI 360° was made from an older version of the file: kept for the reviewer, hidden from clients until approved again. */
  panoAiStale?: boolean
  /** A point Roomia placed itself (not one of the designer's saved views): its position and starting direction, glTF frame. */
  auto?: boolean
  /** An automatic point's identity across rebuilds (its name is renumbered at each build, this stays). */
  id?: string
  position?: [number, number, number]
  target?: [number, number, number]
  /** Removed from the tour by the operator. */
  hidden?: boolean
  /** Where the 360° starts, set by the operator (radians from the panorama's centre, + = right). */
  startYaw?: number
}

export interface TourBuild {
  builtAt: string
  seconds: number
  /** The file's modification time when the panoramas were made: AI panoramas of an older version are dropped. */
  sourceMtime?: number
  /** Images bought from the image service for AI panoramas, all builds together. */
  aiImages?: number
  /** hd: the same plan twice as large, for download. */
  plan: { file: string; hd?: string; lines?: string; width: number; height: number } | null
  views: TourViewPoint[]
  /** Pairs of viewpoints that can see each other at eye height: the arrows inside the 360°. */
  links?: [number, number][]
  /** Seconds spent in each stage of the last build (waiting for the GPU, opening the file, plan, placement, faces, stitching). */
  timings?: Record<string, number>
}

export interface TourStatus {
  state: 'idle' | 'building' | 'done' | 'failed'
  step?: string
  done?: number
  total?: number
  error?: string
  startedAt?: string
  pid?: number
  /** 'ai' while photo-quality 360° views are being made; otherwise the tour itself is being built. */
  kind?: 'ai'
}

/** The Blender script of a tour (exported for test runs of the placement). */
export const TOUR_SCRIPT =
  SCENE_SETUP_SCRIPT +
  String.raw`
import os, time
import numpy as np
M = Matrix(((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0)))
print("TOUR_TIME scene_ready", flush=True)

def to_blender(p):
    # glTF Y-up to Blender Z-up: (x, y, z) -> (x, -z, y)
    return Vector((p[0], -p[2], p[1]))

scene = bpy.context.scene
views = spec["views"]
out_dir = spec["outDir"]
FACE = int(spec["faceSize"])

cam_data = bpy.data.cameras.new("roomia_view")
cam_data.clip_start = 0.05
cam_data.clip_end = 200.0
cam = bpy.data.objects.new("roomia_view", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam

# Floor and ceiling under the viewpoints: the plan is cut between them, like an architect's plan.
depsgraph = bpy.context.evaluated_depsgraph_get()
def is_glass(obj, index):
    try:
        mat = obj.material_slots[obj.data.polygons[index].material_index].material
    except Exception:
        return False
    if mat is None or not mat.use_nodes:
        return False
    b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    return b is not None and (b.inputs["Transmission Weight"].default_value > 0.5 or b.inputs["Alpha"].default_value < 0.6)

def ray(origin, direction):
    # Windows and glass doors are seen through, not walls (a bathroom window 19 cm from the eye, 24 Oct).
    d, o = Vector(direction).normalized(), Vector(origin)
    for _ in range(6):
        hit, loc, normal, index, obj, _m = scene.ray_cast(depsgraph, o, d)
        if not hit:
            return None
        if not is_glass(obj, index):
            return loc
        o = loc + d * 0.01
    return None
def ray_n(origin, direction):
    # Like ray(), with the surface's normal.
    d, o = Vector(direction).normalized(), Vector(origin)
    for _ in range(6):
        hit, loc, normal, index, obj, _m = scene.ray_cast(depsgraph, o, d)
        if not hit:
            return None, None
        if not is_glass(obj, index):
            return loc, normal
        o = loc + d * 0.01
    return None, None
eyes = [to_blender(v["position"]) for v in views]
floors = sorted(h.z for h in (ray(e, (0, 0, -1)) for e in eyes) if h is not None)
ceils = sorted(h.z for h in (ray(e, (0, 0, 1)) for e in eyes) if h is not None)
eye_z = sorted(e.z for e in eyes)[len(eyes) // 2]
floor = floors[len(floors) // 2] if floors else eye_z - 1.5
ceil = ceils[len(ceils) // 2] if ceils else floor + 2.9
cut = min(ceil - 0.25, floor + 1.6)

# The plan covers the objects of this floor around the viewpoints.
cx = sum(e.x for e in eyes) / len(eyes)
cy = sum(e.y for e in eyes) / len(eyes)
lo = Vector((1e12, 1e12, 0.0))
hi = Vector((-1e12, -1e12, 0.0))
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    zmin, zmax = min(p.z for p in pts), max(p.z for p in pts)
    if zmax < floor + 0.05 or zmin > cut:
        continue
    for p in pts:
        if abs(p.x - cx) > 25 or abs(p.y - cy) > 25:
            continue
        lo.x, lo.y = min(lo.x, p.x), min(lo.y, p.y)
        hi.x, hi.y = max(hi.x, p.x), max(hi.y, p.y)
for e in eyes:
    lo.x, lo.y = min(lo.x, e.x - 1), min(lo.y, e.y - 1)
    hi.x, hi.y = max(hi.x, e.x + 1), max(hi.y, e.y + 1)
pad = 0.6
lo.x, lo.y, hi.x, hi.y = lo.x - pad, lo.y - pad, hi.x + pad, hi.y + pad

light = spec.get("lighting") or {}
world = bpy.data.worlds.new("roomia")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
wc = light.get("worldColor", [0.75, 0.75, 0.75])
bg.inputs[0].default_value = (wc[0], wc[1], wc[2], 1)
bg.inputs[1].default_value = light.get("worldStrength", 1.0)
energy = light.get("sunEnergy", 4.0)
if energy > 0:
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = energy
    sc = light.get("sunColor", [1, 1, 1])
    sun_data.color = (sc[0], sc[1], sc[2])
    sun = bpy.data.objects.new("sun", sun_data)
    bpy.context.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(90 - light.get("sunElevation", 38)), 0, math.radians(light.get("sunAzimuth", 35)))

scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.view_settings.view_transform = spec.get("viewTransform", "AgX")
# Light settings: 24 s per viewpoint instead of 4-5 min (24 Oct). The photo pipeline's sharp-mirror
# setup (a planar probe per mirror, full-resolution tracing) re-rendered the scene for every face.
scene.eevee.use_raytracing = True
scene.eevee.taa_render_samples = 16
rt = scene.eevee.ray_tracing_options
rt.resolution_scale = "2"
rt.use_denoise = True
scene.render.image_settings.file_format = "PNG"

FULL = spec.get("mode", "full") == "full"
if FULL:
    # 1. The plan's frame: an orthographic view at the cut height, looking straight down, north up (rendered in 3.).
    width, height = hi.x - lo.x, hi.y - lo.y
    if width >= height:
        plan_w, plan_h = int(spec["planSize"]), max(1, round(spec["planSize"] * height / width))
    else:
        plan_w, plan_h = max(1, round(spec["planSize"] * width / height)), int(spec["planSize"])

    def plan_xy(p):
        return ((p.x - lo.x) / width * plan_w, (hi.y - p.y) / height * plan_h)

    meta = {"plan": {"width": plan_w, "height": plan_h, "cut": cut, "floor": floor, "mpp": width / plan_w}, "views": []}
    for i, v in enumerate(views):
        e, t = eyes[i], to_blender(v["target"])
        x, y = plan_xy(e)
        tx, ty = plan_xy(t)
        # SketchUp scenes often hide a wall to look into a room; the export keeps the wall. A camera
        # with no ceiling above it is outside the building, one with a wall right in front sees only that wall.
        up = ray(e, (0, 0, 1))
        ahead = ray(e, (t - e).normalized())
        meta["views"].append({
            "index": i,
            "outside": up is None or up.z - e.z > 6,
            "facesWall": ahead is not None and (ahead - e).length < 1.2,
            "plan": {"x": x, "y": y, "angle": math.degrees(math.atan2(ty - y, tx - x))},
            # heading of the saved view in Blender's floor plane; the panorama is centred on it
            "yaw": math.atan2(t.y - e.y, t.x - e.x),
        })

    # 2. Automatic viewpoints, not limited to the designer's scenes (ChatGPT's walkable-grid plan, 24 Oct).
    # A 25 cm grid over the plan; a cell is a place a person can stand: the floor is the first thing
    # under 1.75 m (no table, bed or cupboard), there is a ceiling above, and nothing within 35 cm around
    # at three heights (no standing inside a wardrobe or against a wall).
    meta["auto"] = []
    meta["links"] = []
    all_eyes = list(eyes)
    if spec.get("autoViews"):
        import numpy as np
        from collections import deque
        STEP, CLEAR, EYE = 0.25, 0.35, 1.6
        CLEAR_NEAR = float(spec.get("clearNear", 0.30))
        def solid(o, d, maxd):
            hit, loc = scene.ray_cast(depsgraph, o, Vector(d), distance=maxd)[:2]
            return (loc - o).length if hit else None
        nx, ny = int((hi.x - lo.x) / STEP), int((hi.y - lo.y) / STEP)
        ok = np.zeros((ny, nx), bool)
        clear = np.zeros((ny, nx), np.float32)
        engine = spec.get("placementEngine", "bvh")
        t_grid = time.time()
        bvh = None
        if engine == "scene":
            # Reference algorithm (23-24 Oct): every check asks the whole scene, ~5,000 objects, per ray.
            dirs = [Vector((math.cos(a), math.sin(a), 0.0)) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
            for j in range(ny):
                for i in range(nx):
                    x, y = lo.x + (i + 0.5) * STEP, hi.y - (j + 0.5) * STEP
                    top = Vector((x, y, floor + 1.75))
                    down = solid(top, (0, 0, -1), 2.5)
                    if down is None or abs(top.z - down - floor) > 0.06:
                        continue
                    up = solid(Vector((x, y, floor + 0.1)), (0, 0, 1), 4.0)
                    if up is None or up < 2.0:
                        continue
                    m = 9.0
                    for hgt in (0.3, 1.0, 1.6):
                        o = Vector((x, y, floor + hgt))
                        for d in dirs:
                            dd = solid(o, d, 3.0)
                            if dd is not None:
                                m = min(m, dd)
                        if m < CLEAR:
                            break
                    if m >= CLEAR:
                        ok[j, i] = True
                        clear[j, i] = m
        else:
            # Fast version (25 Oct): one BVH tree holding only what a person walking can bump into (the
            # band between the floor and 1.8 m: walls, furniture, glass; not the floor, not the ceilings),
            # built once. "Nothing under 1.75 m" is one ray down through that band, and the clearance is
            # the exact distance to the nearest obstacle at three heights (rays could slip past thin legs).
            # The scene is asked only for the floor and the ceiling, on the cells that passed.
            from mathutils.bvhtree import BVHTree
            # Below 7 cm is walkable (rugs, thresholds): the reference accepted 6 cm, and a 2 cm limit made a
            # bedroom rug block the whole room (25 Oct).
            band_lo, band_hi = floor + 0.07, floor + 1.8
            verts, tris, offset, cache = [], [], 0, {}
            for ob in scene.objects:
                if ob.type != "MESH" or not ob.visible_get():
                    continue
                key = ob.data.name
                if key not in cache:
                    me = ob.data
                    me.calc_loop_triangles()
                    co = np.empty(len(me.vertices) * 3, np.float32)
                    me.vertices.foreach_get("co", co)
                    tri = np.empty(len(me.loop_triangles) * 3, np.int32)
                    me.loop_triangles.foreach_get("vertices", tri)
                    cache[key] = (co.reshape(-1, 3), tri.reshape(-1, 3))
                co, tri = cache[key]
                if len(tri) == 0:
                    continue
                mw = np.array(ob.matrix_world, np.float32)
                w = co @ mw[:3, :3].T + mw[:3, 3]
                z = w[:, 2][tri]
                xy = w[:, :2][tri]
                keep = (z.max(1) > band_lo) & (z.min(1) < band_hi) & (xy[:, :, 0].max(1) > lo.x) & (xy[:, :, 0].min(1) < hi.x) & (xy[:, :, 1].max(1) > lo.y) & (xy[:, :, 1].min(1) < hi.y)
                if not keep.any():
                    continue
                used = np.unique(tri[keep])
                remap = np.full(len(w), -1, np.int64)
                remap[used] = np.arange(len(used)) + offset
                verts.append(w[used])
                tris.append(remap[tri[keep]])
                offset += len(used)
            V = np.concatenate(verts) if verts else np.zeros((0, 3), np.float32)
            T = np.concatenate(tris) if tris else np.zeros((0, 3), np.int64)
            # Passing the arrays as they are: turning 5.7 million triangles into Python lists took the PC
            # to 14.4 of its 15 GB (25 Oct).
            del verts, tris, cache
            n_tris = len(T)
            bvh = BVHTree.FromPolygons(V, T, all_triangles=True)
            del V, T
            print("TOUR_INFO bvh %d triangles %.1fs" % (n_tris, time.time() - t_grid), flush=True)
            for j in range(ny):
                for i in range(nx):
                    x, y = lo.x + (i + 0.5) * STEP, hi.y - (j + 0.5) * STEP
                    # Something between the floor and 1.75 m right here (table, bed, cupboard, wall)?
                    if bvh.ray_cast(Vector((x, y, floor + 1.75)), Vector((0, 0, -1)), 1.7)[0] is not None:
                        continue
                    # The nearest-surface distance is the true distance (corners, chair legs), shorter than
                    # what 8 rays found: 0.30 m here keeps the same rooms valid as 0.35 m of rays.
                    m = 9.0
                    for hgt in (0.3, 1.0, 1.6):
                        near = bvh.find_nearest(Vector((x, y, floor + hgt)), 3.0)
                        if near[0] is not None:
                            m = min(m, near[3])
                        if m < CLEAR_NEAR:
                            break
                    if m < CLEAR_NEAR:
                        continue
                    down = solid(Vector((x, y, floor + 0.3)), (0, 0, -1), 0.6)
                    if down is None or abs(floor + 0.3 - down - floor) > 0.06:
                        continue
                    up = solid(Vector((x, y, floor + 0.1)), (0, 0, 1), 4.0)
                    if up is None or up < 2.0:
                        continue
                    ok[j, i] = True
                    clear[j, i] = m
        print("TOUR_INFO grid %s %d cells valid %.1fs" % (engine, int(ok.sum()), time.time() - t_grid), flush=True)
        # Spaces: groups of connected cells (closed doors separate rooms).
        label = -np.ones(ok.shape, int)
        spaces = []
        for j0, i0 in zip(*np.nonzero(ok)):
            if label[j0, i0] >= 0:
                continue
            label[j0, i0] = len(spaces)
            q, cells = deque([(j0, i0)]), []
            while q:
                j, i = q.popleft()
                cells.append((j, i))
                for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    jj, ii = j + dj, i + di
                    if 0 <= jj < ny and 0 <= ii < nx and ok[jj, ii] and label[jj, ii] < 0:
                        label[jj, ii] = len(spaces)
                        q.append((jj, ii))
            spaces.append(cells)
        # Points only where they add something (ChatGPT, 25 Oct): a 360° already shows a whole room, so a
        # normal room gets one point, or none when one of the designer's good views stands in it; a large
        # space gets points SPACING apart. The designer's views count as points already placed.
        SPACING = float(spec.get("autoSpacing", 2.8))
        SMALL_ROOM = float(spec.get("smallRoom", 18.0))
        inside_saved = [(k, eyes[k]) for k, v in enumerate(meta["views"]) if not v["outside"]]
        per_space = []
        MIN_AREA = float(spec.get("minArea", 0.4))
        print("TOUR_INFO spaces %s m2" % " ".join("%.2f" % (len(c) * STEP * STEP) for c in sorted(spaces, key=len, reverse=True)[:12]), flush=True)
        for cells in sorted(spaces, key=len, reverse=True):
            area = len(cells) * STEP * STEP
            if area < MIN_AREA:
                continue
            pts = np.array([[lo.x + (i + 0.5) * STEP, hi.y - (j + 0.5) * STEP] for j, i in cells])
            cl = np.array([clear[j, i] for j, i in cells])
            dmin = np.full(len(pts), 99.0)
            saved_here = False
            for k, e in inside_saved:
                d = np.hypot(pts[:, 0] - e.x, pts[:, 1] - e.y)
                dmin = np.minimum(dmin, d)
                # a view stands in for the room only from a spot a person could stand on (not from
                # inside a wardrobe or pressed against a wall next to the room)
                if d.min() < 0.6:
                    print("TOUR_INFO view %d %.2f m from a free cell" % (k, d.min()), flush=True)
                saved_here = saved_here or d.min() < 0.2
            chosen = []
            if area < SMALL_ROOM:
                if not saved_here:
                    chosen.append(int(np.argmax(np.minimum(cl, 1.5))))
            else:
                while True:
                    score = np.minimum(dmin, 4.0) + 0.3 * np.minimum(cl, 1.5)
                    k = int(np.argmax(score))
                    if dmin[k] < SPACING:
                        break
                    chosen.append(k)
                    dmin = np.minimum(dmin, np.hypot(pts[:, 0] - pts[k, 0], pts[:, 1] - pts[k, 1]))
            per_space.append(([(pts[k], cl[k]) for k in chosen], area))
        # A space under 2 m² is mostly a corner of a room cut off by furniture, already seen from that room's
        # point (Bloc B F5 went from 12 to 22 stops, 26 Oct); it keeps its point only when no other viewpoint
        # sees it, like a small bathroom behind its wall (Bloc B F2).
        lookouts = [e for _, e in inside_saved] + [Vector((float(p[0]), float(p[1]), floor + EYE)) for sp, area in per_space if area >= 2.0 for p, _ in sp]
        def seen(p):
            e = Vector((float(p[0]), float(p[1]), floor + EYE))
            for o in lookouts:
                d = (e - o).length
                if d < 0.3 or (d < 8.0 and solid(o, (e - o).normalized(), d) is None):
                    return True
            return False
        per_space = [sp for sp, area in per_space if area >= 2.0 or not any(seen(p) for p, _ in sp)]
        # Every space gets its first point before any space gets a second one, up to the cap.
        picked, rank = [], 0
        cap = int(spec.get("autoMax", 16))
        while len(picked) < cap and any(rank < len(sp) for sp in per_space):
            for sp in per_space:
                if rank < len(sp) and len(picked) < cap:
                    picked.append(sp[rank])
            rank += 1
        # The points of the previous build (ChatGPT, 25 Oct): each one is matched to at most one new point
        # within 0.5 m, nearest pairs first. With the same file, the new point takes the old one's exact place
        # and direction, so its name, edits and AI 360° stay valid, and an old point with an AI 360° stays
        # even when the placement no longer picks it. With a changed file the match only carries the identity.
        same = bool(spec.get("previousSame"))
        prev = []
        for p in spec.get("previousAuto", []):
            pe, pt_ = to_blender(p["position"]), to_blender(p["target"])
            prev.append((pe, math.atan2(pt_.y - pe.y, pt_.x - pe.x), bool(p.get("keep"))))
        pairs = sorted((math.hypot(pt[0] - pe.x, pt[1] - pe.y), n, j) for n, (pt, cl) in enumerate(picked) for j, (pe, _, _) in enumerate(prev))
        match, used = {}, set()
        for d, n, j in pairs:
            if d > 0.5:
                break
            if n not in match and j not in used:
                match[n] = j
                used.add(j)
        placed = []
        for n, (pt, cl) in enumerate(picked):
            j = match.get(n)
            if j is not None and same:
                placed.append((np.array([prev[j][0].x, prev[j][0].y]), cl, j, prev[j][1]))
            else:
                placed.append((pt, cl, j, None))
        if same:
            placed += [(np.array([pe.x, pe.y]), 0.0, j, yaw) for j, (pe, yaw, keep) in enumerate(prev) if keep and j not in used]
        # The apartment on the plan (27 Oct, Sarah's reference plans show the flat alone): the spaces that hold
        # a viewpoint, grown cell by cell through everything a person sees over at 1.3 m (beds, counters,
        # railings, glass doors) but not through walls, tall cupboards or closed doors. An empty flat next
        # door or the landing stays off the plan, and the plan is framed on what is left.
        if bvh is not None:
            def cell_of(x, y):
                return int((hi.y - y) / STEP), int((x - lo.x) / STEP)
            seeds = set()
            for p in [(e.x, e.y) for _, e in inside_saved] + [(float(pt[0]), float(pt[1])) for pt, _, _, _ in placed]:
                j0, i0 = cell_of(*p)
                near = [(abs(j - j0) + abs(i - i0), j, i) for j in range(j0 - 2, j0 + 3) for i in range(i0 - 2, i0 + 3) if 0 <= j < ny and 0 <= i < nx and label[j, i] >= 0]
                if near:
                    _, j, i = min(near)
                    seeds.add(int(label[j, i]))
            apt = np.isin(label, list(seeds))
            passable = {}
            def can_stand(j, i):
                if (j, i) not in passable:
                    x, y = lo.x + (i + 0.5) * STEP, hi.y - (j + 0.5) * STEP
                    low = bvh.ray_cast(Vector((x, y, floor + 1.75)), Vector((0, 0, -1)), 0.75)[0] is None
                    passable[(j, i)] = low and solid(Vector((x, y, floor + 0.95)), (0, 0, -1), 1.3) is not None
                return passable[(j, i)]
            q = deque(zip(*np.nonzero(apt)))
            while q:
                j, i = q.popleft()
                o = Vector((lo.x + (i + 0.5) * STEP, hi.y - (j + 0.5) * STEP, floor + 1.3))
                for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    jj, ii = j + dj, i + di
                    if not (0 <= jj < ny and 0 <= ii < nx) or apt[jj, ii] or not can_stand(jj, ii):
                        continue
                    d = Vector((di, -dj, 0.0))
                    if bvh.ray_cast(o, d, STEP)[0] is not None:
                        h = ray(o, d)
                        if h is not None and (h - o).length < STEP:
                            continue
                    apt[jj, ii] = True
                    q.append((jj, ii))
            np.save(os.path.join(out_dir, "plan-rooms.npy"), apt.astype(np.uint8))
            meta["plan"]["rooms"] = {"x0": lo.x, "y0": hi.y, "step": STEP}
            print("TOUR_INFO apartment %.1f m2 of %.1f walkable, %d spaces" % (apt.sum() * STEP * STEP, ok.sum() * STEP * STEP, len(seeds)), flush=True)
            if apt.any():
                jj, ii = np.nonzero(apt)
                pad = 1.0
                lo.x, hi.x = max(lo.x, lo.x + ii.min() * STEP - pad), min(hi.x, lo.x + (ii.max() + 1) * STEP + pad)
                lo.y, hi.y = max(lo.y, meta["plan"]["rooms"]["y0"] - (jj.max() + 1) * STEP - pad), min(hi.y, meta["plan"]["rooms"]["y0"] - jj.min() * STEP + pad)
                width, height = hi.x - lo.x, hi.y - lo.y
                if width >= height:
                    plan_w, plan_h = int(spec["planSize"]), max(1, round(spec["planSize"] * height / width))
                else:
                    plan_w, plan_h = max(1, round(spec["planSize"] * width / height)), int(spec["planSize"])
                meta["plan"].update({"width": plan_w, "height": plan_h, "mpp": width / plan_w})
                for i, v in enumerate(views):
                    x, y = plan_xy(eyes[i])
                    tx, ty = plan_xy(to_blender(v["target"]))
                    meta["views"][i]["plan"] = {"x": x, "y": y, "angle": math.degrees(math.atan2(ty - y, tx - x))}
        del bvh
        # Starting direction: the most open way at eye height (windows count as open).
        for n, (pt, cl, j, yaw) in enumerate(placed):
            e = Vector((float(pt[0]), float(pt[1]), floor + EYE))
            angles = np.linspace(0, 2 * math.pi, 24, endpoint=False)
            reach = []
            for a in angles:
                h = ray(e, (math.cos(a), math.sin(a), 0.0))
                reach.append(min(8.0, (h - e).length) if h is not None else 8.0)
            reach = np.array(reach)
            smooth = reach + 0.5 * (np.roll(reach, 1) + np.roll(reach, -1)) + 0.25 * (np.roll(reach, 2) + np.roll(reach, -2))
            a = float(angles[int(np.argmax(smooth))]) if yaw is None else yaw
            t = e + Vector((math.cos(a), math.sin(a), 0.0)) * 2.0
            x, y = plan_xy(e)
            tx, ty = plan_xy(t)
            index = len(views) + n
            meta["auto"].append({
                "index": index,
                "position": [e.x, e.z, -e.y],
                "target": [t.x, t.z, -t.y],
                "yaw": a,
                "clearance": float(cl),
                "previous": j,
                "plan": {"x": x, "y": y, "angle": math.degrees(math.atan2(ty - y, tx - x))},
            })
            all_eyes.append(e)
        print("TOUR_AUTO %d" % len(meta["auto"]), flush=True)
        print("TOUR_TIME placement", flush=True)
        # Arrows: two viewpoints are linked when one can see the other at eye height.
        points = [(k, eyes[k]) for k, v in enumerate(meta["views"]) if not v["outside"]] + [(a["index"], all_eyes[a["index"]]) for a in meta["auto"]]
        for x1 in range(len(points)):
            for x2 in range(x1 + 1, len(points)):
                (k1, e1), (k2, e2) = points[x1], points[x2]
                dist = (e2 - e1).length
                if dist > 8.0:
                    continue
                h = solid(e1, (e2 - e1).normalized(), dist)
                if h is None:
                    meta["links"].append([k1, k2])
    # 3. The plan, rendered last: the placement's BVH is freed by now, so the two never take memory together
    # (Bloc B F5 reached 12-13 GB of 16 with both, 26 Oct).
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(width, height)
    cam_data.clip_start = 0.01
    cam.matrix_world = Matrix.Translation(Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, cut)))
    scene.render.film_transparent = True
    # A clean architect's plan (ChatGPT, 26 Oct), from the geometry only: even light from straight above instead
    # of the afternoon sun, and nothing that starts above 1.2 m (ceilings, hanging lamps, wall cupboards).
    # The room lamps are off too: seen from above they burn white pools into the floor (27 Oct).
    # Rendered at twice the size for the download; the tour shows a reduced copy.
    hidden = []
    for ob in scene.objects:
        if ob.hide_render:
            continue
        if ob.type == "LIGHT" or (ob.type == "MESH" and min((ob.matrix_world @ Vector(c)).z for c in ob.bound_box) > floor + 1.2):
            ob.hide_render = True
            hidden.append(ob)
    if energy > 0:
        sun_energy = sun_data.energy
        sun_data.energy = 0
    world_light = (tuple(bg.inputs[0].default_value), bg.inputs[1].default_value)
    bg.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs[1].default_value = float(spec.get("planWorld", 0.5))
    top_data = bpy.data.lights.new("plan_top", "SUN")
    top_data.energy = float(spec.get("planSun", 1.5))
    top_data.angle = math.radians(25)
    top = bpy.data.objects.new("plan_top", top_data)
    bpy.context.collection.objects.link(top)
    PLAN_SCALE = float(spec.get("planScale", 2))
    scene.render.resolution_x, scene.render.resolution_y = round(plan_w * PLAN_SCALE), round(plan_h * PLAN_SCALE)
    scene.render.filepath = os.path.join(out_dir, "plan-hd.png")
    # One still image: full-resolution tracing and more samples cost only seconds here. Slightly darker than the
    # 360° views, since the finish below brightens it again (Bloc B F2, 27 Oct).
    face_look = (scene.eevee.taa_render_samples, rt.resolution_scale, scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure)
    scene.eevee.taa_render_samples = int(spec.get("planSamples", 64))
    rt.resolution_scale = "1"
    scene.view_settings.view_transform = spec.get("planView", scene.view_settings.view_transform)
    scene.view_settings.look = spec.get("planLook", "None")
    scene.view_settings.exposure = float(spec.get("planExposure", -0.25))
    # No reflections on the plan: with the ceilings hidden, a polished floor mirrors the white sky in patches
    # (Bloc B F2's marble, 27 Oct). Seen from above, every surface shows its own colour.
    shine = []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                for key in ("Specular IOR Level", "Coat Weight"):
                    inp = n.inputs.get(key)
                    if inp is not None and not inp.is_linked:
                        shine.append((inp, inp.default_value))
                        inp.default_value = 0.0
    bpy.ops.render.render(write_still=True)
    for inp, value in shine:
        inp.default_value = value
    scene.eevee.taa_render_samples, rt.resolution_scale, scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure = face_look
    meta["plan"]["frame"] = [lo.x, lo.y, hi.x, hi.y]
    # The walls and everything else the cut goes through, as exact lines (an architect's section): every triangle
    # that crosses the cut height gives one segment, in the pixels of the large plan. Drawn on it afterwards.
    segs = []
    for ob in scene.objects:
        if ob.type != "MESH" or not ob.visible_get():
            continue
        # quick reject: the object's box does not reach the cut
        zs = [(ob.matrix_world @ Vector(c)).z for c in ob.bound_box]
        if min(zs) > cut or max(zs) < cut:
            continue
        me = ob.data
        me.calc_loop_triangles()
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        tri = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("vertices", tri)
        co, tri = co.reshape(-1, 3), tri.reshape(-1, 3)
        if len(tri) == 0:
            continue
        mw = np.array(ob.matrix_world, np.float32)
        w = co @ mw[:3, :3].T + mw[:3, 3]
        t = w[tri]
        dz = t[:, :, 2] - (cut - 0.0007)
        cross = (dz.min(1) < 0) & (dz.max(1) > 0)
        if not cross.any():
            continue
        t, dz = t[cross], dz[cross]
        # a triangle standing over a metre tall is a wall, a door or a tall cupboard side, not furniture
        tall = (t[:, :, 2].max(1) - t[:, :, 2].min(1) >= 1.0).astype(np.float32)[:, None]
        pts = []
        for e0, e1 in ((0, 1), (1, 2), (2, 0)):
            a0, a1 = dz[:, e0], dz[:, e1]
            hit = (a0 * a1) < 0
            f = np.where(hit, a0 / np.where(hit, a0 - a1, 1), 0)[:, None]
            pts.append((t[:, e0, :2] + f * (t[:, e1, :2] - t[:, e0, :2]), hit))
        # each crossing triangle cuts exactly two of its edges
        first = np.where(pts[0][1][:, None], pts[0][0], pts[1][0])
        second = np.where(pts[2][1][:, None], pts[2][0], pts[1][0])
        segs.append(np.concatenate([first, second, tall], 1))
    S = np.concatenate(segs) if segs else np.zeros((0, 5), np.float32)
    sx, sy = plan_w * PLAN_SCALE / width, plan_h * PLAN_SCALE / height
    S = np.stack([(S[:, 0] - lo.x) * sx, (hi.y - S[:, 1]) * sy, (S[:, 2] - lo.x) * sx, (hi.y - S[:, 3]) * sy, S[:, 4]], 1).astype(np.float32)
    np.save(os.path.join(out_dir, "plan-lines.npy"), S)
    print("TOUR_INFO plan %d section segments" % len(S), flush=True)
    bpy.data.objects.remove(top)
    for ob in hidden:
        ob.hide_render = False
    if energy > 0:
        sun_data.energy = sun_energy
    bg.inputs[0].default_value, bg.inputs[1].default_value = world_light
    print("TOUR_STEP plan", flush=True)
    print("TOUR_TIME plan", flush=True)
    with open(os.path.join(out_dir, "tour-blender.json"), "w") as f:
        json.dump(meta, f)
    if spec.get("placementOnly"):
        print("TOUR_OK", flush=True)
        raise SystemExit(0)

# 2. The panoramas: from each viewpoint, six square 90° views (a cube), stitched afterwards.
scene.render.film_transparent = False
cam_data.type = "PERSP"
cam_data.sensor_fit = "VERTICAL"
cam_data.angle = math.radians(90.0)
cam_data.clip_start = 0.05

lo3 = Vector((1e12, 1e12, 1e12))
hi3 = Vector((-1e12, -1e12, -1e12))
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    for corner in ob.bound_box:
        w = ob.matrix_world @ Vector(corner)
        lo3 = Vector((min(lo3.x, w.x), min(lo3.y, w.y), min(lo3.z, w.z)))
        hi3 = Vector((max(hi3.x, w.x), max(hi3.y, w.y), max(hi3.z, w.z)))
radius = max(80.0, (hi3 - lo3).length * 1.5)
dome = None
if spec.get("outdoorSky"):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=64, ring_count=32, location=((lo3.x + hi3.x) / 2, (lo3.y + hi3.y) / 2, eye_z))
    dome = bpy.context.object
    dome.name = "roomia_sky"
    sky = bpy.data.materials.new("roomia_sky")
    sky.use_nodes = True
    nodes, links = sky.node_tree.nodes, sky.node_tree.links
    nodes.clear()
    coord, split, ramp = nodes.new("ShaderNodeTexCoord"), nodes.new("ShaderNodeSeparateXYZ"), nodes.new("ShaderNodeValToRGB")
    glow, out = nodes.new("ShaderNodeEmission"), nodes.new("ShaderNodeOutputMaterial")
    links.new(coord.outputs["Generated"], split.inputs[0])
    links.new(split.outputs["Z"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], glow.inputs["Color"])
    links.new(glow.outputs[0], out.inputs["Surface"])
    stops = ramp.color_ramp.elements
    stops[0].position, stops[0].color = 0.495, (0.40, 0.42, 0.36, 1)
    stops[1].position, stops[1].color = 0.505, (0.78, 0.85, 0.93, 1)
    top = stops.new(0.75)
    top.color = (0.42, 0.62, 0.92, 1)
    dome.data.materials.append(sky)
    dome.visible_shadow = False
    if hasattr(dome, "hide_probe_volume"):
        dome.hide_probe_volume = True
    cam_data.clip_end = max(cam_data.clip_end, radius * 2.5)

probe_data = bpy.data.lightprobes.new("roomia_probe", "SPHERE")
probe_data.influence_distance = 25.0
probe = bpy.data.objects.new("roomia_probe", probe_data)
bpy.context.collection.objects.link(probe)

FACES = [
    ("px", (1, 0, 0), (0, 0, 1)), ("nx", (-1, 0, 0), (0, 0, 1)),
    ("py", (0, 1, 0), (0, 0, 1)), ("ny", (0, -1, 0), (0, 0, 1)),
    ("pz", (0, 0, 1), (0, -1, 0)), ("nz", (0, 0, -1), (0, 1, 0)),
]

def aim(eye, forward, up):
    f, u = Vector(forward), Vector(up)
    r = f.cross(u).normalized()
    u2 = r.cross(f).normalized()
    m = Matrix((r, u2, -f)).transposed().to_4x4()
    m.translation = eye
    cam.matrix_world = m

scene.render.resolution_x = scene.render.resolution_y = FACE
skip = {v["index"] for v in meta["views"] if v["outside"]} if FULL else set()
if FULL and spec.get("faceMode", "animation") == "animation":
    # All the faces as the frames of one animation: a separate render per face makes Blender prepare
    # the whole scene again each time; an animation keeps it loaded and only moves the camera.
    frames = []
    for i, eye in enumerate(all_eyes):
        if i in skip:
            continue
        for name, forward, up in FACES:
            frames.append((i, name))
            f = len(frames)
            aim(eye, forward, up)
            cam.keyframe_insert("location", frame=f)
            cam.keyframe_insert("rotation_euler", frame=f)
            probe.location = eye
            probe.keyframe_insert("location", frame=f)
            if dome is not None:
                dome.location.z = eye.z
                dome.keyframe_insert("location", frame=f)
    for ob in (cam, probe, dome):
        if ob is not None and ob.animation_data and ob.animation_data.action:
            for fc in ob.animation_data.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "CONSTANT"
    def frame_written(sc, *args):
        i, name = frames[sc.frame_current - 1]
        print("TOUR_STEP face %d %s" % (i, name), flush=True)
    bpy.app.handlers.render_write.append(frame_written)
    scene.frame_start, scene.frame_end = 1, max(1, len(frames))
    scene.render.filepath = os.path.join(out_dir, "frame-")
    if frames:
        bpy.ops.render.render(animation=True)
    bpy.app.handlers.render_write.remove(frame_written)
    for f, (i, name) in enumerate(frames, 1):
        os.replace(os.path.join(out_dir, "frame-%04d.png" % f), os.path.join(out_dir, "face-%d-%s.png" % (i, name)))
for i, eye in enumerate(all_eyes if FULL and spec.get("faceMode", "animation") != "animation" else []):
    if i in skip:
        continue  # a camera outside the building is left out of the tour: no 360° for it
    aim(eye, (1, 0, 0), (0, 0, 1))
    probe.location = eye
    if dome is not None:
        dome.location.z = eye.z
    for name, forward, up in FACES:
        aim(eye, forward, up)
        scene.render.filepath = os.path.join(out_dir, "face-%d-%s.png" % (i, name))
        bpy.ops.render.render(write_still=True)
        print("TOUR_STEP face %d %s" % (i, name), flush=True)

# 3. Faces for the AI 360°: six views a little wider than 90° (they overlap, for blending), lit and
# coloured like the photo captures the image model is used to (neutral light, true colours).
AI_FOV = float(spec.get("aiFov", 100))
cap = spec.get("captureLighting")
if spec.get("aiViews") and cap:
    if energy > 0:
        sun_data.energy = cap["sunEnergy"]
        sun_data.color = tuple(cap["sunColor"])
        sun.rotation_euler = (math.radians(90 - cap["sunElevation"]), 0, math.radians(cap["sunAzimuth"]))
    bg.inputs[0].default_value = (*cap["worldColor"], 1)
    bg.inputs[1].default_value = cap["worldStrength"]
    scene.view_settings.view_transform = "Standard"
    # 16 samples, like the tour's own faces: the image model gave the same result from 16 as from 32, and the
    # captures take half the time (26 Oct test, living room and kitchen of Bloc B F2).
    scene.eevee.taa_render_samples = int(spec.get("aiSamples", 16))
    cam_data.angle = math.radians(AI_FOV)
    # Rendered as the frames of one animation, like the cube faces above (one render per face reloads the scene).
    ai_frames, ai_metas = [], []
    for i in spec["aiViews"]:
        eye = eyes[i]
        t = to_blender(views[i]["target"])
        fwd = Vector((t.x - eye.x, t.y - eye.y, 0)).normalized()
        right = fwd.cross(Vector((0, 0, 1))).normalized()
        probe.location = eye
        if dome is not None:
            dome.location.z = eye.z
        faces = [("front", fwd, Vector((0, 0, 1))), ("right", right, Vector((0, 0, 1))), ("back", -fwd, Vector((0, 0, 1))),
                 ("left", -right, Vector((0, 0, 1))), ("up", Vector((0, 0, 1)), -fwd), ("down", Vector((0, 0, -1)), fwd)]
        meta = {"fov": AI_FOV, "heading": list(fwd), "faces": []}
        for name, forward, up in faces:
            aim(eye, forward, up)
            # How far the face looks: 25 rays across it. A face that is mostly a wall or a cupboard
            # within a metre (a viewpoint inside a wardrobe, 24 Oct) gets no AI: the image model
            # turned two wardrobe panels into living rooms.
            right_dir = Vector(forward).cross(Vector(up)).normalized()
            up_dir = right_dir.cross(Vector(forward)).normalized()
            spread = math.tan(math.radians(AI_FOV / 2)) * 0.8
            dists = []
            for gx in (-1, -0.5, 0, 0.5, 1):
                for gy in (-1, -0.5, 0, 0.5, 1):
                    ray_dir = (Vector(forward) + right_dir * gx * spread + up_dir * gy * spread).normalized()
                    hit = ray(eye, ray_dir)
                    dists.append((hit - eye).length if hit is not None else 99.0)
            # Measured on Bloc B F5 (24 Oct, rays through glass): the wardrobe faces the AI turned into
            # living rooms had a surface 8-10 cm from the eye, or a median of 9 cm; every face it rendered
            # well kept its median above 0.3 m and its closest point above 0.18 m (a corridor wall).
            ordered = sorted(dists)
            median = ordered[len(ordered) // 2]
            near = (median < 0.3 or ordered[0] < 0.15) and name not in ("up", "down")
            # A face that shows only bare planes (a wall, a corner, the floor), from the geometry: 81 rays,
            # each hit grouped by the plane it lies on. The image model fills an empty marble wall with
            # a room that is not there (Bloc B F2, 25 Oct: a sofa and a lounge drawn on a bathroom wall).
            planes = {}
            for gx in range(9):
                for gy in range(9):
                    ray_dir = (Vector(forward) + right_dir * (gx / 4 - 1) * spread + up_dir * (gy / 4 - 1) * spread).normalized()
                    loc, normal = ray_n(eye, ray_dir)
                    if loc is None:
                        key = None
                    else:
                        n = normal.normalized()
                        if n.dot(ray_dir) > 0:
                            n = -n
                        key = (round(n.x, 1), round(n.y, 1), round(n.z, 1), round(n.dot(loc) / 0.05))
                    planes[key] = planes.get(key, 0) + 1
            big = sorted((c for k, c in planes.items() if k is not None and c >= 81 * 0.08), reverse=True)
            bare_share = sum(big[:3]) / 81.0
            bare = bare_share >= 0.92 and name not in ("up", "down")
            path = os.path.join(out_dir, "ai-%d-%s.png" % (i, name))
            ai_frames.append((i, name, path))
            f = len(ai_frames)
            cam.keyframe_insert("location", frame=f)
            cam.keyframe_insert("rotation_euler", frame=f)
            probe.keyframe_insert("location", frame=f)
            if dome is not None:
                dome.keyframe_insert("location", frame=f)
            meta["faces"].append({"name": name, "forward": list(forward), "up": list(up), "capture": path, "near": near, "distance": round(median, 2), "bare": bare, "planes": round(bare_share, 2)})
            print("TOUR_INFO face %d %s planes %.2f%s%s" % (i, name, bare_share, " bare" if bare else "", " near" if near else ""), flush=True)
        ai_metas.append((i, meta))
    for ob in (cam, probe, dome):
        if ob is not None and ob.animation_data and ob.animation_data.action:
            for fc in ob.animation_data.action.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = "CONSTANT"
    # The faces' metadata first, then each face announced as soon as it is written: the image requests start
    # while Blender is still rendering the next faces (ChatGPT, 26 Oct: overlap the AI stage with the captures).
    for i, meta in ai_metas:
        with open(os.path.join(out_dir, "ai-%d.json" % i), "w") as fh:
            json.dump(meta, fh)
    print("TOUR_AIMETA", flush=True)
    def ai_frame_written(sc, *args):
        f = sc.frame_current
        i, name, path = ai_frames[f - 1]
        os.replace(os.path.join(out_dir, "aiframe-%04d.png" % f), path)
        print("TOUR_STEP aiface %d %s" % (i, name), flush=True)
    bpy.app.handlers.render_write.append(ai_frame_written)
    scene.frame_start, scene.frame_end = 1, max(1, len(ai_frames))
    scene.render.filepath = os.path.join(out_dir, "aiframe-")
    if ai_frames:
        bpy.ops.render.render(animation=True)
    bpy.app.handlers.render_write.remove(ai_frame_written)
print("TOUR_TIME faces", flush=True)
print("TOUR_OK", flush=True)
`

/**
 * The finished plan: the large render on white, cut to the apartment, with solid walls and their soft shadow
 * (plan-hd.png) or every cut line drawn dark (plan-hd-traits.png), saved large (download) and at the tour's size.
 */
export const PLAN_SCRIPT = String.raw`
import sys, json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

work, hd_out, lines_out, web_out, web_w, web_h, mpp = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), int(sys.argv[6]), float(sys.argv[7])
render = Image.open(work + "/plan-hd.png").convert("RGBA")
W, H = render.size
segments = np.load(work + "/plan-lines.npy")
tall = segments[:, 4] > 0.5 if segments.shape[1] > 4 else np.ones(len(segments), bool)
width = max(2, round(max(W, H) / 900))
hd_mpp = mpp * web_w / W
plan_meta = json.load(open(work + "/tour-blender.json"))["plan"]

def px(metres):
    return max(1, round(metres / hd_mpp))

def ink_of(which, w=width):
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    for x1, y1, x2, y2 in segments[which, :4]:
        d.line([(float(x1), float(y1)), (float(x2), float(y2))], fill=255, width=w)
    return np.asarray(img) > 0

def near(mask, metres):
    return ndimage.distance_transform_edt(~mask) <= metres / hd_mpp

def grow(mask, metres):
    # square growth, so wall corners stay square
    return ndimage.distance_transform_cdt(~mask, metric="chessboard") <= metres / hd_mpp

def grade(x):
    # the same finish as the 360° views: a little more contrast and colour, slightly warmer
    x = np.clip(x / 255, 0, 1) ** 1.05
    x = x * np.array([1.035, 1.012, 0.979], np.float32)
    lum = (x * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    x = np.clip(lum + (x - lum) * 1.18, 0, 1)
    k = 4.5
    s = 1 / (1 + np.exp(-k * (x - 0.5)))
    lo, hi = 1 / (1 + np.exp(k * 0.5)), 1 / (1 + np.exp(-k * 0.5))
    return (s - lo) / (hi - lo) * 255

ink = ink_of(np.ones(len(segments), bool))
wall_ink = ink_of(tall)

# Filled walls (poché, ChatGPT 26 Oct), from the cut geometry only: the areas the cut lines close off are
# measured by the widest circle that fits inside; an area at most 40 cm wide that does not reach the image edge
# is the inside of a cut wall and is filled.
free = ~ink
labels, count = ndimage.label(free)
if count:
    depth = ndimage.distance_transform_edt(free)
    widest = ndimage.maximum(depth, labels, index=np.arange(1, count + 1)) * 2 * hd_mpp
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    wall = (widest <= 0.4)
    wall[edge[edge > 0] - 1] = False
    fill = wall[np.maximum(labels - 1, 0)] & (labels > 0)
else:
    fill = np.zeros(free.shape, bool)
# A wall whose outline is not closed (a gap at a junction) still reads as a wall: the lines of tall surfaces
# are closed over gaps up to 20 cm, so two faces of one wall become one solid band; a wall drawn as a single
# SketchUp face gets a few centimetres of thickness.
closed = ndimage.distance_transform_cdt(grow(wall_ink, 0.1), metric="chessboard") > 0.1 / hd_mpp
walls = fill | closed | grow(wall_ink, 0.025)

# The apartment (27 Oct): the cells the tour build kept (plan-rooms.npy), grown up to the walls without
# crossing a line, with what they enclose (cupboards, a closet behind a closed door) and the walls around them.
apt = np.ones((H, W), bool)
rooms = plan_meta.get("rooms")
if rooms and plan_meta.get("frame") and os.path.exists(work + "/plan-rooms.npy"):
    grid = np.load(work + "/plan-rooms.npy").astype(bool)
    fx0, fy0, fx1, fy1 = plan_meta["frame"]
    xs = fx0 + (np.arange(W) + 0.5) * (fx1 - fx0) / W
    ys = fy1 - (np.arange(H) + 0.5) * (fy1 - fy0) / H
    ci = np.floor((xs - rooms["x0"]) / rooms["step"]).astype(int)
    cj = np.floor((rooms["y0"] - ys) / rooms["step"]).astype(int)
    vi, vj = (ci >= 0) & (ci < grid.shape[1]), (cj >= 0) & (cj < grid.shape[0])
    R = grid[np.clip(cj, 0, grid.shape[0] - 1)][:, np.clip(ci, 0, grid.shape[1] - 1)] & vj[:, None] & vi[None, :]
    if R.any():
        R = ndimage.binary_dilation(R, iterations=px(0.3), mask=~(ink | walls))
        around = walls & grow(R, 0.4)
        apt = R | around
        # what the apartment encloses (a cupboard, a closet behind a closed door), not a whole room of the
        # next flat caught between two walls
        holes, n = ndimage.label(ndimage.binary_fill_holes(apt) & ~apt)
        if n:
            area = ndimage.sum(np.ones_like(holes), holes, index=np.arange(1, n + 1)) * hd_mpp * hd_mpp
            apt |= (area < 3.0)[np.maximum(holes - 1, 0)] & (holes > 0)
        print("apartment: %.0f%% of the frame" % (apt.mean() * 100))
walls &= apt

base = Image.new("RGBA", (W, H), (255, 255, 255, 255))
base.alpha_composite(render)
shown = grade(np.asarray(base.convert("RGB")).astype(np.float32))
shown[~apt] = 255

# Outline style: the apartment with every cut line in the same dark grey.
outline = Image.fromarray(shown.astype(np.uint8))
d = ImageDraw.Draw(outline)
for x1, y1, x2, y2 in segments[:, :4]:
    d.line([(float(x1), float(y1)), (float(x2), float(y2))], fill=(40, 40, 44), width=width)
outline = np.asarray(outline).copy()
outline[~apt] = 255
Image.fromarray(outline).save(lines_out, optimize=True)

# Filled style, like an architect's presentation plan: a soft shadow of the walls falling to the lower right
# and a little darkening along their foot, then the walls on top.
lit = ndimage.gaussian_filter(walls.astype(np.float32), px(0.2))
cast = ndimage.gaussian_filter(np.roll(np.roll(walls, px(0.1), 0), px(0.1), 1).astype(np.float32), px(0.07))
shade = 1 - 0.38 * np.clip(cast, 0, 1) - 0.12 * np.clip(lit, 0, 1)
inside = apt & ~walls
shown[inside] *= shade[inside][:, None]
plan = Image.fromarray(np.clip(shown, 0, 255).astype(np.uint8))
# Furniture and fittings the cut goes through stay as thin lighter lines.
d = ImageDraw.Draw(plan)
for x1, y1, x2, y2 in segments[~tall, :4]:
    d.line([(float(x1), float(y1)), (float(x2), float(y2))], fill=(95, 95, 102), width=max(1, width // 2))
plan = np.asarray(plan).copy()
plan[walls] = (38, 38, 42)
plan[~apt] = 255
plan = Image.fromarray(plan)
plan.save(hd_out, optimize=True)
plan.resize((web_w, web_h), Image.LANCZOS).save(web_out, optimize=True)
print("walls: %.1f%% of the plan" % (walls.mean() * 100))
`

/** Turns the six faces of one viewpoint into an equirectangular panorama centred on the saved view's direction. */
const STITCH_SCRIPT = String.raw`
import sys
import numpy as np
from PIL import Image

face_dir, index, yaw, out, width = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], int(sys.argv[5])
height = width // 2
FACES = [
    ("px", (1, 0, 0), (0, 0, 1)), ("nx", (-1, 0, 0), (0, 0, 1)),
    ("py", (0, 1, 0), (0, 0, 1)), ("ny", (0, -1, 0), (0, 0, 1)),
    ("pz", (0, 0, 1), (0, -1, 0)), ("nz", (0, 0, -1), (0, 1, 0)),
]
basis, images = [], []
for name, f, u in FACES:
    f, u = np.array(f, np.float32), np.array(u, np.float32)
    r = np.cross(f, u)
    r /= np.linalg.norm(r)
    basis.append((f, r, np.cross(r, f)))
    images.append(np.asarray(Image.open("%s/face-%s-%s.png" % (face_dir, index, name)).convert("RGB"), np.float32))
size = images[0].shape[0]

def grade(x):
    # Blender alone renders flat and grey: a little more contrast and colour, slightly warmer (tuned on Bloc B F5, 23 Oct).
    x = np.clip(x / 255, 0, 1) ** 1.05
    x = x * np.array([1.035, 1.012, 0.979], np.float32)
    lum = (x * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    x = np.clip(lum + (x - lum) * 1.18, 0, 1)
    k = 4.5
    s = 1 / (1 + np.exp(-k * (x - 0.5)))
    lo, hi = 1 / (1 + np.exp(k * 0.5)), 1 / (1 + np.exp(-k * 0.5))
    return (s - lo) / (hi - lo) * 255

pano = np.zeros((height, width, 3), np.uint8)
cols = (np.arange(width, dtype=np.float32) + 0.5) / width * 2 * np.pi - np.pi
for top in range(0, height, 256):
    rows = np.arange(top, min(height, top + 256), dtype=np.float32)
    lat = (np.pi / 2 - (rows + 0.5) / height * np.pi)[:, None]
    # left to right in the image turns to the right; the middle column is the saved view's direction
    az = yaw - cols[None, :]
    d = np.stack([np.cos(lat) * np.cos(az), np.cos(lat) * np.sin(az), np.sin(lat) * np.ones_like(az)], -1)
    best = np.argmax(np.stack([d @ f for f, _, _ in basis], -1), -1)
    block = np.zeros(d.shape, np.float32)
    for k, (f, r, u) in enumerate(basis):
        m = best == k
        if not m.any():
            continue
        dd = d[m]
        dn = dd @ f
        px = ((dd @ r) / dn + 1) / 2 * size - 0.5
        py = (1 - (dd @ u) / dn) / 2 * size - 0.5
        x0 = np.clip(np.floor(px).astype(np.int32), 0, size - 1)
        y0 = np.clip(np.floor(py).astype(np.int32), 0, size - 1)
        x1, y1 = np.clip(x0 + 1, 0, size - 1), np.clip(y0 + 1, 0, size - 1)
        fx = np.clip(px - x0, 0, 1)[:, None]
        fy = np.clip(py - y0, 0, 1)[:, None]
        im = images[k]
        block[m] = (im[y0, x0] * (1 - fx) * (1 - fy) + im[y0, x1] * fx * (1 - fy) + im[y1, x0] * (1 - fx) * fy + im[y1, x1] * fx * fy)
    pano[top:top + len(rows)] = np.clip(grade(block) + 0.5, 0, 255).astype(np.uint8)
Image.fromarray(pano).save(out, quality=88, optimize=True, progressive=True)
`

/** Automatic viewpoints per tour, on top of the designer's views (ChatGPT: 10-16 for 100-150 m²). */
const AUTO_MAX = 14
/** Panoramas stitched at once after Blender has closed (each takes one processor core and ~0.5 GB). */
const STITCH_CONCURRENCY = 3
/** Faces sent to the image service at once, one image per request. The gateway allows 8 (Mehdi, 25 Oct). */
const AI_CONCURRENCY = Math.max(1, Number(process.env.ROOMIA_AI_CONCURRENCY ?? 8))

/** A whole tour (plan + 6 faces per view) of a big file: ~5 min for 8 views; past this, Blender is stuck. */
const BLENDER_TIMEOUT_MS = 45 * 60_000

/** Stitches the overlapping faces of one viewpoint (AI photos, and plain walls kept as their capture) into a panorama. */
const STITCH_AI_SCRIPT = String.raw`"""Stitches the six overlapping faces of one viewpoint (AI photos, and faces kept as their Blender capture)
into an equirectangular panorama.
Usage: stitch_ai.py <faces.json> <out.jpg> <width>
faces.json: {"fov": 100, "heading": [x, y, z], "faces": [{"name", "forward", "up", "image", "ai": bool}, ...]}"""
import json, sys
import numpy as np
from PIL import Image

spec = json.load(open(sys.argv[1]))
out, W = sys.argv[2], int(sys.argv[3])
tan_half = np.tan(np.radians(spec["fov"] / 2))
# Distances in "cube units": 1.0 at the 90° cube-face boundary, tan_half at the face's own edge.
OVERLAP = tan_half - 1.0
BLEND_AI = 0.5  # AI faces blend across half the overlap: less ghosting where two faces painted a texture differently
BLEND_KEPT = 1.0  # kept (Blender) faces fade across the whole overlap, so their edge melts into the AI faces
h = np.array(spec["heading"], np.float32)
yaw0 = float(np.arctan2(h[1], h[0]))

faces = []
for f in spec["faces"]:
    fw, up = np.array(f["forward"], np.float32), np.array(f["up"], np.float32)
    r = np.cross(fw, up); r /= np.linalg.norm(r); u = np.cross(r, fw)
    img = np.asarray(Image.open(f["image"]).convert("RGB").resize((1024, 1024), Image.BICUBIC), np.float32)
    faces.append({"name": f.get("name", ""), "f": fw, "r": r, "u": u, "img": img, "ai": bool(f["ai"]), "gain": np.ones(3, np.float32)})


def directions(width, rows):
    height = width // 2
    cols = (np.arange(width, dtype=np.float32) + 0.5) / width * 2 * np.pi - np.pi
    lat = (np.pi / 2 - (rows + 0.5) / height * np.pi)[:, None]
    az = yaw0 - cols[None, :]
    return np.stack([np.cos(lat) * np.cos(az), np.cos(lat) * np.sin(az), np.sin(lat) * np.ones_like(az)], -1)


def sample(face, d, blend):
    """Colour of 'face' along directions d (with its gain), and its weight: 1 well inside the 90° face,
    fading to 0 across a band (a share 'blend' of the overlap) centred on the 90° boundary."""
    dn = d @ face["f"]
    ok = dn > 0.05
    x = np.where(ok, (d @ face["r"]) / np.maximum(dn, 1e-6) / tan_half, 9)
    y = np.where(ok, (d @ face["u"]) / np.maximum(dn, 1e-6) / tan_half, 9)
    edge = np.maximum(np.abs(x), np.abs(y)) * tan_half
    half = blend * OVERLAP / 2
    w = np.clip((1 + half - edge) / (2 * half), 0, 1)
    w = np.where(np.maximum(np.abs(x), np.abs(y)) < 1, w, 0).astype(np.float32)
    w = w * w * (3 - 2 * w)
    S = face["img"].shape[0]
    px = (np.clip(x, -1, 1) + 1) / 2 * S - 0.5
    py = (1 - np.clip(y, -1, 1)) / 2 * S - 0.5
    x0 = np.clip(np.floor(px).astype(np.int32), 0, S - 1); y0 = np.clip(np.floor(py).astype(np.int32), 0, S - 1)
    x1 = np.clip(x0 + 1, 0, S - 1); y1 = np.clip(y0 + 1, 0, S - 1)
    fx = np.clip(px - x0, 0, 1)[..., None]; fy = np.clip(py - y0, 0, 1)[..., None]
    im = face["img"]
    c = im[y0, x0] * (1 - fx) * (1 - fy) + im[y0, x1] * fx * (1 - fy) + im[y1, x0] * (1 - fx) * fy + im[y1, x1] * fx * fy
    return c * face["gain"], w


# 1. Exposure and white balance, solved for all faces at once from their overlaps (where two faces see
#    the same surface). Per channel, unknown log-gain g_k per face; each overlapping pair gives
#    g_i - g_j = median(log c_j - log c_i). Highlights, deep shadows and strong colour disagreements
#    (reflections, windows, a texture painted differently) are left out of the medians.
fit_w = 1024
d = directions(fit_w, np.arange(fit_w // 2, dtype=np.float32))
raw = [sample(f, d, 1.0) for f in faces]
n = len(faces)
rows, rhs, weights = [], [], []
for i in range(n):
    for j in range(i + 1, n):
        ci, wi = raw[i]; cj, wj = raw[j]
        m = (wi > 0.05) & (wj > 0.05)
        li, lj = ci.mean(-1), cj.mean(-1)
        m &= (li > 25) & (li < 230) & (lj > 25) & (lj < 230)
        if m.sum() < 300:
            continue
        ratio = np.log(cj[m] + 1) - np.log(ci[m] + 1)
        spread = np.abs(ratio - np.median(ratio, 0)).max(-1)
        keep = spread < np.percentile(spread, 70)
        if keep.sum() < 200:
            continue
        a = np.zeros(n); a[i] = 1; a[j] = -1
        rows.append(a); rhs.append(np.median(ratio[keep], 0)); weights.append(np.sqrt(keep.sum()))
ai_idx = [k for k, f in enumerate(faces) if f["ai"]] or [0]
if rows:
    A = np.array(rows) * np.array(weights)[:, None]
    B = np.array(rhs) * np.array(weights)[:, None]
    # Anchor: the AI faces keep their average exposure (their log-gains average to 0).
    anchor = np.zeros(n); anchor[ai_idx] = 1.0 / len(ai_idx)
    A = np.vstack([A, anchor * 50]); B = np.vstack([B, np.zeros(3)])
    g = np.linalg.lstsq(A, B, rcond=None)[0]
    for k, f in enumerate(faces):
        limit = 0.25 if f["ai"] else 0.7  # a kept Blender face may need a bigger correction than an AI face
        f["gain"] = np.exp(np.clip(g[k], -limit, limit)).astype(np.float32)
for f in faces:
    print("face", f["name"], "AI" if f["ai"] else "kept", "gain", np.round(f["gain"], 3))

# 2. The full panorama.
H = W // 2
pano = np.zeros((H, W, 3), np.uint8)
for top in range(0, H, 128):
    rr = np.arange(top, min(H, top + 128), dtype=np.float32)
    dd = directions(W, rr)
    acc = np.zeros(dd.shape, np.float32); ws = np.zeros(dd.shape[:2], np.float32)
    for f in faces:
        c, w = sample(f, dd, BLEND_AI if f["ai"] else BLEND_KEPT)
        acc += c * w[..., None]; ws += w
    pano[top:top + len(rr)] = np.clip(acc / np.maximum(ws, 1e-6)[..., None] + 0.5, 0, 255).astype(np.uint8)
Image.fromarray(pano).save(out, quality=90, optimize=True, progressive=True)
print("saved", out)
`

/** Faces with almost nothing on them (a bare wall): the image model tends to invent a door or a room there. */
const PLAIN_FACE_SCRIPT = String.raw`
import json, sys
import numpy as np
from PIL import Image
res = {}
for path in sys.argv[1:]:
    g = np.asarray(Image.open(path).convert("L").resize((256, 256)), np.float32)
    mag = np.hypot(np.abs(np.diff(g, axis=1))[:-1, :], np.abs(np.diff(g, axis=0))[:, :-1])
    # Measured on Bloc B F5 (24 Oct): a bare wall scored 0.013 and 8.9; every face with content 0.049+ and 27+.
    res[path] = bool(np.mean(mag > 6) < 0.03 and g.std() < 15)
print(json.dumps(res))
`

function run(command: string, args: string[], onLine?: (line: string) => void, timeoutMs = BLENDER_TIMEOUT_MS): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    let stderr = ''
    const unguard = command === BLENDER ? guardMemory(child, reason => (stderr += `\nArrêté : ${reason}`)) : () => undefined
    let pending = ''
    // Read stdout even when nobody needs it: a full pipe freezes Blender.
    child.stdout.on('data', chunk => {
      pending += String(chunk)
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      lines.forEach(l => onLine?.(l))
    })
    child.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-8000)
    })
    child.on('close', code => {
      clearTimeout(timer)
      unguard()
      resolve({ code: code ?? 1, stderr })
    })
    child.on('error', err => {
      clearTimeout(timer)
      unguard()
      resolve({ code: 1, stderr: err.message })
    })
  })
}

/** Runs fn on every item, at most limit at a time, and keeps the results in order. */
async function inParallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** A function that runs at most n of the functions given to it at once, in the order they arrive. */
function limiter(n: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= n) await new Promise<void>(resolve => waiting.push(resolve))
    active += 1
    try {
      return await fn()
    } finally {
      active -= 1
      waiting.shift()?.()
    }
  }
}

/** One limit for every AI 360° job at once: the gateway allows 8 requests in total, not 8 per job. */
const withAiSlot = limiter(Math.max(1, Number(process.env.ROOMIA_AI_CONCURRENCY ?? 8)))

async function writeStatus(sceneId: string, status: TourStatus) {
  await mkdir(tourDir(sceneId), { recursive: true })
  // Progress lines arrive quickly: each write gets its own temporary file, then replaces the status at once.
  const tmp = `${statusPath(sceneId)}.${process.pid}.${Math.random().toString(36).slice(2)}`
  await writeFile(tmp, JSON.stringify(status))
  await rename(tmp, statusPath(sceneId))
}

const alive = (pid: number | undefined) => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function readTourStatus(sceneId: string): Promise<TourStatus> {
  const status = JSON.parse(await readFile(statusPath(sceneId), 'utf8').catch(() => '{"state":"idle"}')) as TourStatus
  // A build left half-way by a restart of the Studio is not running any more.
  if (status.state === 'building' && !alive(status.pid)) return { ...status, state: 'failed', error: 'La préparation a été interrompue. Relancez-la.' }
  return status
}

async function build(sceneId: string, cameras: SceneCamera[]) {
  const started = performance.now()
  const dir = tourDir(sceneId)
  const work = path.join(dir, 'work')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  let total = 1 + cameras.length * 7
  let done = 0
  const startedAt = new Date().toISOString()
  // A lost progress update is harmless; an unhandled one would stop the Studio.
  const progress = (step: string) =>
    writeStatus(sceneId, { state: 'building', step, done, total, startedAt, pid: process.pid }).catch(() => undefined)

  await progress('En attente du processeur graphique…')
  // The previous build's automatic points, for Blender to keep them where they were (see previousAuto in the script).
  const sourceMtime = Math.round((await stat(sourcePath(sceneId))).mtimeMs)
  const before = await readBuild(sceneId)
  const same = before?.sourceMtime === sourceMtime
  const beforeAuto = (before?.views ?? []).filter(v => v.auto && v.position && v.target).sort((a, b) => a.index - b.index)
  const scriptPath = path.join(work, 'tour.py')
  const specPath = path.join(work, 'tour.json')
  await writeFile(scriptPath, TOUR_SCRIPT)
  await writeFile(
    specPath,
    JSON.stringify({
      glb: sourcePath(sceneId),
      outDir: work,
      views: cameras.map(c => ({ name: c.name, position: c.position, target: c.target })),
      previousAuto: beforeAuto.map(v => ({ position: v.position, target: v.target, keep: Boolean(v.panoAi) })),
      previousSame: same,
      faceSize: FACE_SIZE,
      planSize: PLAN_SIZE,
      realGlass: true,
      sharpMirrors: false,
      outdoorSky: true,
      interior: TOUR_LIGHTING.interior,
      roles: await readMaterialRoles(sceneId),
      finishRoughness: FINISH_ROUGHNESS,
      lighting: blenderLighting(TOUR_LIGHTING),
      viewTransform: 'AgX',
      autoViews: true,
      autoMax: AUTO_MAX,
    }),
  )
  let pointCount = cameras.length
  // Stage times, from the TOUR_TIME lines of the script (ChatGPT, 25 Oct: measure before optimising).
  const marks: Record<string, number> = {}
  const mark = (name: string) => (marks[name] = performance.now())
  const result = await withBlenderSlot(async () => {
    mark('blender')
    await progress('Ouverture du fichier complet…')
    return run(BLENDER, ['--background', '--python', scriptPath, '--', specPath], line => {
      if (line.startsWith('TOUR_TIME')) mark(line.split(' ')[1])
      if (line.startsWith('TOUR_AUTO')) {
        const placed = Number(line.split(' ')[1]) || 0
        pointCount += placed
        total += placed * 7
        void progress(`${placed} points placés automatiquement`)
        return
      }
      if (!line.startsWith('TOUR_STEP')) return
      done += 1
      void progress(line.includes('plan') ? 'Plan et points de vue' : `Vue 360° ${Number(line.split(' ')[2]) + 1} / ${pointCount}`)
    })
  })
  mark('blender_done')
  if (result.code !== 0) throw new Error(`Blender a échoué : ${result.stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`)

  const meta = JSON.parse(await readFile(path.join(work, 'tour-blender.json'), 'utf8')) as {
    plan: { width: number; height: number; mpp: number }
    views: { index: number; plan: { x: number; y: number; angle: number }; yaw: number; outside?: boolean; facesWall?: boolean }[]
    auto?: {
      index: number
      position: [number, number, number]
      target: [number, number, number]
      yaw: number
      plan: { x: number; y: number; angle: number }
      /** Index in previousAuto of the old point this one is. */
      previous?: number | null
    }[]
    links?: [number, number][]
  }
  const stitch = path.join(work, 'stitch.py')
  await writeFile(stitch, STITCH_SCRIPT)
  // Each stitch is a separate Python process on the processor; Blender has exited, so a few fit side by side.
  let stitchedCount = 0
  const stitchOne = async (index: number, yaw: number) => {
    const file = `pano-${index}.jpg`
    const stitched = await run(PYTHON, [stitch, work, String(index), String(yaw), path.join(dir, file), String(PANO_WIDTH)])
    done += 1
    stitchedCount += 1
    void progress(`Assemblage 360° ${stitchedCount} / ${pointCount}`)
    if (stitched.code !== 0) console.error('tour stitch failed', index, stitched.stderr.slice(-500))
    return stitched.code === 0 ? file : null
  }
  const auto = meta.auto ?? []
  const panos = await inParallel(
    [...meta.views.map(v => ({ index: v.index, yaw: v.yaw, skip: v.outside })), ...auto.map(a => ({ index: a.index, yaw: a.yaw, skip: false }))],
    STITCH_CONCURRENCY,
    // A camera outside the building gets no 360° (its faces are not rendered).
    p => (p.skip ? Promise.resolve(null) : stitchOne(p.index, p.yaw)),
  )
  const views: TourViewPoint[] = meta.views.map((view, n) => ({
    index: view.index,
    name: cameras[view.index].name,
    pano: panos[n],
    plan: view.plan,
    outside: view.outside,
    facesWall: view.facesWall,
  }))
  // An automatic point that is an old one keeps its id; a new one takes a number no point has had.
  const idOf = (v: TourViewPoint) => v.id ?? `auto-${v.name.replace(/\D/g, '')}`
  let lastId = Math.max(0, ...beforeAuto.map(v => Number(idOf(v).slice(5)) || 0))
  for (const [n, point] of auto.entries()) {
    const old = point.previous != null ? beforeAuto[point.previous] : undefined
    views.push({
      index: point.index,
      id: old ? idOf(old) : `auto-${++lastId}`,
      name: `Point ${n + 1}`,
      pano: panos[meta.views.length + n],
      plan: point.plan,
      auto: true,
      position: point.position,
      target: point.target,
    })
  }
  const planScript = path.join(work, 'plan.py')
  await writeFile(planScript, PLAN_SCRIPT)
  const planned = await run(PYTHON, [
    planScript, work, path.join(dir, 'plan-hd.png'), path.join(dir, 'plan-hd-traits.png'), path.join(dir, 'plan.png'),
    String(meta.plan.width), String(meta.plan.height), String(meta.plan.mpp),
  ])
  if (planned.code !== 0) console.error('tour plan failed', planned.stderr.slice(-500))
  mark('stitched')
  // What the operator did on a point (AI 360°, approval, removal, starting direction) follows the point to the
  // new build: the designer's views by index and name, automatic points through the match made in Blender.
  // AI panoramas are paid for and stay; made from an older file, they go back to the reviewer.
  for (const [n, v] of views.entries()) {
    const old = v.auto
      ? (() => {
          const previous = auto[n - meta.views.length].previous
          return previous != null ? beforeAuto[previous] : undefined
        })()
      : before?.views.find(b => b.index === v.index && b.name === v.name && !b.auto)
    if (!old) continue
    if (old.panoAi) {
      v.panoAi = old.panoAi
      v.panoAiApproved = same && old.panoAiApproved === true
      if (!same || old.panoAiStale) v.panoAiStale = true
    }
    if (old.hidden) v.hidden = true
    if (old.startYaw !== undefined) {
      // The panorama is centred on the point's direction; a point that moved may face another way.
      const yaw = (p: TourViewPoint) => (p.position && p.target ? Math.atan2(-(p.target[2] - p.position[2]), p.target[0] - p.position[0]) : 0)
      const turn = v.auto ? yaw(v) - yaw(old) : 0
      v.startYaw = Math.atan2(Math.sin(old.startYaw + turn), Math.cos(old.startYaw + turn))
    }
  }
  const at = (name: string) => marks[name]
  const span = (from: string, to: string) => (at(from) && at(to) ? Math.round((at(to) - at(from)) / 100) / 10 : undefined)
  marks.start = started
  const timings: Record<string, number> = {}
  for (const [name, from, to] of [
    ['attente', 'start', 'blender'],
    ['ouverture', 'blender', 'scene_ready'],
    ['placement', 'scene_ready', 'placement'],
    ['plan', 'placement', 'plan'],
    ['faces', 'plan', 'faces'],
    ['fermeture', 'faces', 'blender_done'],
    ['assemblage', 'blender_done', 'stitched'],
    ['total', 'start', 'stitched'],
  ] as const) {
    const seconds = span(from, to)
    if (seconds !== undefined) timings[name] = seconds
  }
  console.log('tour build', sceneId, `${views.length} points`, JSON.stringify(timings))
  const tour: TourBuild = {
    builtAt: new Date().toISOString(),
    seconds: Math.round((performance.now() - started) / 1000),
    sourceMtime,
    aiImages: before?.aiImages ?? 0,
    plan: { file: 'plan.png', hd: 'plan-hd.png', lines: 'plan-hd-traits.png', width: meta.plan.width, height: meta.plan.height },
    views,
    links: meta.links ?? [],
    timings,
  }
  await writeFile(tourPath(sceneId), JSON.stringify(tour))
  await rm(work, { recursive: true, force: true })
  await writeStatus(sceneId, { state: 'done', done: total, total })
}

/** Starts the panoramas and the plan in the background (several minutes); the status file tells the progress. */
export async function startTourBuild(sceneId: string): Promise<TourStatus> {
  const current = await readTourStatus(sceneId)
  if (current.state === 'building') return current
  const cameras = await readCameras(sceneId)
  if (cameras.length === 0) throw new Error('Cette scène n’a pas de vue enregistrée.')
  const status: TourStatus = { state: 'building', step: 'Démarrage…', done: 0, total: 1 + cameras.length * 7, startedAt: new Date().toISOString(), pid: process.pid }
  await writeStatus(sceneId, status)
  void build(sceneId, cameras).catch(async err => {
    console.error('tour build failed', err)
    await writeStatus(sceneId, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
  })
  return status
}


const readBuild = async (sceneId: string) =>
  JSON.parse(await readFile(tourPath(sceneId), 'utf8').catch(() => 'null')) as TourBuild | null

/**
 * The light of an AI 360°, chosen by whoever orders it. 'soleil': warm late-afternoon sun, the
 * look of the photos (a sun patch may break at a join). 'douce': even daylight with no sun patches,
 * consistent in every direction but flatter (ChatGPT's advice; 24 Oct test on the dining room).
 */
export const TOUR_AI_LIGHTS = ['soleil', 'douce'] as const
export type TourAiLight = (typeof TOUR_AI_LIGHTS)[number]

export const TOUR_AI_LIGHTING: Record<TourAiLight, Lighting> = {
  soleil: { time: 'apres-midi', sun: true, interior: true },
  douce: { time: 'midi', sun: false, interior: true },
}

/** Added to the photo prompt for each face of a 360°: the faces are made separately, so nothing may be invented. (Exported for test runs.) */
export const PANO_FACE_PROMPT: Record<TourAiLight, string> = {
  soleil: [
    'This picture is one face of a 360° panorama of the room; the faces next to it are made separately and must join seamlessly.',
    'Preserve the existing location and direction of all windows, doors, walls, furniture and architectural boundaries.',
    'Never add a door, an opening, a window, a room, a floor or furniture that is not in the image. A plain wall stays a plain wall.',
  ].join(' '),
  douce: [
    'This picture is one face of a 360° panorama of the room; the faces next to it are made separately and must join seamlessly.',
    'Maintain consistent, warm, diffuse daylight throughout the entire room, the same in every direction.',
    'Preserve the existing location and direction of all windows, doors, walls, furniture and architectural boundaries.',
    'Do not introduce direct sun patches, window-shaped light on walls, ceiling or floor, new openings or additional light sources.',
    'Never add a door, an opening, a window, a room, a floor or furniture that is not in the image. A plain wall stays a plain wall.',
  ].join(' '),
}

/** The tour's points as Blender views, in index order: the designer's saved views, then the automatic points. */
function tourPoints(cameras: SceneCamera[], built: TourBuild) {
  const points: { name: string; position: number[]; target: number[] }[] = cameras.map(c => ({ name: c.name, position: c.position, target: c.target }))
  for (const v of built.views.filter(v => v.auto && v.position && v.target).sort((a, b) => a.index - b.index)) {
    points[v.index] = { name: v.name, position: v.position!, target: v.target! }
  }
  return points
}

/**
 * Makes the 360° of some viewpoints photoreal: Blender renders six overlapping faces per viewpoint
 * in the capture style, the image model turns each into a photograph (a bare wall is kept as it
 * is, recoloured), and the faces are blended into a panorama. Costs up to 6 images per viewpoint.
 */
export async function startTourAi(sceneId: string, indices: number[], light: TourAiLight = 'soleil'): Promise<TourStatus> {
  const current = await readTourStatus(sceneId)
  if (current.state === 'building') return current
  const built = await readBuild(sceneId)
  if (!built) throw new Error('Préparez d’abord la visite 360°.')
  const cameras = await readCameras(sceneId)
  const points = tourPoints(cameras, built)
  const wanted = [...new Set(indices)].filter(i => Number.isInteger(i) && built.views.some(v => v.index === i && !v.outside && !v.hidden) && points[i])
  if (wanted.length === 0) throw new Error('Aucune vue valide à passer en qualité photo.')
  const status: TourStatus = { state: 'building', kind: 'ai', step: 'Démarrage…', done: 0, total: wanted.length * 13, startedAt: new Date().toISOString(), pid: process.pid }
  await writeStatus(sceneId, status)
  void buildAi(sceneId, points, wanted, light).catch(async err => {
    console.error('tour AI failed', err)
    await writeStatus(sceneId, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
  })
  return status
}

async function buildAi(sceneId: string, points: { name: string; position: number[]; target: number[] }[], indices: number[], light: TourAiLight) {
  const dir = tourDir(sceneId)
  const work = path.join(dir, 'work-ai')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const total = indices.length * 13
  let done = 0
  const startedAt = new Date().toISOString()
  const marks: Record<string, number> = { start: performance.now() }
  const mark = (name: string) => (marks[name] = performance.now())
  const progress = (step: string) =>
    writeStatus(sceneId, { state: 'building', kind: 'ai', step, done, total, startedAt, pid: process.pid }).catch(() => undefined)

  await progress('En attente du processeur graphique…')
  const scriptPath = path.join(work, 'tour.py')
  const specPath = path.join(work, 'tour.json')
  await writeFile(scriptPath, TOUR_SCRIPT)
  await writeFile(
    specPath,
    JSON.stringify({
      mode: 'ai',
      aiViews: indices,
      aiFov: 100,
      glb: sourcePath(sceneId),
      outDir: work,
      // Indexes must match the tour's: the Blender script uses views[i] for each AI viewpoint i.
      views: points.map(p => p ?? { name: '', position: [0, 0, 0], target: [0, 0, 1] }),
      faceSize: 1024,
      realGlass: true,
      sharpMirrors: false,
      outdoorSky: true,
      interior: TOUR_LIGHTING.interior,
      roles: await readMaterialRoles(sceneId),
      finishRoughness: FINISH_ROUGHNESS,
      lighting: blenderLighting(TOUR_LIGHTING),
      captureLighting: NEUTRAL_CAPTURE_LIGHT,
    }),
  )
  const plainScript = path.join(work, 'plain.py')
  const stitchScript = path.join(work, 'stitch_ai.py')
  await writeFile(plainScript, PLAIN_FACE_SCRIPT)
  await writeFile(stitchScript, STITCH_AI_SCRIPT)
  const prompt = `${buildSceneRenderPrompt(TOUR_AI_LIGHTING[light])}\n${PANO_FACE_PROMPT[light]}`
  const log = path.join(dir, 'ai-faces.jsonl')

  // Each face is handled as soon as Blender has written it (ChatGPT, 26 Oct): checked, sent to the image model
  // while Blender renders the next ones, and a viewpoint is stitched as soon as its six faces are done.
  type MetaFace = { name: string; forward: number[]; up: number[]; capture: string; near?: boolean; bare?: boolean; planes?: number; distance?: number }
  type Face = { name: string; forward: number[]; up: number[]; image: string; ai: boolean }
  const metas = new Map<number, { fov: number; heading: number[]; faces: MetaFace[] }>()
  let metaReady: () => void = () => undefined
  const metasLoaded = new Promise<void>(resolve => (metaReady = resolve))
  const finished = new Map<number, Face[]>()
  const stitchLimit = limiter(STITCH_CONCURRENCY)
  const tasks: Promise<unknown>[] = []
  const latencies: number[] = []
  const made: Record<number, string> = {}
  // A new name each time: a point keeps its AI 360° across rebuilds even when its number changes.
  const stamp = Date.now().toString(36)
  let bought = 0
  let failed = 0
  let sent = 0
  // The image service refuses every request once the account's credit is used up (HTTP 403): the rest is not
  // sent, and a viewpoint that lost faces that way gets no AI 360° (half AI, half Blender).
  let noCredit = false
  const starved = new Set<number>()

  const stitchView = (index: number) =>
    stitchLimit(async () => {
      const meta = metas.get(index)!
      const faces = meta.faces.map(f => finished.get(index)!.find(d => d.name === f.name)!)
      const facesJson = path.join(work, `stitch-${index}.json`)
      await writeFile(facesJson, JSON.stringify({ fov: meta.fov, heading: meta.heading, faces }))
      const file = `pano-${index}-ai-${stamp}.jpg`
      const stitched = await run(PYTHON, [stitchScript, facesJson, path.join(dir, file), String(PANO_WIDTH)])
      done += 1
      void progress(`Assemblage 360° · ${points[index].name}`)
      if (stitched.code === 0 && faces.some(f => f.ai)) made[index] = file
      else if (stitched.code !== 0) console.error('tour AI stitch failed', index, stitched.stderr.slice(-500))
    })

  const handleFace = async (index: number, name: string) => {
    await metasLoaded
    const meta = metas.get(index)
    const face = meta?.faces.find(f => f.name === name)
    if (!meta || !face) return
    // A bare wall (plain in the image, or only flat planes in the geometry), or a wall/cupboard right in front
    // of the camera: the image model would invent something there. The ceiling stays Blender too: the AI
    // lit it differently from the walls and drew arcs at the joins.
    let decision = name === 'up' ? 'ceiling' : face.near ? 'near' : face.bare ? 'bare' : ''
    if (!decision) {
      let answer = ''
      const checked = await run(PYTHON, [plainScript, face.capture], line => (answer += line))
      const plain = checked.code === 0 && answer ? (JSON.parse(answer) as Record<string, boolean>)[face.capture] : false
      decision = plain ? 'plain' : 'ai'
    }
    const result: Face = { name, forward: face.forward, up: face.up, image: face.capture, ai: false }
    const entry: Record<string, unknown> = {
      at: new Date().toISOString(), sceneId, index, point: points[index].name, face: name, decision,
      planes: face.planes, distance: face.distance, model: GPT_IMAGE_MODEL, quality: IMAGE_QUALITY, light,
    }
    if (decision === 'ai' && noCredit) {
      starved.add(index)
      entry.decision = 'no-credit'
    } else if (decision === 'ai') {
      sent += 1
      await withAiSlot(async () => {
        if (noCredit) {
          starved.add(index)
          entry.decision = 'no-credit'
          return
        }
        const t = performance.now()
        try {
          // Test runs only: ROOMIA_AI_DRYRUN=1 goes through the whole job without buying an image.
          if (process.env.ROOMIA_AI_DRYRUN === '1') throw new Error('dry run')
          const capture = await readFile(face.capture)
          let photo
          try {
            photo = await generatePhotoreal(capture, prompt)
          } catch (err) {
            // One more try only when the request failed fast with a server, rate or connection error: it was not
            // processed, so it was not paid for. A slow failure may have been made and billed; "no credit" stops.
            const status = (err as { status?: number }).status
            const fast = performance.now() - t < 15_000
            if (!fast || status === 403 || (status && status < 500 && status !== 429)) throw err
            entry.retried = true
            await new Promise(resolve => setTimeout(resolve, status === 429 ? 15_000 : 5_000))
            photo = await generatePhotoreal(capture, prompt)
          }
          bought += 1
          latencies.push((performance.now() - t) / 1000)
          const image = path.join(work, `ai-${index}-${name}.jpg`)
          await writeFile(image, Buffer.from(photo.base64, 'base64'))
          result.image = image
          result.ai = true
          entry.ok = true
          entry.quality = photo.quality
        } catch (err) {
          // One face failing keeps its capture (recoloured like a plain wall) rather than losing the viewpoint.
          failed += 1
          entry.ok = false
          entry.error = err instanceof Error ? err.message.slice(0, 200) : String(err)
          if ((err as { status?: number }).status === 403) {
            noCredit = true
            starved.add(index)
          }
          console.error('tour AI face failed', index, name, entry.error)
        }
        entry.seconds = Math.round(performance.now() - t) / 1000
      })
      void progress(`Photos 360° · ${bought + failed} / ${sent} envoyées`)
    }
    // The faces are kept for the review page (ChatGPT, 26 Oct): what the guard decided, and what the AI made.
    try {
      const keep = path.join(dir, 'faces', stamp)
      await mkdir(keep, { recursive: true })
      entry.run = stamp
      entry.capture = `${index}-${name}-capture.jpg`
      await loadSharp()(face.capture).resize(768, 768).jpeg({ quality: 82 }).toBuffer().then(b => writeFile(path.join(keep, entry.capture as string), b))
      if (result.ai) {
        entry.ai = `${index}-${name}-ai.jpg`
        await loadSharp()(result.image).resize(768, 768).jpeg({ quality: 82 }).toBuffer().then(b => writeFile(path.join(keep, entry.ai as string), b))
      }
    } catch (err) {
      console.error('tour AI face not kept', index, name, err)
    }
    await appendFile(log, JSON.stringify(entry) + '\n').catch(() => undefined)
    done += 1
    const list = finished.get(index) ?? []
    list.push(result)
    finished.set(index, list)
    if (list.length === meta.faces.length && !starved.has(index)) await stitchView(index)
  }

  const result = await withBlenderSlot(async () => {
    await progress('Ouverture du fichier complet…')
    return run(BLENDER, ['--background', '--python', scriptPath, '--', specPath], line => {
      if (line.startsWith('TOUR_AIMETA')) {
        tasks.push(
          Promise.all(
            indices.map(async index =>
              metas.set(index, JSON.parse(await readFile(path.join(work, `ai-${index}.json`), 'utf8'))),
            ),
          ).then(() => metaReady()),
        )
        return
      }
      if (!line.startsWith('TOUR_STEP aiface')) return
      done += 1
      const [, , index, name] = line.trim().split(' ')
      void progress(`Faces 360° ${Number(index) + 1}`)
      tasks.push(handleFace(Number(index), name))
    })
  })
  mark('captured')
  // Blender has exited: requests already sent finish (they are paid for) before an error is reported.
  metaReady()
  await Promise.allSettled(tasks)
  mark('stitched')
  if (result.code !== 0) throw new Error(`Blender a échoué : ${result.stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`)

  const seconds = (from: string, to: string) => Math.round((marks[to] - marks[from]) / 1000)
  const sorted = [...latencies].sort((x, y) => x - y)
  const pct = (q: number) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]) : 0)
  console.log('tour AI', sceneId, `${bought} images, ${failed} failed, concurrency ${AI_CONCURRENCY}`, JSON.stringify({
    capture: seconds('start', 'captured'),
    total: seconds('start', 'stitched'),
    latency: { p50: pct(0.5), p90: pct(0.9), p95: pct(0.95), max: pct(1) },
  }))
  const latest = await readBuild(sceneId)
  if (latest) {
    for (const v of latest.views) {
      if (!made[v.index]) continue
      v.panoAi = made[v.index]
      v.panoAiApproved = false
      delete v.panoAiStale
    }
    latest.aiImages = (latest.aiImages ?? 0) + bought
    latest.builtAt = new Date().toISOString()
    await writeFile(tourPath(sceneId), JSON.stringify(latest))
  }
  await rm(work, { recursive: true, force: true })
  await writeStatus(sceneId, {
    state: 'done',
    done: total,
    total,
    step: noCredit
      ? `Crédit du serveur d’images épuisé : ${Object.keys(made).length} vue(s) faite(s), ${starved.size} non faite(s). Rechargez le crédit puis relancez.`
      : `${Object.keys(made).length} vue(s) en qualité photo, ${bought} images${failed ? `, ${failed} échouée(s)` : ''}, ${seconds('start', 'stitched')} s`,
  })
}

/** Files of the face review: a run's folder name and a face picture in it. */
export const FACE_RUN = /^[a-z0-9]{1,12}$/
export const FACE_FILE = /^\d{1,3}-(front|right|back|left|up|down)-(capture|ai)\.jpg$/
export const FACE_REASONS = ['structure', 'materiau', 'reflet', 'raccord', 'detail', 'autre'] as const

export interface FaceLabel {
  run: string
  index: number
  face: string
  /** Should this face have gone to the image model at all? */
  eligible?: 'oui' | 'non' | 'incertain'
  /** Was the AI result good enough (only when there is one)? */
  result?: 'ok' | 'rejet'
  reasons?: (typeof FACE_REASONS)[number][]
}

/** Every kept face of the photo-quality runs, newest first, with its latest label. */
export async function listFaceReviews(sceneId: string) {
  const dir = tourDir(sceneId)
  const lines = async (file: string) =>
    (await readFile(path.join(dir, file), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map(l => {
        try {
          return JSON.parse(l) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .filter((l): l is Record<string, unknown> => l !== null)
  const labels = new Map<string, Record<string, unknown>>()
  for (const l of await lines('face-labels.jsonl')) labels.set(`${l.run}/${l.index}/${l.face}`, l)
  return (await lines('ai-faces.jsonl'))
    .filter(f => typeof f.run === 'string')
    .map(f => ({ ...f, label: labels.get(`${f.run}/${f.index}/${f.face}`) ?? null }))
    .reverse()
}

/** One reviewer label; the latest one per face counts. Thresholds are never changed from these automatically. */
export async function saveFaceLabel(sceneId: string, label: FaceLabel) {
  if (!FACE_RUN.test(label.run) || !Number.isInteger(label.index) || !/^(front|right|back|left|up|down)$/.test(label.face)) {
    throw new Error('Face inconnue.')
  }
  const clean: FaceLabel & { at: string } = {
    at: new Date().toISOString(),
    run: label.run,
    index: label.index,
    face: label.face,
    ...(label.eligible && ['oui', 'non', 'incertain'].includes(label.eligible) ? { eligible: label.eligible } : {}),
    ...(label.result && ['ok', 'rejet'].includes(label.result) ? { result: label.result } : {}),
    ...(Array.isArray(label.reasons) ? { reasons: label.reasons.filter(r => (FACE_REASONS as readonly string[]).includes(r)) } : {}),
  }
  await appendFile(path.join(tourDir(sceneId), 'face-labels.jsonl'), JSON.stringify(clean) + '\n')
  return clean
}

/** The reviewer's decision on an AI 360°: approved (clients see it) or rejected (back to Blender). */
export async function reviewTourAi(sceneId: string, index: number, approve: boolean) {
  const built = await readBuild(sceneId)
  const view = built?.views.find(v => v.index === index)
  if (!built || !view?.panoAi) throw new Error('Pas de 360° en qualité photo pour cette vue.')
  // Every decision is kept, with the file it was about: with ai-faces.jsonl, the start of an evaluation set.
  await appendFile(
    path.join(tourDir(sceneId), 'reviews.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), index, point: view.name, file: view.panoAi, approve }) + '\n',
  ).catch(() => undefined)
  if (approve) {
    view.panoAiApproved = true
    delete view.panoAiStale
  } else {
    await rename(path.join(tourDir(sceneId), view.panoAi), path.join(tourDir(sceneId), view.panoAi.replace('.jpg', '-rejected.jpg'))).catch(() => undefined)
    view.panoAi = null
    view.panoAiApproved = false
    delete view.panoAiStale
  }
  built.builtAt = new Date().toISOString()
  await writeFile(tourPath(sceneId), JSON.stringify(built))
}

/** The operator's edits of a point: remove it from the tour, or set where its 360° starts. */
export async function editTourPoint(sceneId: string, index: number, edit: { hidden?: boolean; startYaw?: number | null }) {
  const built = await readBuild(sceneId)
  const view = built?.views.find(v => v.index === index)
  if (!built || !view) throw new Error('Point introuvable.')
  if (typeof edit.hidden === 'boolean') view.hidden = edit.hidden
  if (edit.startYaw === null) delete view.startYaw
  else if (typeof edit.startYaw === 'number' && Number.isFinite(edit.startYaw)) view.startYaw = edit.startYaw
  built.builtAt = new Date().toISOString()
  await writeFile(tourPath(sceneId), JSON.stringify(built))
}

export interface TourView {
  index: number
  name: string
  position: SceneCamera['position']
  target: SceneCamera['target']
  /** Horizontal field of view of the photo (the lens it was made with). */
  photoHfov: number
  photo: string | null
  /** The 360° shown is the photoreal one made by the image model. */
  panoAi: boolean
  /** For review (?edit=1): the Blender 360°, the AI one, and whether the AI one was approved. */
  panoBase: string | null
  panoAiFile: string | null
  panoAiApproved: boolean
  /** The AI 360° was made from an older version of the file (see TourViewPoint.panoAiStale). */
  panoAiStale: boolean
  /** The saved view looks at a wall (see TourViewPoint.facesWall): no photo on purpose, don't offer to make one. */
  noPhoto: boolean
  pano: string | null
  plan: TourViewPoint['plan']
  /** Placed by Roomia (no photo, 360° only). */
  auto: boolean
  /** The points this one can see: the arrows inside its 360°. */
  links: number[]
  /** Where its 360° starts, when the operator set it. */
  startYaw: number | null
  /** Removed from the tour by the operator (only the reviewer sees it). */
  hidden: boolean
}

/** Everything the tour page needs: each saved view with its latest photo and its panorama, and the plan. */
export async function readTour(sceneId: string, { review = false } = {}) {
  const [cameras, photos, status] = await Promise.all([readCameras(sceneId), listPhotos(sceneId), readTourStatus(sceneId)])
  const built = await readBuild(sceneId)
  const linksOf = (index: number) => (built?.links ?? []).flatMap(([a, b]) => (a === index ? [b] : b === index ? [a] : []))
  const all: (TourView & { outside: boolean; hidden: boolean })[] = cameras.map((camera, index) => {
    // listPhotos is newest first: the first photo of a view is its latest.
    const photo = photos.find(p => p.view === camera.name)
    const point = built?.views.find(v => v.index === index && v.name === camera.name)
    const lens = photo?.lens === 'file' || photo?.lens === '35' || photo?.lens === '24' || photo?.lens === '18' ? photo.lens : '24'
    return {
      index,
      name: camera.name,
      position: camera.position,
      target: camera.target,
      photoHfov: lensHfov(lens, camera),
      photo: point?.facesWall ? null : (photo?.file ?? null),
      noPhoto: point?.facesWall === true,
      // Clients see an AI 360° only once it has been approved; the reviewer sees it as soon as it exists.
      pano: (point?.panoAi && (review || point.panoAiApproved) ? point.panoAi : point?.pano) ?? null,
      panoAi: !!point?.panoAi && (review || point.panoAiApproved === true),
      panoBase: point?.pano ?? null,
      panoAiFile: point?.panoAi ?? null,
      panoAiApproved: point?.panoAiApproved === true,
      panoAiStale: point?.panoAiStale === true,
      plan: point?.plan ?? null,
      auto: false,
      links: linksOf(index),
      startYaw: point?.startYaw ?? null,
      outside: point?.outside === true,
      hidden: point?.hidden === true,
    }
  })
  for (const point of built?.views.filter(v => v.auto && v.position && v.target) ?? []) {
    all.push({
      index: point.index,
      name: point.name,
      position: point.position!,
      target: point.target!,
      photoHfov: 74,
      photo: null,
      noPhoto: true,
      pano: (point.panoAi && (review || point.panoAiApproved) ? point.panoAi : point.pano) ?? null,
      panoAi: !!point.panoAi && (review || point.panoAiApproved === true),
      panoBase: point.pano ?? null,
      panoAiFile: point.panoAi ?? null,
      panoAiApproved: point.panoAiApproved === true,
      panoAiStale: point.panoAiStale === true,
      plan: point.plan,
      auto: true,
      links: linksOf(point.index),
      startYaw: point.startYaw ?? null,
      outside: false,
      hidden: point.hidden === true,
    })
  }
  // Before the 360° is prepared nothing is known about the viewpoints: every view is shown. The
  // reviewer also sees removed points (to put them back); clients don't.
  const views: TourView[] = all.filter(v => !v.outside && (review || !v.hidden)).map(({ outside: _outside, ...v }) => v)
  return { status, plan: built?.plan ?? null, builtAt: built?.builtAt ?? null, views }
}
