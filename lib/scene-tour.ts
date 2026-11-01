import { spawn } from 'node:child_process'
import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BLENDER, guardMemory, SCENE_SETUP_SCRIPT, viewFromSceneCamera, withBlenderSlot, type ViewSpec } from './blender-render'
import { FINISH_ROUGHNESS } from './material-roles'
import { GPT_IMAGE_MODEL } from './openai-client'
import { loadSharp } from './load-sharp'
import { enhancePanorama, panoPrompt, type PanoAiCheck } from './pano-ai'
import type { PanoRejectReason } from './pano-review'
import { upscalePanorama } from './pano-upscale'
import { generatePhotoreal, IMAGE_QUALITY } from './photoreal'
import { blenderLighting, NEUTRAL_CAPTURE_LIGHT, type Lighting } from './render-lighting'
import { buildSceneRenderPrompt } from './scene-render-prompt'
import { lensHfov, type SceneCamera } from './scene-cameras'
import { getCapture, parseCaptureRequest } from './scene-capture'
import { listPhotos, photosDir } from './scene-photos'
import { deleteScene, readCameras, readMaterialRoles, readMeta, sceneDir, sourcePath, writeCameras, writeMeta } from './scene-store'

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
export const TOUR_FILE = /^(pano-\d{1,3}(-ai(-[a-z0-9]{1,12})?(-hd)?)?\.jpg|plan(-n\d{1,2})?(-hd(-traits)?)?\.png|nav\.json|explore(\.glb|\.json|-light\.png)|depth-\d{1,3}\.png|projection\.json|look\.json)$/

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
  /** The AI 360° doubled to 8192 px on this PC's GPU (pano-upscale.ts), for large screens; phones keep panoAi. */
  panoAiHd?: string | null
  /** What the automatic checks found on the AI 360° (drift from the render, lights the render does not have). */
  panoAiCheck?: PanoAiCheck
  /** The AI 360° was made from an older version of the file: kept for the reviewer, hidden from clients until approved again. */
  panoAiStale?: boolean
  /** Its faces that see what a new version of the file changed: only these are made again by an update. */
  panoAiUpdate?: string[]
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
  /** The level it stands on (index into TourBuild.levels; plan coordinates are on that level's plan). */
  level?: number
}

/** One level of a site with several (31 Oct): its own plan, named from the bottom up. */
export interface TourLevel {
  index: number
  name: string
  file: string
  hd?: string
  lines?: string
  width: number
  height: number
  /** Only outdoor areas on it (a garden, a pool deck). */
  outdoor?: boolean
  /** What the plan shows, in Blender's floor plane: [x min, y min, x max, y max] (the walk's live dot). */
  frame?: [number, number, number, number]
}

export interface TourBuild {
  builtAt: string
  seconds: number
  /** The file's modification time when the panoramas were made: AI panoramas of an older version are dropped. */
  sourceMtime?: number
  /** Images bought from the image service for AI panoramas, all builds together. */
  aiImages?: number
  /** hd: the same plan twice as large, for download. The main level's (the designer's views, else the most points). */
  plan: { file: string; hd?: string; lines?: string; width: number; height: number } | null
  /** Every level with points, bottom up, when there are several (the main one is also in plan). */
  levels?: TourLevel[]
  views: TourViewPoint[]
  /** Pairs of viewpoints that can see each other at eye height: the arrows inside the 360°. */
  links?: [number, number][]
  /** Seconds spent in each stage of the last build (waiting for the GPU, opening the file, plan, placement, faces, stitching). */
  timings?: Record<string, number>
  /** What the last new version of the file changed, until the update is made. */
  update?: TourUpdate
}

/**
 * A new version of the file (27 Oct): the objects of both versions are compared (see fingerprints() in the
 * Blender script), and only the AI 360° faces and the photos that can see a change are made again.
 */
export interface TourUpdate {
  at: string
  /** Objects new or changed in the new version, and objects of the old one that are gone. */
  added: number
  removed: number
  /** Photos (the latest of a saved view) that show a change: made again by the update. */
  photos: string[]
}

/** The faces of an AI 360°, as the Blender script names them. */
const AI_FACES = ['front', 'right', 'back', 'left', 'up', 'down']
/** Pixels of a 128 px face mask (192 px wide for a photo) that must show a change: a few, not render noise. */
const MASK_MIN_PIXELS = 4

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
FACE = int(spec.get("faceSize", 1024))

# Fingerprints of the file's objects (27 Oct, updates of a project): each mesh object's own geometry, its turn
# and size, and its materials (with the colours and pictures they ended up with), plus where it stands.
# Two versions of a file are compared through them: what was added, removed, moved or changed, whatever the
# export renamed. The preparation sets the model on the origin, so a whole new version may sit a few
# centimetres off the old one: that common shift is measured and ignored.
import hashlib
def material_print(mat):
    if mat is None:
        return "-"
    parts = [re.sub(r"\.\d{3}$", "", mat.name)]
    if mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                for key in ("Base Color", "Metallic", "Roughness", "Alpha", "Transmission Weight", "Emission Strength"):
                    inp = n.inputs.get(key)
                    if inp is not None and not inp.is_linked:
                        v = inp.default_value
                        parts.append(key + ":" + ",".join("%.3f" % x for x in (v if hasattr(v, "__len__") else [v])))
            elif n.type == "TEX_IMAGE" and n.image is not None:
                parts.append("img:%s:%dx%d" % (os.path.basename(n.image.filepath or n.image.name), n.image.size[0], n.image.size[1]))
    return "|".join(parts)

def fingerprints():
    found, mats = [], {}
    for ob in scene.objects:
        if ob.type != "MESH" or ob.name.startswith("roomia_") or len(ob.data.vertices) == 0:
            continue
        me = ob.data
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        mw = np.array(ob.matrix_world, np.float64)
        h = hashlib.blake2b(co.tobytes(), digest_size=12)
        h.update(np.round(mw[:3, :3], 4).tobytes())
        for slot in ob.material_slots:
            key = slot.material.name if slot.material else "-"
            if key not in mats:
                mats[key] = material_print(slot.material)
            h.update(mats[key].encode())
        w = co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3]
        found.append({"name": ob.name, "sig": h.hexdigest(), "lo": [round(float(x), 4) for x in w.min(0)], "hi": [round(float(x), 4) for x in w.max(0)]})
    return found

prints = fingerprints() if spec.get("mode", "full") == "full" else []
if prints:
    with open(os.path.join(out_dir, "objects.json"), "w") as fh:
        json.dump(prints, fh)
    print("TOUR_INFO %d objects fingerprinted" % len(prints), flush=True)
if spec.get("fingerprintOnly"):
    print("TOUR_OK", flush=True)
    raise SystemExit(0)

changed, ghosts, file_shift = [], [], Vector((0.0, 0.0, 0.0))
if spec.get("previousObjects") and os.path.exists(spec["previousObjects"]):
    old = json.load(open(spec["previousObjects"]))
    by_sig = {}
    for k, o in enumerate(old):
        by_sig.setdefault(o["sig"], []).append(k)
    # The common shift, from the objects that appear exactly once in both versions.
    count_new = {}
    for o in prints:
        count_new[o["sig"]] = count_new.get(o["sig"], 0) + 1
    votes = {}
    for o in prints:
        ks = by_sig.get(o["sig"], [])
        if len(ks) == 1 and count_new[o["sig"]] == 1:
            d = tuple(round(o["lo"][a] - old[ks[0]]["lo"][a], 2) for a in range(3))
            votes[d] = votes.get(d, 0) + 1
    if votes:
        best = max(votes, key=votes.get)
        file_shift = Vector(best)
    used = set()
    for o in prints:
        match = None
        for k in by_sig.get(o["sig"], []):
            if k not in used and all(abs(o["lo"][a] - old[k]["lo"][a] - file_shift[a]) < 0.005 for a in range(3)):
                match = k
                break
        if match is None:
            changed.append(o)
        else:
            used.add(match)
    ghosts = [o for k, o in enumerate(old) if k not in used]
    print("TOUR_INFO update: %d objects new or changed, %d gone, shift %.3f %.3f %.3f m" % (len(changed), len(ghosts), file_shift.x, file_shift.y, file_shift.z), flush=True)
    # Points and views of the old version are moved with the file.
    if file_shift.length > 0:
        g = (file_shift.x, file_shift.z, -file_shift.y)
        def shifted(p):
            return [p[0] + g[0], p[1] + g[1], p[2] + g[2]]
        for p in spec.get("previousAuto", []):
            p["position"], p["target"] = shifted(p["position"]), shifted(p["target"])
        if spec.get("shiftViews"):
            for v in views:
                v["position"], v["target"] = shifted(v["position"]), shifted(v["target"])
            for p in spec.get("updatePhotos", []):
                p["position"] = shifted(p["position"])

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
def indoor_probes():
    # A file without saved views: eye-height points over every covered floor (a surface facing up with
    # a ceiling 1.9 to 10 m above), kept on the level that has the most of them.
    from collections import Counter
    pts = [ob.matrix_world @ Vector(c) for ob in scene.objects if ob.type == "MESH" for c in ob.bound_box]
    if not pts:
        raise RuntimeError("Le fichier ne contient aucun objet.")
    x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
    y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
    top = max(p.z for p in pts) + 1
    n, found = 60, []
    for i in range(n):
        for j in range(n):
            x, y = x0 + (i + 0.5) / n * (x1 - x0), y0 + (j + 0.5) / n * (y1 - y0)
            o = Vector((x, y, top))
            for _ in range(8):
                h, nrm = ray_n(o, (0, 0, -1))
                if h is None:
                    break
                if nrm.z > 0.9:
                    above = ray(h + Vector((0, 0, 0.05)), (0, 0, 1))
                    if above is not None and 1.9 < above.z - h.z < 10:
                        found.append(Vector((x, y, h.z + 1.6)))
                o = h + Vector((0, 0, -0.02))
    if not found:
        raise RuntimeError("Aucune pièce couverte trouvée dans ce fichier.")
    # The level people live on, not the one with the most covered floor (29 Oct, Ouaret Aomar): a file of the whole
    # plot had 398 "covered floors" in the empty space under the terrain and all 14 points went there. A floor counts
    # when furniture stands on it (objects under 3 m starting within 2 m above it, within 2 m around).
    furniture = {}
    for ob in scene.objects:
        if ob.type != "MESH":
            continue
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        if max(max(p[k] for p in bb) - min(p[k] for p in bb) for k in range(3)) >= 3.0:
            continue
        c = sum(bb, Vector()) / 8
        furniture.setdefault((int(c.x // 2), int(c.y // 2)), []).append(min(p.z for p in bb))
    def furnished(p):
        floor_z = p.z - 1.6
        return any(floor_z - 0.05 < z < floor_z + 2.0
                   for gx in range(int(p.x // 2) - 1, int(p.x // 2) + 2) for gy in range(int(p.y // 2) - 1, int(p.y // 2) + 2)
                   for z in furniture.get((gx, gy), ()))
    levels = Counter(round(p.z, 1) for p in found)
    def score(level):
        at = [p for p in found if abs(p.z - level) < 0.15]
        return (sum(1 for p in at if furnished(p)), len(at))
    level = max(levels, key=score)
    print("TOUR_INFO levels %s -> %.1f" % (" ".join("%.1f:%d/%d" % ((z,) + score(z)) for z, _ in levels.most_common(6)), level), flush=True)
    at = [p for p in found if abs(p.z - level) < 0.15]
    # A plot with several buildings: the one with the most furnished floor, not the middle of the plot.
    lived = [p for p in at if furnished(p)] or at
    centre = max(lived, key=lambda p: sum(1 for q in lived if (q - p).length < 20))
    return [p for p in at if (p - centre).length < 25]

eyes = [to_blender(v["position"]) for v in views]
FULL = spec.get("mode", "full") == "full"
# The whole site (30 Oct, the Pool): every floor of every building and level, indoors and out, is surveyed when points
# are placed. Before, the points went on one level only, under a ceiling, and a hillside resort got them inside the hollow
# terrain blocks (the orange "corridors") while its pool courtyard had none.
SURVEY = FULL and bool(spec.get("autoViews"))
CLEAR_NEAR = float(spec.get("clearNear", 0.30))

def site_survey():
    # One pass over the whole file. A grid of columns (25 cm) is looked down through every layer: each surface facing up
    # that is not glass or water, with room for a person above it (1.75 m), under no water and under no glass within
    # 2.1 m (a pool's bottom, a glass table), is a floor. For each floor: its ceiling (the surface above it, if within
    # 10 m), whether that ceiling is glass, and how far the nearest standing surface (wall, furniture side, railing) is
    # at three heights. The ray trees of a large site are built tile by tile: the whole Pool in one tree took 9.7 GB.
    from mathutils.bvhtree import BVHTree
    t0 = time.time()
    V, T, F, OBX, OBZ, off, cache = [], [], [], [], [], 0, {}
    for ob in scene.objects:
        if ob.type != "MESH" or ob.hide_render or not ob.visible_get() or not ob.data.polygons:
            continue
        me = ob.data
        if me.name not in cache:
            me.calc_loop_triangles()
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", co)
            tri = np.empty(len(me.loop_triangles) * 3, np.int32)
            me.loop_triangles.foreach_get("vertices", tri)
            mi = np.empty(len(me.loop_triangles), np.int32)
            me.loop_triangles.foreach_get("material_index", mi)
            cache[me.name] = (co.reshape(-1, 3), tri.reshape(-1, 3), mi)
        co, tri, mi = cache[me.name]
        if len(tri) == 0:
            continue
        # 1 seen through (glass, water), 2 water by its name
        kinds = []
        for slot in ob.material_slots:
            m, k = slot.material, 0
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m is not None and m.use_nodes else None
            if b is not None and (b.inputs["Transmission Weight"].default_value > 0.5 or b.inputs["Alpha"].default_value < 0.6):
                k = 1
            if m is not None and re.search(r"water|eau|pool|piscine|swim|agua", m.name.lower()):
                k = 2
            kinds.append(k)
        mw = np.array(ob.matrix_world, np.float32)
        w = co @ mw[:3, :3].T + mw[:3, 3]
        V.append(w)
        T.append(tri + np.int32(off))
        F.append(np.array(kinds or [0], np.int8)[np.clip(mi, 0, max(0, len(kinds) - 1))])
        # Furniture, plants and fittings: an object under 4 m across and 2.6 m tall, and at least 25 cm across both ways.
        # A building or the terrain is bigger; a window frame, a railing or a post is thin (the frames along the Pool's
        # facades had drawn the points onto the paths around its buildings); a piece of wall or a door with its frame is
        # tall and thin (Ouaret's walls, one object per segment, had made his empty rooms look furnished). A wardrobe is
        # deeper.
        ext = w.max(0) - w.min(0)
        thin = min(ext[0], ext[1])
        OBX.append(np.full(len(tri), bool(max(ext[0], ext[1]) < 4.0 and thin >= 0.25 and ext[2] < 2.6 and not (ext[2] >= 1.9 and thin < 0.45)), bool))
        OBZ.append(np.full(len(tri), float(w[:, 2].min()), np.float32))
        off += len(w)
    del cache
    if not V:
        raise RuntimeError("Le fichier ne contient aucun objet.")
    V, T, F, OBX, OBZ = np.concatenate(V), np.concatenate(T), np.concatenate(F), np.concatenate(OBX), np.concatenate(OBZ)
    AREA = np.empty(len(T), np.float32)
    NZ = np.empty(len(T), np.float32)
    CEN = np.empty((len(T), 3), np.float32)
    BMIN = np.empty((len(T), 2), np.float32)
    BMAX = np.empty((len(T), 2), np.float32)
    for s in range(0, len(T), 1 << 21):
        P = V[T[s:s + (1 << 21)]]
        cr = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        AREA[s:s + len(P)] = 0.5 * np.linalg.norm(cr, axis=1)
        NZ[s:s + len(P)] = np.abs(cr[:, 2]) / np.maximum(2 * AREA[s:s + len(P)], 1e-12)
        CEN[s:s + len(P)] = P.mean(1)
        BMIN[s:s + len(P)] = P[:, :, :2].min(1)
        BMAX[s:s + len(P)] = P[:, :, :2].max(1)
    del P, cr
    lo3, hi3 = V.min(0), V.max(0)
    step = float(spec.get("surveyStep", 0.25))
    while (hi3[0] - lo3[0]) * (hi3[1] - lo3[1]) / (step * step) > 6e6:
        step *= 2
    nx, ny = int((hi3[0] - lo3[0]) / step) + 1, int((hi3[1] - lo3[1]) / step) + 1
    x0, y0 = float(lo3[0]), float(hi3[1])
    top = float(hi3[2]) + 1.0
    # 1.5 million triangles a tile: Bloc B F5 peaked at 8.6 GB with 2.5 million and was stopped for memory with a browser open.
    # Tiles go down to 8 m: Bloc B F5's furniture is packed in one corner, and its last 16 m tile held 6.6 of its 6.9 million.
    MARGIN, TILE_TRIS = 3.5, int(spec.get("surveyTileTriangles", 1500000))
    def tile_tris(i0, i1, j0, j1, margin=MARGIN):
        xa, xb, ya, yb = x0 + i0 * step - margin, x0 + i1 * step + margin, y0 - j1 * step - margin, y0 - j0 * step + margin
        return np.flatnonzero((BMAX[:, 0] >= xa) & (BMIN[:, 0] <= xb) & (BMAX[:, 1] >= ya) & (BMIN[:, 1] <= yb))
    tiles, todo = [], [(0, nx, 0, ny)]
    while todo:
        i0, i1, j0, j1 = todo.pop()
        idx = tile_tris(i0, i1, j0, j1)
        if len(idx) > TILE_TRIS and max(i1 - i0, j1 - j0) > 32:
            if i1 - i0 >= j1 - j0:
                todo += [(i0, (i0 + i1) // 2, j0, j1), ((i0 + i1) // 2, i1, j0, j1)]
            else:
                todo += [(i0, i1, j0, (j0 + j1) // 2), (i0, i1, (j0 + j1) // 2, j1)]
        else:
            tiles.append((i0, i1, j0, j1))
    print("TOUR_INFO survey %d triangles, %dx%d columns of %.2f m, %d tiles %.1fs" % (len(T), nx, ny, step, len(tiles), time.time() - t0), flush=True)
    DOWN = Vector((0.0, 0.0, -1.0))
    c_col, c_z, c_ceil, c_glass, c_gap, c_cl, c_d10, c_furn = [], [], [], [], [], [], [], []
    h_col, h_z, h_k = [], [], []
    water = {}
    for i0, i1, j0, j1 in tiles:
        # The floors are found straight down through the tile's own columns, so their tree needs nothing beyond it; only
        # the walls around them are looked for up to 3 m outside. The two trees were held together (Bloc B F5, 31 Oct:
        # 1.7 GB on its densest tile, stopped for memory): the floors' tree goes before the walls' is built.
        idx = tile_tris(i0, i1, j0, j1, 0.05)
        if len(idx) == 0:
            continue
        used, inv = np.unique(T[idx], return_inverse=True)
        tree = BVHTree.FromPolygons(V[used], inv.reshape(-1, 3), all_triangles=True)
        del used, inv
        first = len(c_z)
        for j in range(j0, j1):
            y = y0 - (j + 0.5) * step
            for i in range(i0, i1):
                x = x0 + (i + 0.5) * step
                col = j * nx + i
                o = Vector((x, y, top))
                above = above2 = glass_at = water_at = None
                above_kind = 0
                for _ in range(40):
                    loc, _n, k, _d = tree.ray_cast(o, DOWN)
                    if loc is None:
                        break
                    g = idx[k]
                    z, f, flat = loc.z, int(F[g]), bool(NZ[g] > 0.9)
                    h_col.append(col); h_z.append(z); h_k.append(f + (4 if flat else 0))
                    if f:
                        if flat:
                            if col not in water or (f == 2 and not water[col][1]):
                                water[col] = (z, f == 2)
                            if f == 2 and water_at is None:
                                water_at = z
                            if glass_at is None:
                                glass_at = z
                    elif flat and (above is None or above - z >= 1.75) and (glass_at is None or glass_at - z > 2.1) and (water_at is None or water_at - z > 4.0):
                        c_col.append(col); c_z.append(z)
                        c_ceil.append(above if above is not None and above - z < 10.0 else 1e9)
                        c_glass.append(above_kind != 0)
                        c_gap.append((above2 - above) if above2 is not None and above is not None else 1e9)
                    above2, above, above_kind = above, z, f
                    o = Vector((x, y, z - 0.02))
        del tree, idx
        widx = tile_tris(i0, i1, j0, j1)
        widx = widx[NZ[widx] < 0.7]
        used, inv = np.unique(T[widx], return_inverse=True)
        wall = BVHTree.FromPolygons(V[used], inv.reshape(-1, 3), all_triangles=True) if len(widx) else None
        del used, inv
        for n in range(first, len(c_z)):
            col = c_col[n]
            x, y, z = x0 + (col % nx + 0.5) * step, y0 - (col // nx + 0.5) * step, c_z[n]
            # furniture standing on this floor (not a ceiling light's housing coming up through a roof from below)
            def stands(g):
                return bool(OBX[g]) and z - 0.05 <= OBZ[g] <= z + 1.0
            d10, by_furniture = 9.0, False
            if wall is not None:
                near = wall.find_nearest(Vector((x, y, z + 1.0)), 3.0)
                if near[0] is not None:
                    d10 = near[3]
                    by_furniture = near[3] < 0.6 and stands(widx[near[2]])
            m = d10
            if wall is not None and m >= CLEAR_NEAR:
                for hgt in (0.3, 1.6):
                    near = wall.find_nearest(Vector((x, y, z + hgt)), 3.0)
                    if near[0] is not None:
                        m = min(m, near[3])
                        by_furniture = by_furniture or (hgt == 0.3 and near[3] < 0.6 and stands(widx[near[2]]))
            c_cl.append(m); c_d10.append(d10); c_furn.append(by_furniture)
        del wall, widx
    print("TOUR_INFO survey %d floors, %d hits %.1fs" % (len(c_z), len(h_z), time.time() - t0), flush=True)
    # the small faces of furniture, plants and fittings
    furn = (AREA < 0.05) & (F == 0) & OBX
    site = {
        "nx": nx, "ny": ny, "x0": x0, "y0": y0, "step": step, "zbase": float(lo3[2]) - 10.0,
        "col": np.array(c_col, np.int64), "z": np.array(c_z, np.float64), "ceil": np.array(c_ceil, np.float64),
        "glass": np.array(c_glass, bool), "gap": np.array(c_gap, np.float64), "cl": np.array(c_cl, np.float32), "d10": np.array(c_d10, np.float32), "furn_near": np.array(c_furn, bool),
        "hcol": np.array(h_col, np.int64), "hz": np.array(h_z, np.float64), "hk": np.array(h_k, np.int8),
        "water": water, "furn": CEN[furn].astype(np.float64), "box": (lo3, hi3),
    }
    del V, T, F, OBX, OBZ, AREA, NZ, CEN, BMIN, BMAX
    order = np.argsort(site["hcol"], kind="stable")
    for key in ("hcol", "hz", "hk"):
        site[key] = site[key][order]
    return site

def site_spaces(site):
    # Where a person can stand (clear of walls by 30 cm), joined into spaces (neighbours within 25 cm of height: steps of a
    # ramp or a slope go on, a stair or a wall stops). Each standing spot is measured for what is around it: furniture,
    # plants and fittings standing on its floor within 50 cm, and water.
    nx, step = site["nx"], site["step"]
    walk = np.flatnonzero(site["cl"] >= CLEAR_NEAR)
    col, z = site["col"][walk], site["z"][walk]
    by_col = {}
    for n in range(len(walk)):
        by_col.setdefault(int(col[n]), []).append(n)
    parent = list(range(len(walk)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for n in range(len(walk)):
        c = int(col[n])
        for nb in ((c + 1) if (c % nx) + 1 < nx else -1, c + nx):
            for m in by_col.get(nb, ()):
                if abs(z[m] - z[n]) <= 0.25:
                    a, b = find(n), find(m)
                    if a != b:
                        parent[a] = b
    roots = np.array([find(n) for n in range(len(walk))], np.int64)
    _, space = np.unique(roots, return_inverse=True) if len(roots) else (None, np.zeros(0, np.int64))
    zb = site["zbase"]
    fz = site["furn"]
    fcol = np.floor((fz[:, 0] - site["x0"]) / step).astype(np.int64) + np.floor((site["y0"] - fz[:, 1]) / step).astype(np.int64) * nx
    keys = np.sort(fcol.astype(np.float64) * 8192.0 + (fz[:, 2] - zb))
    # water: a surface seen through and lying flat under the floor (a pool, 3 cm to 1.5 m down), or one named as water up
    # to 60 cm above it (a fountain's basin); glass at the floor's height (a skylight on a roof) is not water
    wl = [(c, wz_, named) for c, (wz_, named) in site["water"].items()]
    wkeys = np.sort(np.array([c * 8192.0 + (wz_ - zb) for c, wz_, named in wl], np.float64)) if wl else np.zeros(0)
    nkeys = np.sort(np.array([c * 8192.0 + (wz_ - zb) for c, wz_, named in wl if named], np.float64))
    det = np.zeros(len(walk), np.int64)
    wet = np.zeros(len(walk), bool)
    jj, ii = col // nx, col % nx
    for dj in range(-2, 3):
        for di in range(-2, 3):
            ok = (jj + dj >= 0) & (jj + dj < site["ny"]) & (ii + di >= 0) & (ii + di < nx)
            q = (col + dj * nx + di).astype(np.float64) * 8192.0 + (z - zb)
            det += np.where(ok, np.searchsorted(keys, q + 2.2) - np.searchsorted(keys, q + 0.05), 0)
            if len(wkeys):
                wet |= ok & (np.searchsorted(wkeys, q - 0.03) > np.searchsorted(wkeys, q - 1.5))
            if len(nkeys):
                wet |= ok & (np.searchsorted(nkeys, q + 0.6) > np.searchsorted(nkeys, q - 1.5))
    covered = site["ceil"][walk] < 1e8
    return walk, space, det, wet, covered, by_col

def site_places(site, eyes):
    # Which spaces get points, grouped into levels. A space is a place to show when something is in it: a room whose
    # floor has furniture, fittings or plants on at least 2 % of it (an empty shell, the inside of a hollow terrain block,
    # a landing or an attic has none or only window frames: the Pool's buildings 0.25-0.6 %, Sarah's and Bloc B's rooms
    # 12-77 %), an outdoor area full of them (the Pool's courtyard), or a balcony or terrace with some, next to a kept
    # room at its height. Roofs, bare platforms and the ground around stay out. Outdoors only the part within 4 m of
    # the furniture or of a pool counts. A space holding one of the designer's views is always kept.
    nx, ny, step = site["nx"], site["ny"], site["step"]
    walk, space, det, wet, covered, _ = site_spaces(site)
    del site["furn"]
    wcol, wz, wcl = site["col"][walk], site["z"][walk], site["cl"][walk]
    nsp = int(space.max()) + 1 if len(space) else 0
    order = np.argsort(space, kind="stable")
    bounds = np.searchsorted(space[order], np.arange(nsp + 1))
    members = [order[bounds[s]:bounds[s + 1]] for s in range(nsp)]
    # next to furniture: the nearest standing surface within 60 cm is furniture, a plant or a fitting (so never through a
    # wall: the sofas inside the Pool's cabanas had marked the path behind them)
    furnished = site["furn_near"][walk]
    def xy_of(k):
        c = int(wcol[k])
        return site["x0"] + (c % nx + 0.5) * step, site["y0"] - (c // nx + 0.5) * step
    # the space each saved view stands in: the walkable spot within 60 cm under it whose floor is 0.3-2.6 m below the eye
    view_space = {}
    by_col = {}
    for k in range(len(walk)):
        by_col.setdefault(int(wcol[k]), []).append(k)
    for v, e in enumerate(eyes):
        ci, cj = int((e.x - site["x0"]) / step), int((site["y0"] - e.y) / step)
        best = None
        for dj in range(-2, 3):
            for di in range(-2, 3):
                for k in by_col.get((cj + dj) * nx + ci + di, ()):
                    if e.z - 2.6 < wz[k] < e.z - 0.3:
                        d = math.hypot(dj, di) + abs(e.z - 1.6 - wz[k])
                        if best is None or d < best[0]:
                            best = (d, k)
        if best is not None:
            view_space[v] = int(space[best[1]])
    held = set(view_space.values())
    # Outdoors, what draws a point is a group: a spot by furniture with 32 such spots within 2 m, on at least three sides
    # of it (a seating area, loungers, tables), or by a pool (4 m² of water within 2 m). A row of potted plants along one
    # side of a path or a narrow water channel is not (the Pool's paths around its courtyard had taken half the points).
    water_grid = np.zeros(ny * nx, np.int32)
    if site["water"]:
        water_grid[np.array(list(site["water"].keys()), np.int64)] = 1
    water_grid = water_grid.reshape(ny, nx)
    def box(a, r):
        # the sum over a (2r+1) square around each cell
        c = np.pad(a, ((r + 1, r), (r + 1, r))).cumsum(0).cumsum(1)
        return c[2 * r + 1:, 2 * r + 1:] - c[:-2 * r - 1, 2 * r + 1:] - c[2 * r + 1:, :-2 * r - 1] + c[:-2 * r - 1, :-2 * r - 1]
    def sides(a, r):
        # in how many of the four quarters around each cell (r cells out) a holds at least 4
        h, w = a.shape
        c = np.zeros((h + 1, w + 1), np.int64)
        c[1:, 1:] = a.cumsum(0).cumsum(1)
        jj, ii = np.mgrid[0:h, 0:w]
        def rect(j0, j1, i0, i1):
            j0, j1, i0, i1 = np.clip(j0, 0, h), np.clip(j1, 0, h), np.clip(i0, 0, w), np.clip(i1, 0, w)
            return c[j1, i1] - c[j0, i1] - c[j1, i0] + c[j0, i0]
        quarters = (rect(jj - r, jj, ii - r, ii + 1), rect(jj - r, jj + 1, ii + 1, ii + r + 1), rect(jj + 1, jj + r + 1, ii, ii + r + 1), rect(jj, jj + r + 1, ii - r, ii))
        return sum((q >= 4).astype(np.int32) for q in quarters)
    water_near = box(water_grid, 8).reshape(-1)
    seed = np.zeros(len(walk), bool)
    stats = []
    for s in range(nsp):
        m = members[s]
        cov = float(covered[m].mean())
        if cov < 0.5:
            jj, ii = wcol[m] // nx, wcol[m] % nx
            j0, i0 = int(jj.min()), int(ii.min())
            local = np.zeros((int(jj.max()) - j0 + 1, int(ii.max()) - i0 + 1), np.int32)
            local[jj - j0, ii - i0] = furnished[m]
            seed[m] = (furnished[m] & (box(local, 8)[jj - j0, ii - i0] >= 32) & (sides(local, 8)[jj - j0, ii - i0] >= 3)) | (wet[m] & (water_near[wcol[m]] >= 64))
        stats.append({"n": len(m), "covered": cov, "furn": int(furnished[m].sum()), "wet": int(wet[m].sum()), "seeds": int(seed[m].sum()), "z": float(np.median(wz[m]))})
    keep = {}
    for s, st in enumerate(stats):
        indoor = st["covered"] >= 0.5
        if s in held:
            keep[s] = "view"
        elif indoor and st["furn"] >= 4 and (st["furn"] >= 0.02 * st["n"] or st["furn"] >= 150):
            keep[s] = "room"
        elif not indoor and st["seeds"] >= 40 and st["furn"] >= 10:
            keep[s] = "outdoor"
    # balconies and terraces: some furniture, beside a kept room at the same height (within 3 m)
    rooms_2d = {}
    for s, why in keep.items():
        if stats[s]["covered"] >= 0.5:
            rooms_2d.setdefault(round(stats[s]["z"] * 2) / 2, []).append(s)
    for s, st in enumerate(stats):
        if s in keep or st["covered"] >= 0.5 or st["furn"] < 10:
            continue
        near_rooms = [r for zk, rs in rooms_2d.items() if abs(zk - st["z"]) < 0.6 for r in rs]
        if not near_rooms:
            continue
        grid = np.zeros(ny * nx, bool)
        for r in near_rooms:
            grid[wcol[members[r]]] = True
        grid = grid.reshape(ny, nx)
        for _ in range(12):
            g = grid.copy()
            g[1:, :] |= grid[:-1, :]; g[:-1, :] |= grid[1:, :]; g[:, 1:] |= grid[:, :-1]; g[:, :-1] |= grid[:, 1:]
            grid = g
        if grid.reshape(-1)[wcol[members[s]]].any():
            keep[s] = "terrace"
    # The top of a big table, a daybed or a counter is clear enough to stand on (Restaurant's tables, the Pool's daybeds):
    # a small "space" standing more than 30 cm over the floor people stand on around it (within 2 m). A small room (a
    # bathroom a step up or down) is at the height of the floor beside it.
    wgrid = {}
    for k in range(len(wcol)):
        wgrid.setdefault(int(wcol[k]), []).append(k)
    for s in list(keep):
        if keep[s] == "view" or stats[s]["n"] * step * step >= 6.0:
            continue
        m = members[s]
        mine = set(int(c) for c in wcol[m])
        around = []
        for c in mine:
            for dj in range(-8, 9, 2):
                for di in range(-8, 9, 2):
                    nb = c + dj * nx + di
                    if nb not in mine:
                        around += [float(wz[k]) for k in wgrid.get(nb, ()) if space[k] != s and abs(wz[k] - stats[s]["z"]) < 2.0]
        if around and float(np.median(around)) < stats[s]["z"] - 0.3:
            del keep[s]
    del wgrid
    if not keep:
        # Nothing furnished anywhere (a file merged into a few big objects): every covered space of the level with the
        # most covered floor, as before 30 Oct.
        cov_z = {}
        for s, st in enumerate(stats):
            if st["covered"] >= 0.5:
                cov_z[round(st["z"] * 2) / 2] = cov_z.get(round(st["z"] * 2) / 2, 0) + st["n"]
        if cov_z:
            zk = max(cov_z, key=cov_z.get)
            for s, st in enumerate(stats):
                if st["covered"] >= 0.5 and abs(round(st["z"] * 2) / 2 - zk) < 0.6:
                    keep[s] = "room"
    # outdoors, the part within 3 m of those groups (of its furniture, on a balcony or terrace beside a room)
    cells = {}
    for s, why in keep.items():
        m = members[s]
        if stats[s]["covered"] >= 0.5 or why == "view":
            cells[s] = m
            continue
        pos = {int(wcol[k]): n for n, k in enumerate(m)}
        dist = np.full(len(m), 99, np.int32)
        from collections import deque
        q = deque()
        for n, k in enumerate(m):
            if seed[k] or (why == "terrace" and furnished[k]):
                dist[n] = 0
                q.append(n)
        while q:
            n = q.popleft()
            if dist[n] >= 12:
                continue
            c = int(wcol[m[n]])
            for nb in (c + 1, c - 1, c + nx, c - nx):
                o = pos.get(nb)
                if o is not None and dist[o] > dist[n] + 1:
                    dist[o] = dist[n] + 1
                    q.append(o)
        cells[s] = m[dist <= 12]
    for s in list(cells):
        if len(cells[s]) * step * step < float(spec.get("minArea", 0.4)):
            del cells[s], keep[s]
    print("TOUR_INFO places %s" % " ".join("%s:%.0fm2@%.1f" % (keep[s], len(cells[s]) * step * step, stats[s]["z"]) for s in sorted(cells, key=lambda s: -len(cells[s]))[:16]), flush=True)
    # levels: kept spaces by height, a new level more than 1.5 m above the last
    zs = sorted(cells, key=lambda s: stats[s]["z"])
    groups = []
    for s in zs:
        if groups and stats[s]["z"] - groups[-1]["z0"] < 1.5:
            groups[-1]["spaces"].append(s)
        else:
            groups.append({"z0": stats[s]["z"], "spaces": [s]})
    for v, e in enumerate(eyes):
        if v not in view_space:
            fz = e.z - 1.6
            g = min(groups, key=lambda g: abs(g["z0"] - fz)) if groups else None
            if g is None or abs(g["z0"] - fz) > 1.5:
                groups.append({"z0": fz, "spaces": []})
    levels = []
    for g in sorted(groups, key=lambda g: g["z0"]):
        ks = np.concatenate([cells[s] for s in g["spaces"]]) if g["spaces"] else np.zeros(0, np.int64)
        cov = ks[covered[ks]] if len(ks) else ks
        base = cov if len(cov) else ks
        fl = float(np.median(wz[base])) if len(base) else g["z0"]
        ceils = site["ceil"][walk[cov]] if len(cov) else np.zeros(0)
        ce = float(np.median(ceils)) if len(ceils) else fl + 2.9
        levels.append({"floor": fl, "ceil": ce, "cut": min(ce - 0.25, fl + 1.6), "spaces": g["spaces"]})
    for L in levels:
        L["outdoor"] = all(stats[s]["covered"] < 0.5 for s in L["spaces"]) and bool(L["spaces"])
    return {"walk": walk, "space": space, "wcol": wcol, "wz": wz, "wcl": wcl, "covered": covered, "cells": cells, "keep": keep,
            "stats": stats, "levels": levels, "view_space": view_space, "xy_of": xy_of, "seed": seed, "furnished": furnished, "wet": wet, "det": det}

if not SURVEY:
    # The saved views give the floor, the ceiling and the plan's frame; without them, the covered floors do.
    probes = eyes or indoor_probes()
    floors = sorted(h.z for h in (ray(e, (0, 0, -1)) for e in probes) if h is not None)
    ceils = sorted(h.z for h in (ray(e, (0, 0, 1)) for e in probes) if h is not None)
    eye_z = sorted(e.z for e in probes)[len(probes) // 2]
    floor = floors[len(floors) // 2] if floors else eye_z - 1.5
    ceil = ceils[len(ceils) // 2] if ceils else floor + 2.9
    cut = min(ceil - 0.25, floor + 1.6)

    # The plan covers the objects of this floor around the viewpoints.
    cx = sum(e.x for e in probes) / len(probes)
    cy = sum(e.y for e in probes) / len(probes)
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
    for e in probes:
        lo.x, lo.y = min(lo.x, e.x - 1), min(lo.y, e.y - 1)
        hi.x, hi.y = max(hi.x, e.x + 1), max(hi.y, e.y + 1)
    pad = 0.6
    lo.x, lo.y, hi.x, hi.y = lo.x - pad, lo.y - pad, hi.x + pad, hi.y + pad
    SURFACE_Z = (floor, ceil)

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

if FULL:
    from collections import deque
    EYE = 1.6
    def solid(o, d, maxd):
        hit, loc = scene.ray_cast(depsgraph, o, Vector(d), distance=maxd)[:2]
        return (loc - o).length if hit else None
    meta = {"views": [], "auto": [], "links": []}
    all_eyes = list(eyes)
    if SURVEY:
        site = site_survey()
        P = site_places(site, eyes)
        LEVELS = P["levels"]
    else:
        P = None
        LEVELS = [{"floor": floor, "ceil": ceil, "cut": cut, "spaces": [], "outdoor": False}]
    def level_of(zfloor):
        return min(range(len(LEVELS)), key=lambda n: abs(LEVELS[n]["floor"] - zfloor))
    space_level = {s: n for n, L in enumerate(LEVELS) for s in L["spaces"]}
    for i, v in enumerate(views):
        e, t = eyes[i], to_blender(v["target"])
        # SketchUp scenes often hide a wall to look into a room; the export keeps the wall. A camera
        # with no ceiling above it is outside the building, one with a wall right in front sees only that wall.
        up = ray(e, (0, 0, 1))
        ahead = ray(e, (t - e).normalized())
        s = P["view_space"].get(i) if P else None
        meta["views"].append({
            "index": i,
            "outside": up is None or up.z - e.z > 6,
            "facesWall": ahead is not None and (ahead - e).length < 1.2,
            # heading of the saved view in Blender's floor plane; the panorama is centred on it
            "yaw": math.atan2(t.y - e.y, t.x - e.x),
            "level": space_level[s] if s in space_level else level_of(e.z - EYE),
        })
    placed = []
    if SURVEY:
        # 2. Automatic viewpoints, not limited to the designer's scenes (ChatGPT's walkable-grid plan, 24 Oct), in every
        # kept space of every level. Points only where they add something (ChatGPT, 25 Oct): a 360° already shows a
        # whole room, so a normal room gets one point, or none when one of the designer's good views stands in it; a
        # large space gets points until every spot is within COVER of one (6 m outdoors). The designer's views count as
        # points already placed.
        nx, ny, step = site["nx"], site["ny"], site["step"]
        wcol, wz, wcl = P["wcol"], P["wz"], P["wcl"]
        def wxy(ks):
            c = wcol[ks]
            return np.stack([site["x0"] + (c % nx + 0.5) * step, site["y0"] - (c // nx + 0.5) * step], 1)
        SPACING = float(spec.get("autoSpacing", 2.8))
        COVER = max(SPACING, float(spec.get("autoCover", 4.0)))
        COVER_OUT = max(COVER, float(spec.get("autoCoverOut", 6.0)))
        SMALL_ROOM = float(spec.get("smallRoom", 18.0))
        ROOMY = float(spec.get("roomyClearance", 0.9))
        MIN_AREA = float(spec.get("minArea", 0.4))
        inside_saved = [(k, eyes[k]) for k, v in enumerate(meta["views"]) if not v["outside"]]
        # The points of the previous build of the same file (ChatGPT, 25 Oct; 31 Oct): a tour the operator has seen keeps
        # its points where they are, with their names, edits and AI 360°, as long as they still stand in a kept space
        # (within 35 cm, the grid may have moved), in a small room within 3 m of one, or have an approved AI 360°. They
        # count as points already placed, and new ones only go where nothing covers yet (a balcony, a terrace, another
        # level). The Pool's old points, in its empty buildings, go.
        same = bool(spec.get("previousSame"))
        prev = []
        for p in spec.get("previousAuto", []):
            pe, pt_ = to_blender(p["position"]), to_blender(p["target"])
            prev.append((pe, math.atan2(pt_.y - pe.y, pt_.x - pe.x), bool(p.get("keep")), bool(p.get("approved"))))
        wby_col = {}
        for k in range(len(wcol)):
            wby_col.setdefault(int(wcol[k]), []).append(k)
        kept_k = set(np.concatenate([P["cells"][s] for s in P["cells"]]).tolist()) if P["cells"] else set()
        def standing(p, r=1):
            # the kept walkable spots within r cells of p, on its floor
            ci, cj = int((p.x - site["x0"]) / step), int((site["y0"] - p.y) / step)
            return [k for dj in range(-r, r + 1) for di in range(-r, r + 1) for k in wby_col.get((cj + dj) * nx + ci + di, ())
                    if k in kept_k and abs(wz[k] + EYE - p.z) < 0.8]
        cand_by_col = {}
        for k in range(len(site["z"])):
            cand_by_col.setdefault(int(site["col"][k]), []).append(k)
        def cramped(p):
            # a floor right there with 15 cm of room (the old placement's grid sat a few centimetres off this one)
            ci, cj = int((p.x - site["x0"]) / step), int((site["y0"] - p.y) / step)
            return any(site["cl"][k] >= 0.15 and abs(site["z"][k] + EYE - p.z) < 0.8 for dj in (-1, 0, 1) for di in (-1, 0, 1) for k in cand_by_col.get((cj + dj) * nx + ci + di, ()))
        kept_floors = [L["floor"] for L in LEVELS if L["spaces"]]
        def indoors_on_level(p):
            # under a ceiling, on the floor of a kept level (a small room that no longer counts as furnished keeps the
            # point the operator has seen; a point inside a hollow terrain block, on no kept level, does not)
            ci, cj = int((p.x - site["x0"]) / step), int((site["y0"] - p.y) / step)
            return any(site["cl"][k] >= 0.15 and site["ceil"][k] < 1e8 and abs(site["z"][k] + EYE - p.z) < 0.8 and min([abs(site["z"][k] - f) for f in kept_floors] or [9]) < 0.5
                       for dj in (-1, 0, 1) for di in (-1, 0, 1) for k in cand_by_col.get((cj + dj) * nx + ci + di, ()))
        def in_empty_room(p):
            # standing in a room of 6 m² or more that the survey found empty (the Pool's bare buildings, whose long orange
            # insides held its 14 old points): the point goes
            ci, cj = int((p.x - site["x0"]) / step), int((site["y0"] - p.y) / step)
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    for k in wby_col.get((cj + dj) * nx + ci + di, ()):
                        s_ = int(P["space"][k])
                        if abs(wz[k] + EYE - p.z) < 0.8 and s_ not in P["keep"] and P["stats"][s_]["n"] * step * step >= 6.0:
                            return True
            return False
        fixed = [j for j, (pe, yaw, keep, approved) in enumerate(prev)
                 if same and ((keep and approved) or (not in_empty_room(pe) and (standing(pe) or (cramped(pe) and standing(pe, 4)) or (indoors_on_level(pe) and standing(pe, 12)))))]
        del cand_by_col
        print("TOUR_INFO previous points: %d of %d stay" % (len(fixed), len(prev)), flush=True)
        inside_saved += [(-1 - j, prev[j][0]) for j in fixed]
        per_space = []
        for s in sorted(P["cells"], key=lambda s: -len(P["cells"][s])):
            ks = P["cells"][s]
            area = len(ks) * step * step
            if area < MIN_AREA:
                continue
            outdoor = P["stats"][s]["covered"] < 0.5
            pts, cl, zz = wxy(ks), wcl[ks], wz[ks]
            here = float(np.median(zz))
            dmin = np.full(len(pts), 99.0)
            saved_here = False
            for k, e in inside_saved:
                if abs(e.z - EYE - here) > 1.0 and P["view_space"].get(k) != s:
                    continue
                d = np.hypot(pts[:, 0] - e.x, pts[:, 1] - e.y)
                dmin = np.minimum(dmin, d)
                # a view stands in for the room only from a spot a person could stand on (not from
                # inside a wardrobe or pressed against a wall next to the room)
                saved_here = saved_here or d.min() < 0.2 or P["view_space"].get(k) == s
            cover = COVER_OUT if outdoor else COVER
            chosen = []
            if area < SMALL_ROOM:
                if not saved_here:
                    chosen.append(int(np.argmax(np.minimum(cl, 1.5))))
            else:
                # Farthest from the other points alone is always against a wall: Ecolodge Points 5-7 stood in a
                # row 60 cm from the end wall, Restaurant Point 1 in a corner (27 Oct). Only cells with room
                # around them compete: 0.9 m of clearance, less in a narrow space.
                roomy = cl >= min(ROOMY, 0.7 * float(cl.max()))
                # Coverage first (29 Oct, Restaurant): taking only roomy cells stopped as soon as the open aisles had
                # points, and a hall full of tables kept 5. The farthest uncovered cell says where a point is
                # missing; the point itself goes to the best spot within 1.5 m of it, roomy if there is one.
                if dmin.min() > 50:
                    # nothing in this space yet: its first point stands in its most open spot
                    k = int(np.argmax(np.where(roomy, np.minimum(cl, 3.0), -1.0)))
                    chosen.append(k)
                    dmin = np.hypot(pts[:, 0] - pts[k, 0], pts[:, 1] - pts[k, 1])
                while True:
                    far = int(np.argmax(dmin))
                    if dmin[far] < cover:
                        break
                    near = np.hypot(pts[:, 0] - pts[far, 0], pts[:, 1] - pts[far, 1]) < 1.5
                    score = np.where(near, np.minimum(dmin, 4.0) + 0.3 * np.minimum(cl, 1.5) + np.where(roomy, 1.0, 0.0), -9.0)
                    k = int(np.argmax(score))
                    chosen.append(k)
                    dmin = np.minimum(dmin, np.hypot(pts[:, 0] - pts[k, 0], pts[:, 1] - pts[k, 1]))
                    dmin[near] = np.minimum(dmin[near], cover - 0.01)
            if outdoor and chosen:
                # An outdoor point has to see what drew it there: at least 6 of the 24 nearest spots of its groups (or of its
                # furniture, on a terrace) at eye height (the strip behind the Pool's cabanas was within reach of its pool
                # through a gap, and saw only their backs and a row of plants).
                targets = ks[P["seed"][ks]] if P["seed"][ks].any() else ks[P["furnished"][ks]]
                tp, tz = wxy(targets), wz[targets]
                seeing = []
                for k in chosen:
                    if not len(targets):
                        break
                    d = np.hypot(tp[:, 0] - pts[k, 0], tp[:, 1] - pts[k, 1])
                    near = np.argsort(d)[:24]
                    e = Vector((float(pts[k, 0]), float(pts[k, 1]), float(zz[k]) + EYE))
                    seen_n = 0
                    for t in near:
                        g = Vector((float(tp[t, 0]), float(tp[t, 1]), float(tz[t]) + 0.6))
                        if (g - e).length < 0.3 or solid(e, (g - e).normalized(), (g - e).length - 0.05) is None:
                            seen_n += 1
                    if seen_n >= min(6, len(near)):
                        seeing.append(k)
                chosen = seeing
            per_space.append(([(pts[k], float(cl[k]), float(zz[k])) for k in chosen], area, outdoor, P["stats"][s]["furn"] + 4 * P["stats"][s]["seeds"]))
        # A space under 2 m² is mostly a corner of a room cut off by furniture, already seen from that room's
        # point (Bloc B F5 went from 12 to 22 stops, 26 Oct); it keeps its point only when no other viewpoint
        # sees it, like a small bathroom behind its wall (Bloc B F2). Outdoors the same up to 6 m² (a balcony seen
        # through its door).
        def small(sp):
            return sp[1] < (6.0 if sp[2] else 2.0)
        lookouts = [e for _, e in inside_saved] + [Vector((float(p[0]), float(p[1]), z + EYE)) for sp in per_space if not small(sp) for p, _, z in sp[0]]
        def seen(p, z):
            e = Vector((float(p[0]), float(p[1]), z + EYE))
            for o in lookouts:
                d = (e - o).length
                if d < 0.3 or (d < 8.0 and solid(o, (e - o).normalized(), d) is None):
                    return True
            return False
        # Small spaces come last: they never take the place of a large space's points under the cap (the Pool's cabanas,
        # nooks between sofas behind curtains, had taken half of them).
        # The most furnished spaces first (a building with one furnished show flat and empty ones around it: the show flat
        # is covered before an empty balcony gets a point); a space with under a tenth of the best one's furniture waits,
        # like a small space, until the others are covered.
        best = max([sp[3] for sp in per_space] or [0])
        per_space.sort(key=lambda sp: -sp[3])
        smalls = [sp[0] for sp in per_space if not small(sp) and sp[3] < 0.1 * best] + [sp[0] for sp in per_space if small(sp) and not any(seen(p, z) for p, _, z in sp[0])]
        per_space = [sp[0] for sp in per_space if not small(sp) and sp[3] >= 0.1 * best]
        # Every space gets its first point before any space gets a second one, up to the cap: more for a site with
        # several levels or outdoor areas.
        cap = int(spec.get("autoMax", 16))
        used_levels = len({level_of(z) for sp in per_space + smalls for _, _, z in sp})
        outdoors = any(P["stats"][s]["covered"] < 0.5 for s in P["cells"])
        if used_levels > 1 or outdoors:
            cap = min(int(spec.get("autoMaxSite", 32)), cap + 6 * (used_levels - 1) + (6 if outdoors else 0))
        free = max(0, cap - len(fixed))
        picked, rank = [], 0
        while len(picked) < free and any(rank < len(sp) for sp in per_space):
            for sp in per_space:
                if rank < len(sp) and len(picked) < free:
                    picked.append(sp[rank])
            rank += 1
        rank = 0
        while len(picked) < free and any(rank < len(sp) for sp in smalls):
            for sp in smalls:
                if rank < len(sp) and len(picked) < free:
                    picked.append(sp[rank])
            rank += 1
        print("TOUR_INFO points %d new + %d kept (cap %d) on %d levels" % (len(picked), len(fixed), cap, used_levels), flush=True)
        for j in fixed:
            pe, yaw = prev[j][0], prev[j][1]
            near = standing(pe)
            placed.append((np.array([pe.x, pe.y]), max([float(wcl[k]) for k in near] or [0.0]), j, yaw, pe.z - EYE))
        placed += [(pt, cl, None, None, z) for pt, cl, z in picked]
        # Each level on its plan (27 Oct, Sarah's reference plans show the flat alone): its kept spaces, grown cell by
        # cell through everything a person sees over (beds, counters, railings: floors up to 1.3 m above the level's) but
        # not through walls, tall cupboards or closed doors (a standing surface through the cell at 1 m), nor onto
        # another space's floor. An empty flat next door, the landing or a bare roof stays off the plan.
        all_col = {}
        for k in range(len(site["z"])):
            all_col.setdefault(int(site["col"][k]), []).append(k)
        walk_set = set(P["walk"].tolist())
        kept_set = set(P["walk"][np.concatenate([P["cells"][s] for s in P["cells"]])].tolist()) if P["cells"] else set()
        for n, L in enumerate(LEVELS):
            mask = np.zeros(ny * nx, bool)
            seeds = [int(P["walk"][k]) for s in L["spaces"] for k in P["cells"][s]]
            # and from every point on this level (a kept old point in a small room that no longer counts as furnished)
            for pt, _, _, _, z in placed:
                if level_of(z) != n:
                    continue
                ci, cj = int((pt[0] - site["x0"]) / step), int((site["y0"] - pt[1]) / step)
                seeds += [o for dj in (-1, 0, 1) for di in (-1, 0, 1) for o in all_col.get((cj + dj) * nx + ci + di, ()) if abs(site["z"][o] - z) < 0.3]
            lo_z, hi_z = L["floor"] - 0.3, L["floor"] + 1.3
            seen_c = set(seeds)
            q = deque(seeds)
            for c in seeds:
                mask[site["col"][c]] = True
            while q:
                c = q.popleft()
                col = int(site["col"][c])
                for nb in ((col + 1) if (col % nx) + 1 < nx else -1, (col - 1) if col % nx else -1, col + nx, col - nx):
                    for o in all_col.get(nb, ()):
                        if o in seen_c or not (lo_z <= site["z"][o] <= hi_z):
                            continue
                        if (o in walk_set and o not in kept_set) or (o not in walk_set and site["d10"][o] < 0.13):
                            continue
                        seen_c.add(o)
                        mask[nb] = True
                        q.append(o)
            L["mask"] = mask.reshape(ny, nx)
            # its rooms (indoor kept spaces of 2 m² and more): only their ceilings get the cover, not an umbrella, a pergola,
            # a cabana's nook or a corridor around a tiled box that stops short of the ceiling (Bloc B F2: the cover showed
            # through the gap as a black wedge)
            indoor = np.zeros(ny * nx, bool)
            for s in L["spaces"]:
                if P["stats"][s]["covered"] >= 0.5 and len(P["cells"][s]) * step * step >= 2.0:
                    indoor[wcol[P["cells"][s]]] = True
            L["indoor"] = indoor.reshape(ny, nx)
        del all_col
    # The frame of each level's plan: what it shows, 1 m around (and the designer's views on it).
    for n, L in enumerate(LEVELS):
        pts = []
        if SURVEY and L["mask"].any():
            jj, ii = np.nonzero(L["mask"])
            pts += [(site["x0"] + ii.min() * step, site["y0"] - (jj.max() + 1) * step), (site["x0"] + (ii.max() + 1) * step, site["y0"] - jj.min() * step)]
        pts += [(e.x - 1, e.y - 1) for k, e in enumerate(eyes) if meta["views"][k]["level"] == n] + [(e.x + 1, e.y + 1) for k, e in enumerate(eyes) if meta["views"][k]["level"] == n]
        pts += [(p[0] - 1, p[1] - 1) for p, _, _, _, z in placed if level_of(z) == n] + [(p[0] + 1, p[1] + 1) for p, _, _, _, z in placed if level_of(z) == n]
        if not SURVEY:
            pts += [(lo.x, lo.y), (hi.x, hi.y)]
        if not pts:
            pts = [(0.0, 0.0), (1.0, 1.0)]
        pad = 1.0 if SURVEY else 0.0
        L["lo"] = Vector((min(p[0] for p in pts) - pad, min(p[1] for p in pts) - pad, 0.0))
        L["hi"] = Vector((max(p[0] for p in pts) + pad, max(p[1] for p in pts) + pad, 0.0))
        width, height = L["hi"].x - L["lo"].x, L["hi"].y - L["lo"].y
        if width >= height:
            L["plan_w"], L["plan_h"] = int(spec["planSize"]), max(1, round(spec["planSize"] * height / width))
        else:
            L["plan_w"], L["plan_h"] = max(1, round(spec["planSize"] * width / height)), int(spec["planSize"])
    def plan_xy(p, n):
        L = LEVELS[n]
        return ((p.x - L["lo"].x) / (L["hi"].x - L["lo"].x) * L["plan_w"], (L["hi"].y - p.y) / (L["hi"].y - L["lo"].y) * L["plan_h"])
    for i, v in enumerate(views):
        n = meta["views"][i]["level"]
        x, y = plan_xy(eyes[i], n)
        tx, ty = plan_xy(to_blender(v["target"]), n)
        meta["views"][i]["plan"] = {"x": x, "y": y, "angle": math.degrees(math.atan2(ty - y, tx - x))}
    # Starting direction: the most open way at eye height (windows count as open).
    for n, (pt, cl, j, yaw, z) in enumerate(placed):
        e = Vector((float(pt[0]), float(pt[1]), z + EYE))
        angles = np.linspace(0, 2 * math.pi, 24, endpoint=False)
        reach = []
        for a in angles:
            h = ray(e, (math.cos(a), math.sin(a), 0.0))
            reach.append(min(8.0, (h - e).length) if h is not None else 8.0)
        reach = np.array(reach)
        smooth = reach + 0.5 * (np.roll(reach, 1) + np.roll(reach, -1)) + 0.25 * (np.roll(reach, 2) + np.roll(reach, -2))
        a = float(angles[int(np.argmax(smooth))]) if yaw is None else yaw
        if yaw is None and SURVEY and ray(e, (0, 0, 1)) is None:
            # Outdoors the most open way is the empty ground or the sky: the point faces what drew it there instead, the
            # furniture and pools within 12 m on its level.
            sk = np.flatnonzero(P["seed"] & (np.abs(P["wz"] - z) < 1.0))
            if len(sk):
                sp_ = wxy(sk)
                close = np.hypot(sp_[:, 0] - e.x, sp_[:, 1] - e.y) < 12.0
                if close.any():
                    c = sp_[close].mean(0)
                    if math.hypot(c[0] - e.x, c[1] - e.y) > 0.5:
                        a = math.atan2(c[1] - e.y, c[0] - e.x)
        t = e + Vector((math.cos(a), math.sin(a), 0.0)) * 2.0
        lv = level_of(z)
        x, y = plan_xy(e, lv)
        tx, ty = plan_xy(t, lv)
        meta["auto"].append({
            "index": len(views) + n,
            "position": [e.x, e.z, -e.y],
            "target": [t.x, t.z, -t.y],
            "yaw": a,
            "clearance": float(cl),
            "previous": j,
            "level": lv,
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
    # The main level (the designer's views, else the most points) keeps the plain file names; the others get "-n<level>".
    counts = [sum(1 for v in meta["views"] if v["level"] == n and not v["outside"]) * 100 + sum(1 for a in meta["auto"] if a["level"] == n) for n in range(len(LEVELS))]
    MAIN = int(np.argmax(counts))
    shown = [n for n in range(len(LEVELS)) if counts[n] > 0 or n == MAIN]
    # 3. The plans, rendered last: the survey's trees are freed by now, so the two never take memory together
    # (Bloc B F5 reached 12-13 GB of 16 with both, 26 Oct).
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    scene.render.film_transparent = True
    # A clean architect's plan (ChatGPT, 26 Oct), from the geometry only: even light from straight above instead
    # of the afternoon sun, and nothing that starts above 1.2 m (ceilings, hanging lamps, wall cupboards).
    # The room lamps are off too: seen from above they burn white pools into the floor (27 Oct).
    # Rendered at twice the size for the download; the tour shows a reduced copy.
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
        for nd in mat.node_tree.nodes:
            if nd.type == "BSDF_PRINCIPLED":
                for key in ("Specular IOR Level", "Coat Weight"):
                    inp = nd.inputs.get(key)
                    if inp is not None and not inp.is_linked:
                        shine.append((inp, inp.default_value))
                        inp.default_value = 0.0
    meta["levels"] = []
    for n in shown:
        L = LEVELS[n]
        sfx = "" if n == MAIN else "-n%d" % n
        lo_, hi_ = L["lo"], L["hi"]
        width, height = hi_.x - lo_.x, hi_.y - lo_.y
        plan_w, plan_h, cut_ = L["plan_w"], L["plan_h"], L["cut"]
        hidden = []
        for ob in scene.objects:
            if ob.hide_render or ob.name == "plan_top":
                continue
            if ob.type == "LIGHT" or (ob.type == "MESH" and min((ob.matrix_world @ Vector(c)).z for c in ob.bound_box) > L["floor"] + 1.2):
                ob.hide_render = True
                hidden.append(ob)
        cam_data.ortho_scale = max(width, height)
        cam.matrix_world = Matrix.Translation(Vector(((lo_.x + hi_.x) / 2, (lo_.y + hi_.y) / 2, cut_)))
        scene.render.resolution_x, scene.render.resolution_y = round(plan_w * PLAN_SCALE), round(plan_h * PLAN_SCALE)
        scene.render.filepath = os.path.join(out_dir, "plan-hd%s.png" % sfx)
        bpy.ops.render.render(write_still=True)
        for ob in hidden:
            ob.hide_render = False
        # The walls and everything else the cut goes through, as exact lines (an architect's section): every triangle
        # that crosses the cut height gives one segment, in the pixels of the large plan. Drawn on it afterwards.
        segs = []
        for ob in scene.objects:
            if ob.type != "MESH" or not ob.visible_get() or ob.hide_render:
                continue
            # quick reject: the object's box does not reach the cut, or is off the plan
            bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
            if min(p.z for p in bb) > cut_ or max(p.z for p in bb) < cut_ or max(p.x for p in bb) < lo_.x or min(p.x for p in bb) > hi_.x or max(p.y for p in bb) < lo_.y or min(p.y for p in bb) > hi_.y:
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
            dz = t[:, :, 2] - (cut_ - 0.0007)
            cross = (dz.min(1) < 0) & (dz.max(1) > 0)
            if not cross.any():
                continue
            t, dz = t[cross], dz[cross]
            # a triangle standing over a metre tall is a wall, a door or a tall cupboard side, not furniture
            tall = (t[:, :, 2].max(1) - t[:, :, 2].min(1) >= 1.0).astype(np.float32)[:, None]
            ends = []
            for e0, e1 in ((0, 1), (1, 2), (2, 0)):
                a0, a1 = dz[:, e0], dz[:, e1]
                hit = (a0 * a1) < 0
                f = np.where(hit, a0 / np.where(hit, a0 - a1, 1), 0)[:, None]
                ends.append((t[:, e0, :2] + f * (t[:, e1, :2] - t[:, e0, :2]), hit))
            # each crossing triangle cuts exactly two of its edges
            first = np.where(ends[0][1][:, None], ends[0][0], ends[1][0])
            second = np.where(ends[2][1][:, None], ends[2][0], ends[1][0])
            segs.append(np.concatenate([first, second, tall], 1))
        S = np.concatenate(segs) if segs else np.zeros((0, 5), np.float32)
        sx, sy = plan_w * PLAN_SCALE / width, plan_h * PLAN_SCALE / height
        S = np.stack([(S[:, 0] - lo_.x) * sx, (hi_.y - S[:, 1]) * sy, (S[:, 2] - lo_.x) * sx, (hi_.y - S[:, 3]) * sy, S[:, 4]], 1).astype(np.float32)
        np.save(os.path.join(out_dir, "plan-lines%s.npy" % sfx), S)
        entry = {"index": n, "suffix": sfx, "main": n == MAIN, "floor": L["floor"], "ceil": L["ceil"], "cut": cut_, "width": plan_w, "height": plan_h,
                 "mpp": width / plan_w, "frame": [lo_.x, lo_.y, hi_.x, hi_.y], "outdoor": bool(L["outdoor"])}
        if SURVEY:
            np.save(os.path.join(out_dir, "plan-rooms%s.npy" % sfx), L["mask"].astype(np.uint8))
            entry["rooms"] = {"x0": site["x0"], "y0": site["y0"], "step": step}
        meta["levels"].append(entry)
        if n == MAIN:
            meta["plan"] = dict(entry)
        print("TOUR_INFO plan level %d floor %.2f: %d section segments, %d points" % (n, L["floor"], len(S), sum(1 for a in meta["auto"] if a["level"] == n)), flush=True)
    for inp, value in shine:
        inp.default_value = value
    scene.eevee.taa_render_samples, rt.resolution_scale, scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure = face_look
    bpy.data.objects.remove(top)
    if energy > 0:
        sun_data.energy = sun_energy
    bg.inputs[0].default_value, bg.inputs[1].default_value = world_light
    # What the code below knows as "the floor": the main level, and all levels for the mirrors' tree.
    floor, ceil, cut = LEVELS[MAIN]["floor"], LEVELS[MAIN]["ceil"], LEVELS[MAIN]["cut"]
    lo = Vector((min(L["lo"].x for L in LEVELS), min(L["lo"].y for L in LEVELS), 0.0))
    hi = Vector((max(L["hi"].x for L in LEVELS), max(L["hi"].y for L in LEVELS), 0.0))
    SURFACE_Z = (min(L["floor"] for L in LEVELS), max(L["ceil"] for L in LEVELS))
    eye_z = floor + EYE
    print("TOUR_STEP plan", flush=True)
    print("TOUR_TIME plan", flush=True)
    with open(os.path.join(out_dir, "tour-blender.json"), "w") as f:
        json.dump(meta, f)
    if SURVEY:
        # The walkable map for the free walk (Roomia Explorer, 31 Oct): per level and per 25 cm spot, the floor's height
        # (mm from the level's floor) and how far the nearest wall or piece of furniture is (cm, 0 where nobody can stand).
        import base64
        nav = {"x0": site["x0"], "y0": site["y0"], "step": step, "nx": nx, "ny": ny, "levels": []}
        for e_ in meta["levels"]:
            L = LEVELS[e_["index"]]
            dz = np.full(ny * nx, -32768, np.int16)
            cl_ = np.zeros(ny * nx, np.uint8)
            band = np.flatnonzero((site["z"] > L["floor"] - 1.0) & (site["z"] < L["floor"] + 1.4))
            # one floor per spot: the clearest, then the lowest
            order_ = band[np.lexsort((site["z"][band], -site["cl"][band]))]
            cols_ = site["col"][order_]
            first = np.unique(cols_, return_index=True)[1]
            pick = order_[first]
            dz[site["col"][pick]] = np.clip(np.round((site["z"][pick] - L["floor"]) * 1000), -32767, 32767).astype(np.int16)
            cl_[site["col"][pick]] = np.clip(np.round(site["cl"][pick] * 100), 0, 255).astype(np.uint8)
            nav["levels"].append({"index": e_["index"], "floor": L["floor"], "suffix": e_["suffix"],
                                  "dz": base64.b64encode(dz.tobytes()).decode(), "cl": base64.b64encode(cl_.tobytes()).decode()})
        with open(os.path.join(out_dir, "nav.json"), "w") as f:
            json.dump(nav, f)
        print("TOUR_INFO nav %d levels, %dx%d spots" % (len(nav["levels"]), nx, ny), flush=True)
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
# Only what the viewpoints can see is rendered (29 Oct, Pool: a 93 x 207 m resort filled the 16 GB and was stopped).
# An object whose box is more than CULL metres from every viewpoint is left out of the renders.
CULL = float(spec.get("cullDistance", 60.0))
if FULL and all_eyes:
    culled = 0
    for ob in scene.objects:
        if ob.type != "MESH" or ob.hide_render:
            continue
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        mn = Vector((min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb)))
        mx = Vector((max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb)))
        if all((Vector((min(max(e.x, mn.x), mx.x), min(max(e.y, mn.y), mx.y), min(max(e.z, mn.z), mx.z))) - e).length > CULL for e in all_eyes):
            ob.hide_render = True
            culled += 1
    print("TOUR_INFO culled %d far objects" % culled, flush=True)
# Cycles (28 Oct, ChatGPT): one equirectangular render per viewpoint instead of six EEVEE faces. EEVEE lights each face
# from what that camera sees, so the upward face drew the ceiling darker and its edge showed as a line (Ecolodge).
CYCLES_PANO = FULL and spec.get("panoEngine") == "cycles"
if CYCLES_PANO:
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
        except Exception:
            gpus = []
        if gpus:
            for d in gpus:
                d.use = True
            scene.cycles.device = "GPU"
            break
    scene.cycles.samples = int(spec.get("cyclesSamples", 32))
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = float(spec.get("cyclesNoise", 0.03))
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPTIX" if scene.cycles.device == "GPU" else "OPENIMAGEDENOISE"
    scene.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    scene.cycles.use_light_tree = True
    # Textures at most 1024 px: a 4096 px panorama shows a 2 m wall at ~400 px, and full-size textures were most of the
    # memory of the large files (Bloc B F5 and the Pool ran out on 28 Oct). 1024 against 2048 on Bloc B F5 (30 Oct): the
    # same detail in the panorama, 1.3 GB less memory.
    scene.render.use_simplify = True
    scene.cycles.texture_limit_render = spec.get("cyclesTextureLimit", "1024")
    # The plan was drawn with EEVEE just before, which left every texture decoded at full size in memory; Cycles loads
    # its own copies, so they were held twice (Bloc B F5 stopped for memory on 30 Oct). EEVEE's copies are let go.
    if spec.get("freeImages", True):
        for img in bpy.data.images:
            try:
                img.gl_free()
                img.buffers_free()
            except Exception:
                pass
    scene.cycles.max_bounces, scene.cycles.diffuse_bounces, scene.cycles.glossy_bounces = 8, 3, 2
    scene.cycles.transmission_bounces, scene.cycles.transparent_max_bounces = 4, 8
    # The low afternoon sun went deep into the rooms and burnt whole walls white (Ecolodge, 28 Oct): the Cycles 360° is
    # lit by soft daylight from the sky (cyclesSun scales the sun back in), and the photo-quality step adds the warmth.
    sun_energy = sun_data.energy if energy > 0 else 0.0
    if energy > 0:
        sun_data.energy = sun_energy * float(spec.get("cyclesSun", 0.0))
    # SketchUp exports a face as two sheets back to back (the room's side, and the outside, often SketchUp's default
    # white), and glTF hides the back of a one-sided sheet. EEVEE does; Cycles hit both sheets at the same distance and
    # showed whichever came first: a white wall and a patchwork ceiling (Ecolodge, 28 Oct). Making the backs see-through
    # skipped the room's sheet too (walls turned to glass). Each surface is moved 1 mm the way it faces instead, so the
    # sheet facing the camera is always the nearer one.
    # Two sheets facing the SAME way at the same place (a floor finish laid exactly on the slab: the Pool's corridors,
    # 30 Oct) stay together through that move: Cycles showed one or the other in triangles, and the light leaving one
    # sheet was stopped by its twin, so those triangles came out black. Where faces of two parts (one material of one
    # object) lie on the same plane over each other, the faces of the smaller part, usually the finish, go 0.25 mm
    # further per part under them. Only those faces move: moving whole objects opened hairlines along door frames.
    LAYER_STEP, LAYER_MAX, LAYER_MIN_AREA = 0.00025, 4, 0.01

    def layer_lift():
        t_layers = time.time()
        unit_of, unit_area, mesh_names, mesh_index = {}, [], [], {}
        rec_key, rec_box, rec_unit, rec_mesh, rec_poly, rec_okey, rec_face = [], [], [], [], [], [], []
        for ob in scene.objects:
            if ob.type != "MESH" or ob.hide_render or not ob.data.polygons:
                continue
            me = ob.data
            me.calc_loop_triangles()
            nt = len(me.loop_triangles)
            if nt == 0:
                continue
            tri = np.empty(nt * 3, np.int32)
            me.loop_triangles.foreach_get("vertices", tri)
            mat = np.empty(nt, np.int32)
            me.loop_triangles.foreach_get("material_index", mat)
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", co)
            mw = np.array(ob.matrix_world, np.float64)
            p = (co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3])[tri.reshape(-1, 3)]
            del co, tri
            cr = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
            area = 0.5 * np.linalg.norm(cr, axis=1)
            mats = np.unique(mat)
            lut = np.zeros(int(mats.max()) + 1, np.int32)
            for m in mats:
                key = (me.name, int(m))
                if key not in unit_of:
                    unit_of[key] = len(unit_area)
                    unit_area.append(0.0)
                lut[m] = unit_of[key]
                unit_area[lut[m]] += float(area[mat == m].sum())
            keep = area >= LAYER_MIN_AREA
            if not keep.any():
                continue
            if me.name not in mesh_index:
                mesh_index[me.name] = len(mesh_names)
                mesh_names.append(me.name)
            poly = np.empty(nt, np.int32)
            me.loop_triangles.foreach_get("polygon_index", poly)
            p, cr, area = p[keep], cr[keep], area[keep]
            n = cr / (2 * area)[:, None]
            d = (n * p[:, 0]).sum(1)
            # Drop the plane's main axis: faces on one plane overlap in the two others exactly when they overlap.
            dom = np.abs(n).argmax(1)
            ax = np.stack([(dom + 1) % 3, (dom + 2) % 3], 1)
            q = np.take_along_axis(p, ax[:, None, :].repeat(3, 1), 2)
            rec_box.append(np.concatenate([q.min(1), q.max(1)], 1).astype(np.float32))
            rec_key.append(np.concatenate([np.round(n * 64), np.floor(d / 0.002)[:, None], np.floor(d / 0.002 + 0.5)[:, None]], 1).astype(np.int64))
            # the same plane whichever way the face looks, and which way that is (two faces back to back share the plane)
            sign = np.where(np.take_along_axis(n, dom[:, None], 1)[:, 0] >= 0, 1.0, -1.0)
            nc, dc = n * sign[:, None], d * sign
            rec_okey.append(np.concatenate([np.round(nc * 64), np.floor(dc / 0.002)[:, None], np.floor(dc / 0.002 + 0.5)[:, None]], 1).astype(np.int64))
            rec_face.append(sign.astype(np.int8))
            rec_unit.append(lut[mat[keep]])
            rec_mesh.append(np.full(int(keep.sum()), mesh_index[me.name], np.int32))
            rec_poly.append(poly[keep])
        if not rec_key:
            return {}, {}
        keys, boxes, units = np.concatenate(rec_key), np.concatenate(rec_box), np.concatenate(rec_unit)
        okeys, faces = np.concatenate(rec_okey), np.concatenate(rec_face)
        del rec_key, rec_box, rec_okey, rec_face
        def overlapping(keys, tag):
            # pairs of faces on one plane whose boxes overlap by more than 1 cm both ways, with a different tag
            hits_a, hits_b = [], []
            # Two height grids half a cell apart, so two faces less than 1 mm apart always share a cell of one of them.
            for grid in (3, 4):
                k = keys[:, [0, 1, 2, grid]]
                order = np.lexsort(k.T[::-1])
                ks = k[order]
                for g in np.split(order, np.flatnonzero(np.any(ks[1:] != ks[:-1], 1)) + 1):
                    if len(g) < 2 or len(np.unique(tag[g])) < 2:
                        continue
                    g = g[np.argsort(boxes[g, 0])]
                    b, un = boxes[g], tag[g]
                    for s in range(0, len(g), 512):
                        e = min(len(g), s + 512)
                        end = int(np.searchsorted(b[:, 0], b[s:e, 2].max(), "right"))
                        ox = np.minimum(b[s:e, None, 2], b[None, s:end, 2]) - np.maximum(b[s:e, None, 0], b[None, s:end, 0])
                        oy = np.minimum(b[s:e, None, 3], b[None, s:end, 3]) - np.maximum(b[s:e, None, 1], b[None, s:end, 1])
                        i, j = np.nonzero((ox > 0.01) & (oy > 0.01) & (un[s:e, None] != un[None, s:end]))
                        hits_a.append(g[s + i])
                        hits_b.append(g[s + j])
            return (np.concatenate(hits_a), np.concatenate(hits_b)) if hits_a else (np.zeros(0, np.int64), np.zeros(0, np.int64))
        # Faces back to back on one plane (a tiled wall's top against the ceiling above it, Bloc B F2): both are moved apart.
        oa, ob_ = overlapping(okeys, faces)
        both = np.unique(np.concatenate([oa, ob_]))
        all_mesh, all_poly = np.concatenate(rec_mesh), np.concatenate(rec_poly)
        opposed = {}
        for mi in np.unique(all_mesh[both]):
            opposed[mesh_names[mi]] = all_poly[both[all_mesh[both] == mi]]
        ra, rb = overlapping(keys, units)
        del keys, boxes, okeys
        if not len(ra):
            return {}, opposed
        # The bigger part stays, the smaller goes over it; a part over several others goes over the highest of them.
        rank = sorted(range(len(unit_area)), key=lambda u: (-unit_area[u], u))
        pos = np.empty(len(rank), np.int64)
        pos[rank] = np.arange(len(rank))
        ua, ub = units[ra], units[rb]
        a_big = pos[ua] < pos[ub]
        under = {}
        for small, big in set(zip(np.where(a_big, ub, ua).tolist(), np.where(a_big, ua, ub).tolist())):
            under.setdefault(small, []).append(big)
        level = np.zeros(len(rank), np.int32)
        for u in rank:
            if u in under:
                level[u] = min(LAYER_MAX, 1 + max(int(level[big]) for big in under[u]))
        top = np.unique(np.where(a_big, rb, ra))
        meshes, polys, levels = all_mesh[top], all_poly[top], level[units[top]]
        lift = {}
        for mi in np.unique(meshes):
            sel = meshes == mi
            lift[mesh_names[mi]] = (polys[sel], levels[sel])
        print("TOUR_INFO cycles layers %d faces of %d parts over others, %d faces back to back %.1fs" % (len(top), len(under), len(both), time.time() - t_layers), flush=True)
        return lift, opposed

    lift, opposed = layer_lift() if spec.get("layerLift", True) else ({}, {})
    # Only the sheets that have a twin back to back are moved (31 Oct, Bloc B F2's corridor): moving every surface opened
    # a slit along each outside corner and along a ceiling made of one sheet, and the daylight through it drew bright
    # lines along the tops and corners of the walls. A twin is a triangle at the same three corners (to the millimetre)
    # as another, in any object.
    def twin_sheets():
        t_twins = time.time()
        hashes, owners = [], []
        for ob in scene.objects:
            if ob.type != "MESH" or not ob.data.polygons:
                continue
            me = ob.data
            me.calc_loop_triangles()
            nt = len(me.loop_triangles)
            if nt == 0:
                continue
            tri = np.empty(nt * 3, np.int32)
            me.loop_triangles.foreach_get("vertices", tri)
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", co)
            mw = np.array(ob.matrix_world, np.float64)
            q = np.round((co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3]) / 0.001).astype(np.int64)
            vh = (q[:, 0] * 73856093) ^ (q[:, 1] * 19349663) ^ (q[:, 2] * 83492791)
            th = np.sort(vh[tri.reshape(-1, 3)], axis=1)
            hashes.append(th[:, 0] * 1000003 + th[:, 1] * 30999473 + th[:, 2] * 17)
            owners.append(me.name)
        if not hashes:
            return {}
        _, inv, cnt = np.unique(np.concatenate(hashes), return_inverse=True, return_counts=True)
        doubled = cnt[inv] >= 2
        twins, at = {}, 0
        for name, h in zip(owners, hashes):
            flags = doubled[at:at + len(h)]
            at += len(h)
            twins[name] = flags | twins[name] if name in twins else flags
        print("TOUR_INFO cycles %d of %d triangles are back-to-back twins %.1fs" % (int(doubled.sum()), len(doubled), time.time() - t_twins), flush=True)
        return twins
    twins = twin_sheets() if spec.get("twinsOnly", True) else None
    t_split = time.time()
    moved = set()
    for ob in scene.objects:
        if ob.type != "MESH" or ob.data.name in moved:
            continue
        me = ob.data
        moved.add(me.name)
        n = len(me.vertices)
        if n == 0:
            continue
        co = np.empty(n * 3, np.float32)
        me.vertices.foreach_get("co", co)
        nrm = np.empty(n * 3, np.float32)
        me.vertex_normals.foreach_get("vector", nrm)
        # 1 mm in the world, whatever the object's scale.
        scale = max(1e-6, float(np.mean([abs(x) for x in ob.matrix_world.to_scale()])))
        shift = np.full(n, 0.001, np.float32)
        if twins is not None:
            me.calc_loop_triangles()
            tv = np.empty(len(me.loop_triangles) * 3, np.int32)
            me.loop_triangles.foreach_get("vertices", tv)
            on = np.zeros(n, bool)
            flags = twins.get(me.name)
            if flags is not None and len(flags) * 3 == len(tv):
                on[tv.reshape(-1, 3)[flags].reshape(-1)] = True
            if me.name in opposed:
                tots = np.empty(len(me.polygons), np.int32)
                me.polygons.foreach_get("loop_total", tots)
                starts = np.empty(len(me.polygons), np.int32)
                me.polygons.foreach_get("loop_start", starts)
                lverts = np.empty(len(me.loops), np.int32)
                me.loops.foreach_get("vertex_index", lverts)
                pp = np.unique(opposed[me.name])
                idx = np.concatenate([np.arange(starts[q], starts[q] + tots[q]) for q in pp]) if len(pp) else np.zeros(0, np.int64)
                on[lverts[idx]] = True
            shift = np.where(on, shift, 0.0).astype(np.float32)
        if me.name in lift:
            pl = np.zeros(len(me.polygons), np.float32)
            np.maximum.at(pl, lift[me.name][0], lift[me.name][1].astype(np.float32))
            tots = np.empty(len(me.polygons), np.int32)
            me.polygons.foreach_get("loop_total", tots)
            lverts = np.empty(len(me.loops), np.int32)
            me.loops.foreach_get("vertex_index", lverts)
            vl = np.zeros(n, np.float32)
            np.maximum.at(vl, lverts, np.repeat(pl, tots))
            shift += vl * LAYER_STEP
        me.vertices.foreach_set("co", co + nrm * (np.repeat(shift, 3) / scale))
        me.update()
    print("TOUR_INFO cycles sheets apart %.1fs" % (time.time() - t_split), flush=True)
    # A slab under each level (30 Oct, Bloc B F5): the floor is tiles with nothing under them, and the camera saw the
    # bright ground of the sky sphere through every joint (white lines along the tiles, white fans at the foot of the
    # walls) while its light came up through them. A slab 15 cm under each spot's own floor (sunken bathrooms keep
    # theirs) and 50 cm past the walls closes it; views out of the windows still reach the real ground.
    # And a cover over the rooms' ceilings (31 Oct, the Restaurant): where a wall stops a little short of the ceiling, the
    # bright outside showed through the slit as a thin white line along the top of the wall. A near-black cover 3 cm over
    # the ceiling (inside the slab when there is one) and 50 cm past the walls closes it; a glass roof stays open.
    # Neither goes where it would be seen from another level: never under a lower room's ceiling, never over an upper
    # floor laid on this ceiling.
    def grow(m):
        g = m.copy()
        g[1:, :] |= m[:-1, :]; g[:-1, :] |= m[1:, :]; g[:, 1:] |= m[:, :-1]; g[:, :-1] |= m[:, 1:]
        return g
    def spread(a, r, op):
        # the max (or any) over a (2r+1) square around each cell, by shifting
        out = a.copy()
        pad = np.pad(a, r, constant_values=(False if a.dtype == bool else -1e9))
        for dj in range(-r, r + 1):
            for di in range(-r, r + 1):
                out = op(out, pad[r + dj:r + dj + a.shape[0], r + di:r + di + a.shape[1]])
        return out
    def square_sum(a, r):
        # the sum over a (2r+1) square around each cell
        pad = np.pad(a, r)
        return sum(pad[r + dj:r + dj + a.shape[0], r + di:r + di + a.shape[1]] for dj in range(-r, r + 1) for di in range(-r, r + 1))
    def dark_plane(name, cells, grey, quads=()):
        verts, faces = [], []
        for x, y, z, s in cells:
            n = len(verts)
            verts += [(x, y, z), (x + s, y, z), (x + s, y - s, z), (x, y - s, z)]
            faces.append((n, n + 1, n + 2, n + 3))
        for q_ in quads:
            n = len(verts)
            verts += list(q_)
            faces.append((n, n + 1, n + 2, n + 3))
        me_ = bpy.data.meshes.new(name)
        me_.from_pydata(verts, [], faces)
        ob_ = bpy.data.objects.new(name, me_)
        scene.collection.objects.link(ob_)
        mat_ = bpy.data.materials.new(name)
        mat_.use_nodes = True
        mat_.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (grey, grey, grey, 1)
        mat_.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
        me_.materials.append(mat_)
        return len(faces)
    if SURVEY:
        nx, step = site["nx"], site["step"]
        cand_order = np.argsort(site["col"], kind="stable")
        cand_cols = site["col"][cand_order]
        def cands(c):
            return cand_order[np.searchsorted(cand_cols, c):np.searchsorted(cand_cols, c, "right")]
        def hits(c):
            a, b = np.searchsorted(site["hcol"], c), np.searchsorted(site["hcol"], c, "right")
            return site["hz"][a:b], site["hk"][a:b]
        slab_cells, cap_cells, holes, glass_cells, slab_walls = [], [], 0, 0, []
        for Lm in meta.get("levels", []):
            rooms_file = os.path.join(out_dir, "plan-rooms%s.npy" % Lm["suffix"])
            if not os.path.exists(rooms_file):
                continue
            apt = np.load(rooms_file).astype(bool)
            lf = Lm["floor"]
            x0, y0 = Lm["rooms"]["x0"], Lm["rooms"]["y0"]
            if spec.get("underSlab", True):
                grown = grow(grow(apt))
                # Holes inside the level too (Bloc B F2 has a corridor with no floor modelled): everything the outside
                # cannot reach without crossing the level is covered.
                outside = np.zeros_like(grown)
                outside[0, :], outside[-1, :], outside[:, 0], outside[:, -1] = ~grown[0, :], ~grown[-1, :], ~grown[:, 0], ~grown[:, -1]
                while True:
                    more = grow(outside) & ~grown
                    if (more == outside).all():
                        break
                    outside = more
                grown |= ~outside
                # A floor that was never modelled (Bloc B F2's corridor, 30 Oct) is nowhere to stand, so it is not on the
                # plan, and where it opens to the outside of the grid the hole stayed open: the camera saw the white ground
                # of the sky sphere in the room. A cell next to the slab is covered too when it is roofed, closed in on
                # three sides and has nothing under it for 6 m (a gallery over a lower floor keeps its view down), up to
                # 10 m out.
                def enclosed_hole(j, i):
                    hz, hk = hits(j * nx + i)
                    if not ((hz > lf + 1.0) & (hz < lf + 4.5)).any():
                        return False
                    below = hz[(hz < lf + 1.0) & ((hk & 3) == 0)]
                    if len(below) and below.max() > lf - 6.0:
                        return False
                    c = Vector((x0 + (i + 0.5) * step, y0 - (j + 0.5) * step, lf + 1.0))
                    walls = sum(1 for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)) if scene.ray_cast(depsgraph, c, Vector(d), distance=8.0)[0])
                    return walls >= 3
                seen = grown.copy()
                hole = np.zeros_like(grown)
                q = deque((j, i, 0) for j, i in zip(*np.nonzero(grown)))
                while q:
                    j, i, far = q.popleft()
                    if far >= int(10.0 / step):
                        continue
                    for jj, ii in ((j + 1, i), (j - 1, i), (j, i + 1), (j, i - 1)):
                        if 0 <= jj < grown.shape[0] and 0 <= ii < grown.shape[1] and not seen[jj, ii]:
                            seen[jj, ii] = True
                            if enclosed_hole(jj, ii):
                                grown[jj, ii] = True
                                hole[jj, ii] = True
                                holes += 1
                                q.append((jj, ii, far + 1))
                # A hole is closed at floor level, 50 cm past its edge (31 Oct, Bloc B F2's corridor): 15 cm down the slab
                # left a layer of air under the walls around the hole, which are two sheets with nothing at their foot, and
                # the daylight came along it into the corridor and glowed at the foot of the walls; the row of cells inside
                # those walls has no surface at all and had been left open too.
                at_floor = hole | grow(grow(hole))
                grown |= at_floor
                level_z = np.full(grown.shape, np.nan, np.float32)
                for j, i in zip(*np.nonzero(grown)):
                    c = j * nx + i
                    # never under water: a pool is a hole in the deck, and a dark plane just under its surface turned it
                    # into a grey puddle
                    hz, hk = hits(c)
                    if (((hk & 3) != 0) & ((hk & 4) != 0) & (hz > lf - 1.5) & (hz < lf + 0.3)).any():
                        continue
                    cs = cands(c)
                    z = lf - 0.15
                    own = site["z"][cs][(site["z"][cs] > lf - 1.3) & (site["z"][cs] < lf + 0.3)] if apt[j, i] else np.zeros(0)
                    if len(own):
                        z = min(z, float(own.min()) - 0.15)
                    if at_floor[j, i]:
                        z = (min(lf, float(own.min())) if len(own) else lf) - 0.003
                    # a room below whose ceiling is within 30 cm over the slab would have it hanging in it
                    under = site["ceil"][cs][(site["z"][cs] < z - 1.0) & (site["ceil"][cs] > z - 0.001) & (site["ceil"][cs] < z + 0.3)]
                    if len(under):
                        top_ = min(lf, float(own.min())) if len(own) else lf
                        if top_ - under.max() < 0.02:
                            continue
                        z = (top_ + float(under.max())) / 2
                    slab_cells.append((x0 + i * step, y0 - j * step, z, step))
                    level_z[j, i] = z
                # Where two cells of the slab are at different heights, a wall closes the step, so no light runs along the
                # layer under the floor into the hole.
                for (dj, di) in ((0, 1), (1, 0)):
                    a_ = level_z[:level_z.shape[0] - dj, :level_z.shape[1] - di]
                    b_ = level_z[dj:, di:]
                    for j, i in zip(*np.nonzero(np.abs(a_ - b_) > 0.01)):
                        za, zb = float(a_[j, i]), float(b_[j, i])
                        if di:
                            x_, y1_, y2_ = x0 + (i + 1) * step, y0 - j * step, y0 - (j + 1) * step
                            slab_walls.append(((x_, y1_, za), (x_, y2_, za), (x_, y2_, zb), (x_, y1_, zb)))
                        else:
                            y_, x1_, x2_ = y0 - (j + 1) * step, x0 + i * step, x0 + (i + 1) * step
                            slab_walls.append(((x1_, y_, za), (x2_, y_, za), (x2_, y_, zb), (x1_, y_, zb)))
            if spec.get("ceilingCap", True):
                zc = np.full(apt.shape, -1e9, np.float32)
                nocap = np.zeros(apt.shape, bool)
                # Only under a solid ceiling: where nine in ten of the spots around (1.25 m) are roofed. Under a pergola's
                # slats many see the sky, and a cover there would have blacked out the light through them.
                roofed = np.zeros(apt.shape, np.int32)
                floored = np.zeros(apt.shape, np.int32)
                for j, i in zip(*np.nonzero(apt)):
                    cs = cands(j * nx + i)
                    mine = cs[(site["z"][cs] > lf - 0.3) & (site["z"][cs] < lf + 1.3)]
                    if len(mine):
                        floored[j, i] = 1
                        roofed[j, i] = int((site["ceil"][mine] < 1e8).any())
                solid_roof = square_sum(roofed, 2) >= 0.9 * np.maximum(square_sum(floored, 2), 1)
                rooms_here = spread(LEVELS[Lm["index"]]["indoor"], 4, np.logical_or)
                for j, i in zip(*np.nonzero(apt)):
                    if not solid_roof[j, i] or not rooms_here[j, i]:
                        nocap[j, i] = True
                        continue
                    cs = cands(j * nx + i)
                    mine = cs[(site["z"][cs] > lf - 0.3) & (site["z"][cs] < lf + 1.3) & (site["ceil"][cs] < 1e8)]
                    if not len(mine):
                        continue
                    k = mine[np.argmin(site["z"][mine])]
                    if site["glass"][k]:
                        nocap[j, i] = True
                        continue
                    ce, gap = float(site["ceil"][k]), float(site["gap"][k])
                    if gap >= 0.008:
                        zc[j, i] = ce + min(0.03, gap / 2)
                has = zc > -1e8
                # at the highest ceiling within 1 m: over a shower box or a soffit lower than the room's ceiling it stays hidden
                top_z = spread(zc, 4, np.maximum)
                capm = (has | spread(has, 2, np.logical_or)) & ~nocap & (top_z > -1e8)
                glass_cells += int(nocap.sum())
                for j, i in zip(*np.nonzero(capm)):
                    z = float(top_z[j, i])
                    cs = cands(j * nx + i)
                    # a floor just under the cover (an upper level laid on this ceiling) would have it floating over it
                    if ((site["z"][cs] > z - 0.3) & (site["z"][cs] < z)).any():
                        continue
                    cap_cells.append((x0 + i * step, y0 - j * step, z, step))
        if slab_cells:
            dark_plane("roomia_under_slab", slab_cells, 0.3, slab_walls)
        if cap_cells:
            dark_plane("roomia_ceiling_cap", cap_cells, float(spec.get("capGrey", 0.03)))
        print("TOUR_INFO cycles slab %d cells, %d over holes, %d steps closed; cover %d cells, %d under glass" % (len(slab_cells), holes, len(slab_walls), len(cap_cells), glass_cells), flush=True)
    # The sky dome is seen through the windows but does not light the room: its blue turned white ceilings blue.
    if dome is not None:
        dome.visible_diffuse = False
        dome.visible_volume_scatter = False
    cam_data.type = "PANO"
    if hasattr(cam_data, "panorama_type"):
        cam_data.panorama_type = "EQUIRECTANGULAR"
    else:
        cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
    scene.render.resolution_x, scene.render.resolution_y = int(spec.get("panoWidth", 4096)), int(spec.get("panoWidth", 4096)) // 2
    yaws = {v["index"]: v["yaw"] for v in meta["views"]} | {a["index"]: a["yaw"] for a in meta.get("auto", [])}
    frames = [i for i in range(len(all_eyes)) if i not in skip]
    # Outdoors the sun is on (31 Oct, the Pool's courtyard): the sky alone left it flat, without a shadow. Indoors it stays
    # off (the low afternoon sun burnt whole walls white and laid orange streaks on the floors, 28-29 Oct).
    def sky_above(e):
        # nothing over the eye but the sky sphere (80 m and more away)
        h = ray(e, (0, 0, 1))
        return h is None or h.z - e.z > 40.0
    open_sky = {i: SURVEY and sky_above(all_eyes[i]) for i in frames}
    if spec.get("debugSky"):
        for i in frames:
            h = ray(all_eyes[i], (0, 0, 1))
            print("DBGSKY", i, open_sky[i], None if h is None else round(h.z - all_eyes[i].z, 2), flush=True)
    if energy > 0:
        inside_sun = (sun_data.energy, tuple(sun_data.color), tuple(sun.rotation_euler))
        outside_sun = (float(spec.get("cyclesSunOutdoor", 8.0)), (1.0, 0.93, 0.84), (math.radians(90 - 42), 0.0, math.radians(light.get("sunAzimuth", 35))))
    def place(i):
        cam.location = all_eyes[i]
        # A camera turned up to the horizon looks along its -Z: the middle of the panorama is the view's direction.
        cam.rotation_euler = (math.pi / 2, 0.0, yaws[i] - math.pi / 2)
        if dome is not None:
            dome.location.z = all_eyes[i].z
        if energy > 0:
            sun_data.energy, sun_data.color, sun.rotation_euler = outside_sun if open_sky.get(i) else inside_sun
    # One render per viewpoint with the scene kept loaded between them (persistent data): animating the exposure
    # made Cycles prepare the whole scene again for every frame (116 s -> 318 s for 6 viewpoints, 28 Oct).
    scene.render.use_persistent_data = True
    t_pano = time.time()
    # Exposure per viewpoint, like a photographer exposing for the room: Cycles lights an interior as it really is,
    # dark next to the daylight coming in (Ecolodge 28 Oct, nearly black at exposure 0). A small quick render of each
    # viewpoint is measured in linear light, and the full one gets the exposure that brings its median to EXPOSE_TO.
    full = (scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.view_settings.view_transform)
    scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples = 256, 128, 8
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
    EXPOSE_TO = float(spec.get("cyclesMedian", 0.18))
    # No black rooms (29 Oct): a room whose lamps did not come through as lights (D5's icons in Bloc B F2, any engine's
    # we don't know yet) came out black where only a little daylight reached, and the AI keeps the base's light. The
    # meter also records each surface's own colour, so light and paint are told apart: a dark-painted wall is fine, a
    # wall that gets almost no light is not. When too much of the room is in the dark, a soft even fill (the sky's
    # colour as ambient light, softened in corners like real bounce light) is added, just enough to lift it.
    import OpenImageIO as oiio
    ws = scene.world.light_settings
    ws.distance = float(spec.get("fillDistance", 1.0))
    scene.cycles.fast_gi_method = "ADD"
    scene.cycles.ao_bounces_render = 1
    FILL_TEST = 1.0
    FILL_FLOOR = float(spec.get("fillFloor", 0.25))  # the dimmest quarter of the lit surfaces gets at least this much of the median light
    view_layer = bpy.context.view_layer
    view_layer.use_pass_diffuse_color = True
    LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
    def meter(path):
        bpy.ops.render.render(write_still=True)
        inp = oiio.ImageInput.open(path)
        names = list(inp.spec().channelnames)
        px = inp.read_image(0, 0, 0, len(names), "float").reshape(-1, len(names))
        inp.close()
        def rgb(prefix):
            return px[:, [names.index("%s.%s" % (prefix, c)) for c in "RGB"]]
        combined = next(n.rsplit(".", 1)[0] for n in names if n.endswith("Combined.R"))
        albedo = next(n.rsplit(".", 1)[0] for n in names if n.endswith("DiffCol.R"))
        return rgb(combined) @ LUMA, rgb(albedo) @ LUMA
    def shadow_ratio(light):
        med = float(np.median(light))
        return float(np.percentile(light, 25)) / med if med > 0 else 0.0
    MAX_EV = float(spec.get("cyclesMaxEv", 11.0))
    # The darkest median left to the exposure alone: a room darker than +8 EV (31 Oct, Bloc B F2's corridor once the light
    # leaking under its walls was closed: +10 EV, blotchy) gets the fill up to there.
    DIMMEST = EXPOSE_TO / 2 ** float(spec.get("cyclesFillEv", 8.0))
    evs, fills = {}, {}
    # Where each viewpoint's time goes (31 Oct, before optimising): the meter, the fill's meter, the panorama itself.
    timing = {i: {} for i in frames}
    for i in frames:
        place(i)
        scene.cycles.use_fast_gi = False
        scene.render.filepath = os.path.join(out_dir, "meter-%d.exr" % i)
        t_m = time.time()
        lum, alb = meter(scene.render.filepath)
        timing[i]["meter"] = time.time() - t_m
        # light falling on matt surfaces (not lamps, not windows, not black objects)
        surf = alb > 0.08
        light = lum[surf] / alb[surf] if surf.sum() > 500 else None
        ratio = shadow_ratio(light) if light is not None else -1.0
        k = 0.0
        # Fill when part of the room is in the dark, or when the whole room is too dark for the exposure to reach
        # (30 Oct, the Pool's corridors: nearly no light at all, the image stayed black at +11 EV).
        if light is not None and (ratio < FILL_FLOOR or float(np.median(lum)) < DIMMEST):
            scene.cycles.use_fast_gi = True
            ws.ao_factor = FILL_TEST
            scene.render.filepath = os.path.join(out_dir, "meter-fill-%d.exr" % i)
            t_m = time.time()
            lum_f, _ = meter(scene.render.filepath)
            timing[i]["fill"] = time.time() - t_m
            extra = np.maximum(lum_f - lum, 0.0)
            gain = extra[surf] / alb[surf]
            if float(np.median(gain)) > 0:
                def enough(f):
                    return shadow_ratio(light + f * gain) >= FILL_FLOOR and float(np.median(lum + f * extra)) >= DIMMEST
                lo_k, hi_k = 0.0, 64.0
                for _ in range(30):
                    mid = (lo_k + hi_k) / 2
                    if enough(mid):
                        hi_k = mid
                    else:
                        lo_k = mid
                k = hi_k * FILL_TEST
                lum = lum + hi_k * extra
        fills[i] = k
        # Up to +11 EV: a room lit only by the sky through one window (Ecolodge Point 1, the Pool's corridors) stopped at
        # the old +8 limit and stayed dark (29 Oct).
        evs[i] = float(np.clip(math.log2(EXPOSE_TO / max(float(np.median(lum)), 1e-9)), -4.0, MAX_EV)) + float(spec.get("cyclesExposure", 0.0))
        print("TOUR_INFO cycles exposure view %d %+.2f EV fill %.3g shadows %.2f" % (i, evs[i], k, ratio), flush=True)
    scene.cycles.use_fast_gi = False
    view_layer.use_pass_diffuse_color = False
    scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.view_settings.view_transform = full
    scene.render.image_settings.file_format = "PNG"
    # Samples by how much light the room has (29 Oct, Suite): a lit bedroom (+0.4 EV) at 32 samples with OIDN matched
    # 128 in 37 s instead of 112; a bathroom lit by one mirror lamp (+8 EV) lost its plaster texture below 128, where
    # OptiX keeps it. A room needing more than FAST_EV of exposure is dark and keeps the full samples. 31 Oct: the
    # Restaurant's +3.4 to +3.7 EV halls look the same at 32 as at 128 (20 s instead of 70 s a viewpoint), so up to +4.5;
    # 64 samples with OIDN smeared the plaster of the Ecolodge's +8 EV room.
    FAST_EV = float(spec.get("cyclesFastEv", 4.5))
    gpu_oidn = scene.cycles.device == "GPU"
    for i in frames:
        place(i)
        scene.view_settings.exposure = evs[i]
        scene.cycles.use_fast_gi = fills[i] > 0
        ws.ao_factor = fills[i]
        if evs[i] <= FAST_EV:
            scene.cycles.samples = int(spec.get("cyclesFastSamples", 32))
            scene.cycles.denoiser = "OPENIMAGEDENOISE"
            scene.cycles.denoising_prefilter = "ACCURATE"
            scene.cycles.denoising_use_gpu = gpu_oidn
        else:
            scene.cycles.samples = full[2]
            scene.cycles.denoiser = "OPTIX" if gpu_oidn else "OPENIMAGEDENOISE"
        # the Explorer's bake again without the 360° (they are made already)
        if spec.get("bakeSkipPanos"):
            continue
        print("TOUR_INFO cycles view %d %d samples %s%s" % (i, scene.cycles.samples, scene.cycles.denoiser, " outdoors, sun %.1f" % sun_data.energy if open_sky.get(i) and energy > 0 else ""), flush=True)
        scene.render.filepath = os.path.join(out_dir, "pano-raw-%d.png" % i)
        t_r = time.time()
        bpy.ops.render.render(write_still=True)
        timing[i]["render"] = time.time() - t_r
        timing[i]["samples"] = scene.cycles.samples
        print("TOUR_STEP pano %d" % i, flush=True)
    for i in frames:
        t_ = timing[i]
        print("TOUR_INFO cycles timing view %d: meter %.1fs, fill %.1fs, render %.1fs (%d samples, %+.1f EV)" % (i, t_.get("meter", 0), t_.get("fill", 0), t_.get("render", 0), t_.get("samples", 0), evs[i]), flush=True)
    scene.render.use_persistent_data = False
    scene.cycles.use_fast_gi = False
    print("TOUR_INFO cycles %d panoramas %.1fs" % (len(frames), time.time() - t_pano), flush=True)
    if spec.get("bakeExplorer"):
        # Off unless the spec asks; no build asks yet (a prototype, tried on the Ecolodge, its files packed by
        # lib/scene-prep/explore-glb.ts). Roomia Explorer's light (31 Oct): the scene's Cycles light, as it is for the 360°, baked as LIGHT ONLY (direct and
        # bounced, without the surfaces' own colour), so the walk shows each surface's own texture times its light and
        # no colour is applied twice. The big surfaces (walls, floors, ceilings, and the furniture's: cushions, a rug, a
        # pool's water) get a lightmap on a second UV map made for them; the small pieces (frames, trims, legs, plants)
        # get the light in their vertices. Glass and lamps keep their own look. One exposure for the whole place: the
        # one most indoor 360° had, with their fill.
        t_bake = time.time()
        scene.render.use_persistent_data = False
        indoor = [i for i in frames if not open_sky.get(i)] or list(frames)
        ev_fixed = float(np.median([evs[i] for i in indoor]))
        fill = float(np.median([fills[i] for i in indoor]))
        if energy > 0:
            sun_data.energy, sun_data.color, sun.rotation_euler = inside_sun
        scene.cycles.use_fast_gi = fill > 0
        ws.ao_factor = fill
        scene.view_settings.exposure = 0.0
        def is_glass_mat(m):
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes else None
            return b is not None and (b.inputs["Transmission Weight"].default_value > 0.5 or b.inputs["Alpha"].default_value < 0.6)
        def is_emitter(m):
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes else None
            return b is not None and b.inputs["Emission Strength"].default_value > 0.5 and tuple(b.inputs["Emission Color"].default_value)[:3] != (0, 0, 0)
        def kind_of(ob):
            mats = [s.material for s in ob.material_slots if s.material is not None]
            if mats and all(role_of(m) in ("glass", "mirror") or is_glass_mat(m) for m in mats):
                return "glass"
            if mats and all(is_emitter(m) for m in mats):
                return "lamp"
            bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
            ext = [max(p[a] for p in bb) - min(p[a] for p in bb) for a in range(3)]
            thin = min(ext[0], ext[1])
            return "furniture" if max(ext[0], ext[1]) < 4.0 and thin >= 0.25 and ext[2] < 2.6 and not (ext[2] >= 1.9 and thin < 0.45) else "arch"
        kinds = {}
        for ob in scene.objects:
            if ob.type == "MESH" and not ob.hide_render and ob.data.polygons and not ob.name.startswith("roomia_"):
                kinds[ob.name] = kind_of(ob)
        print("TOUR_INFO bake kinds %s, exposure %+.2f EV, fill %.3g" % ({k: sum(1 for v in kinds.values() if v == k) for k in ("arch", "furniture", "glass", "lamp")}, ev_fixed, fill), flush=True)
        # The light is kept as a log: indoors it is 6-9 EV under the daylight outside, too wide for 8 bits of plain values.
        # Stored: (log2(light x 2^exposure) - LO) / (HI - LO), the viewer takes 2^(LO + v (HI - LO)) as the light.
        LO, HI = -8.0, 6.0
        def encode(light):
            v = (np.log2(np.maximum(light * np.float32(2.0 ** ev_fixed), np.float32(2.0 ** LO))) - LO) / (HI - LO)
            return np.clip(v, 0.0, 1.0)
        bpy.ops.object.select_all(action="DESELECT")
        scene.cycles.samples = int(spec.get("bakeSamples", 256))
        scene.cycles.use_denoising = False
        import bmesh
        # Architecture and furniture: one mesh, in metres. Only its big surfaces get the lightmap: the second bake (31 Oct)
        # gave every piece (886 000 faces, frames and trims included) an island, and with a margin each the packer shrank
        # them to dots, 0.04 % of the map. The small pieces get their light in their vertices. The furniture is in it
        # too (fourth bake): a pool's water, a rug or a table top lit only at its corners came out dark or blotched.
        arch = [scene.objects[n] for n, k in kinds.items() if k in ("arch", "furniture")]
        for ob in arch:
            if ob.data.users > 1:
                ob.data = ob.data.copy()
            ob.select_set(True)
        bpy.context.view_layer.objects.active = arch[0]
        bpy.ops.object.join()
        archo = bpy.context.view_layer.objects.active
        archo.name = archo.data.name = "roomia_arch"
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        me = archo.data
        t1 = time.time()
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=0.0005)
        bpy.ops.object.mode_set(mode="OBJECT")
        # flat faces, the bake's hemisphere from each face's own side (the import's custom normals would turn with a copy)
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
        me.shade_flat()
        # Surfaces: faces joined across the edges that bend less than 30 degrees; a surface of 0.25 m2 or more is a
        # wall, floor or ceiling (or a big panel) and gets the lightmap.
        nf = len(me.polygons)
        area = np.empty(nf, np.float32)
        me.polygons.foreach_get("area", area)
        nrm = np.empty(nf * 3, np.float32)
        me.polygons.foreach_get("normal", nrm)
        nrm = nrm.reshape(-1, 3)
        tot = np.empty(nf, np.int32)
        me.polygons.foreach_get("loop_total", tot)
        le = np.empty(len(me.loops), np.int32)
        me.loops.foreach_get("edge_index", le)
        lf = np.repeat(np.arange(nf, dtype=np.int64), tot)
        o = np.argsort(le, kind="stable")
        le, lf = le[o], lf[o]
        same = le[1:] == le[:-1]
        fa, fb = lf[:-1][same], lf[1:][same]
        flat = (nrm[fa] * nrm[fb]).sum(1) > math.cos(math.radians(30))
        fa, fb = fa[flat], fb[flat]
        lab = np.arange(nf, dtype=np.int64)
        for _ in range(1000):
            m_ = np.minimum(lab[fa], lab[fb])
            new = lab.copy()
            np.minimum.at(new, fa, m_)
            np.minimum.at(new, fb, m_)
            new = new[new]
            if np.array_equal(new, lab):
                break
            lab = new
        region = np.bincount(lab, weights=area, minlength=nf)
        for th in (0.05, 0.25, 1.0):
            s_ = region[lab] >= th
            print("TOUR_INFO bake surfaces >= %.2f m2: %d faces, %d surfaces, %.0f of %.0f m2" % (th, s_.sum(), len(np.unique(lab[s_])), area[s_].sum(), area.sum()), flush=True)
        big = region[lab] >= float(spec.get("lightmapMinArea", 0.25))
        # A sheet alone (no twin 2 mm behind it, facing the other way) shows its back in Cycles shaded as its front; a
        # lightmap holds one side. The third bake (31 Oct) lit a wall of points 5 and 6 with the sunlit outside, and the
        # pool's water (its sheet faces down) with the dark under it. Such a sheet gets a back of its own, 1 mm behind.
        from mathutils.bvhtree import BVHTree
        bvh = BVHTree.FromObject(archo, bpy.context.evaluated_depsgraph_get())
        cen = np.empty(nf * 3, np.float32)
        me.polygons.foreach_get("center", cen)
        cen = cen.reshape(-1, 3)
        lonely = np.zeros(nf, bool)
        for i in np.flatnonzero(big):
            n_ = Vector(nrm[i])
            hit = bvh.ray_cast(Vector(cen[i]) - n_ * 0.0001, -n_, 0.005)
            lonely[i] = hit[0] is None or hit[1].dot(n_) > -0.5
        del bvh
        detail_me = me.copy()
        for mesh_, drop in ((me, ~big), (detail_me, big)):
            bm = bmesh.new()
            bm.from_mesh(mesh_)
            bm.faces.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.flatnonzero(drop)], context="FACES")
            bm.to_mesh(mesh_)
            bm.free()
        lonely = lonely[big]
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        ret = bmesh.ops.duplicate(bm, geom=[bm.faces[i] for i in np.flatnonzero(lonely)])
        backs = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMFace)]
        bmesh.ops.reverse_faces(bm, faces=backs)
        bm.normal_update()
        for v in {v for f in backs for v in f.verts}:
            v.co += v.normal * 0.001
        bm.to_mesh(me)
        bm.free()
        print("TOUR_INFO bake architecture: %d of %d big faces alone, given a back" % (int(lonely.sum()), len(lonely)), flush=True)
        # the lightmapped surfaces draw their front only (glTF doubleSided false): their own copies of the materials
        for slot in archo.material_slots:
            if slot.material is not None:
                m2 = slot.material.copy()
                m2.use_backface_culling = True
                slot.material = m2
        deto = bpy.data.objects.new("roomia_detail", detail_me)
        deto.matrix_world = archo.matrix_world
        for c in archo.users_collection:
            c.objects.link(deto)
        print("TOUR_INFO bake architecture split %.1fs: %d faces lightmapped, %d small ones by vertex" % (time.time() - t1, len(me.polygons), len(detail_me.polygons)), flush=True)
        # furniture and small pieces: one mesh each (instances would share their light), the light in a colour attribute
        # at each vertex
        bpy.ops.object.select_all(action="DESELECT")
        furn = []
        for ob in [deto]:
            if ob.data.users > 1:
                ob.data = ob.data.copy()
            attr = ob.data.color_attributes.get("RoomiaLight") or ob.data.color_attributes.new("RoomiaLight", "FLOAT_COLOR", "POINT")
            ob.data.color_attributes.active_color = attr
            ob.select_set(True)
        t1 = time.time()
        scene.cycles.samples = int(spec.get("bakeVertexSamples", 512))
        bpy.context.view_layer.objects.active = deto
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="VERTEX_COLORS", use_clear=True)
        for group, obs in (("furniture", furn), ("small pieces", [deto])):
            dark = 0
            for ob in obs:
                attr = ob.data.color_attributes.get("RoomiaLight")
                c = np.empty(len(attr.data) * 4, np.float32)
                attr.data.foreach_get("color", c)
                c = c.reshape(-1, 4)
                # A vertex inside another part (a cushion sunk in its seat, a frame's edge in the wall) bakes black and
                # every triangle from it fades to black (the third bake's mosaic on the sofas): it takes the light of its
                # lit neighbours, spreading in, or else the piece's median.
                lum = c[:, :3].max(1)
                lit = lum > (np.median(lum[lum > 0]) / 64.0 if (lum > 0).any() else 0.0)
                dark += int((~lit).sum())
                if lit.any() and not lit.all():
                    ev_ = np.empty(len(ob.data.edges) * 2, np.int32)
                    ob.data.edges.foreach_get("vertices", ev_)
                    ea, eb = ev_[0::2], ev_[1::2]
                    for _ in range(64):
                        acc_ = np.zeros((len(c), 3), np.float64)
                        cnt = np.zeros(len(c), np.float64)
                        for x_, y_ in ((ea, eb), (eb, ea)):
                            k_ = lit[y_] & ~lit[x_]
                            np.add.at(acc_, x_[k_], c[y_[k_], :3])
                            np.add.at(cnt, x_[k_], 1.0)
                        got = cnt > 0
                        if not got.any():
                            break
                        c[got, :3] = acc_[got] / cnt[got, None]
                        lit |= got
                    if not lit.all():
                        c[~lit, :3] = np.median(c[lit, :3], 0)
                # Each vertex is one bake without a denoiser: on a low sofa's big triangles its noise drew a mosaic.
                # Vertices at the same place facing the same way (the import splits them at every seam) share their
                # light, then two passes of their neighbours' average.
                nv_ = len(ob.data.vertices)
                co_ = np.empty(nv_ * 3, np.float32)
                ob.data.vertices.foreach_get("co", co_)
                vn_ = np.empty(nv_ * 3, np.float32)
                ob.data.vertices.foreach_get("normal", vn_)
                co_, vn_ = co_.reshape(-1, 3), vn_.reshape(-1, 3)
                ax_ = np.abs(vn_).argmax(1)
                side_ = ax_ * 2 + (vn_[np.arange(nv_), ax_] > 0)
                _, grp = np.unique(np.c_[np.round(co_ / 0.002).astype(np.int64), side_], axis=0, return_inverse=True)
                grp = grp.reshape(-1)
                ng = int(grp.max()) + 1
                def share(c3):
                    n_ = np.bincount(grp, minlength=ng).astype(np.float64)
                    return np.stack([np.bincount(grp, weights=c3[:, k], minlength=ng) / n_ for k in range(3)], 1)[grp]
                c3 = share(c[:, :3].astype(np.float64))
                ev_ = np.empty(len(ob.data.edges) * 2, np.int32)
                ob.data.edges.foreach_get("vertices", ev_)
                ea, eb = ev_[0::2], ev_[1::2]
                for _ in range(2):
                    acc_ = np.zeros_like(c3)
                    cnt = np.zeros(nv_, np.float64)
                    np.add.at(acc_, ea, c3[eb])
                    np.add.at(acc_, eb, c3[ea])
                    np.add.at(cnt, ea, 1.0)
                    np.add.at(cnt, eb, 1.0)
                    has = cnt > 0
                    c3[has] = 0.5 * c3[has] + 0.5 * acc_[has] / cnt[has, None]
                    c3 = share(c3)
                c[:, :3] = c3
                c[:, :3] = encode(c[:, :3])
                c[:, 3] = 1.0
                attr.data.foreach_set("color", c.reshape(-1))
            nvert = sum(len(o.data.vertices) for o in obs)
            print("TOUR_INFO bake %s %d objects, %d vertices (%.1f%% without light, filled from their neighbours)" % (group, len(obs), nvert, 100.0 * dark / max(nvert, 1)), flush=True)
        print("TOUR_INFO bake vertices %.1fs" % (time.time() - t1), flush=True)
        bpy.ops.object.select_all(action="DESELECT")
        archo.select_set(True)
        bpy.context.view_layer.objects.active = archo
        first_uv = me.uv_layers[0].name if me.uv_layers else None
        lm = me.uv_layers.new(name="LightMap")
        me.uv_layers.active = lm
        t1 = time.time()
        # Every island packed: with the UV selection apart from the mesh's, the new map's back sheets were left out
        # (54 % of the map used instead of 62). Projections within 45 degrees: at 66 a wall and the wall at right angles
        # to it could share one, and laid on each other (the fifth bake's black wall at points 5 and 6).
        scene.tool_settings.use_uv_select_sync = True
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(float(spec.get("lightmapAngle", 45))), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        # the gap between islands in texels of the map, whatever their number (SCALED shrank it with the islands)
        bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=float(spec.get("lightmapMargin", 3.0)) / int(spec.get("lightmapSize", 4096)), shape_method="AABB")
        bpy.ops.object.mode_set(mode="OBJECT")
        # edit mode rebuilt the layers: the one held from before points at freed memory (Blender crashed on it)
        lm = me.uv_layers["LightMap"]
        me.calc_loop_triangles()
        lt = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("loops", lt)
        uv = np.empty(len(me.loops) * 2, np.float32)
        lm.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)[lt].reshape(-1, 3, 2)
        uva = 0.5 * np.abs((uv[:, 1, 0] - uv[:, 0, 0]) * (uv[:, 2, 1] - uv[:, 0, 1]) - (uv[:, 2, 0] - uv[:, 0, 0]) * (uv[:, 1, 1] - uv[:, 0, 1]))
        lta = np.empty(len(me.loop_triangles), np.float32)
        me.loop_triangles.foreach_get("area", lta)
        size_ = int(spec.get("lightmapSize", 4096))
        print("TOUR_INFO bake architecture %d faces, %.0f m2, UVs %.1fs: %.1f%% of the map, %.0f texels a metre" % (len(me.polygons), lta.sum(), time.time() - t1, 100.0 * uva.sum(), size_ * math.sqrt(uva.sum() / max(lta.sum(), 1e-9))), flush=True)
        size = int(spec.get("lightmapSize", 4096))
        img = bpy.data.images.new("roomia_lightmap", size, size, float_buffer=True, alpha=False)
        for slot in archo.material_slots:
            m = slot.material
            if m is None:
                continue
            m.use_nodes = True
            node = m.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            node.name = "roomia_lightmap"
            m.node_tree.nodes.active = node
        t1 = time.time()
        # The UV map is named: left to the active one, the first bake (31 Oct) went through the textures' UVs and lit 0.2 %
        # of the walls.
        scene.cycles.samples = int(spec.get("bakeSamples", 256))
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, target="IMAGE_TEXTURES", uv_layer="LightMap", use_clear=True, margin=8)
        px = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(px)
        rgb = px.reshape(size, size, 4)[::-1, :, :3].copy()
        del px
        # A texel inside an island that got no light at all (0.5 % of them in the fourth bake) is black in the walk:
        # it takes its lit neighbours' mean when most of them are lit, so the space between the islands stays empty.
        holes = 0
        for _ in range(3):
            lit_ = rgb.max(2) > 0
            p_ = np.pad(rgb, ((1, 1), (1, 1), (0, 0)))
            pl_ = np.pad(lit_, 1).astype(np.float32)
            acc_ = np.zeros_like(rgb)
            cnt_ = np.zeros(lit_.shape, np.float32)
            for dy in range(3):
                for dx in range(3):
                    if dy != 1 or dx != 1:
                        acc_ += p_[dy:dy + size, dx:dx + size]
                        cnt_ += pl_[dy:dy + size, dx:dx + size]
            hole = ~lit_ & (cnt_ >= 5)
            rgb[hole] = acc_[hole] / cnt_[hole, None]
            holes += int(hole.sum())
            del p_, pl_, acc_, cnt_
        print("TOUR_INFO bake lightmap %d holes filled" % holes, flush=True)
        back = np.ones((size, size, 4), np.float32)
        back[:, :, :3] = rgb[::-1]
        img.pixels.foreach_set(back.reshape(-1))
        del back
        print("TOUR_INFO bake lightmap %dx%d, %.1f%% of it lit, %.1fs" % (size, size, 100.0 * float((rgb.max(2) > 0).mean()), time.time() - t1), flush=True)
        # OIDN through the compositor of an empty scene (Python has no other way to it): a bake has no denoiser.
        t1 = time.time()
        if spec.get("bakeDenoise", True):
            try:
                sc = bpy.data.scenes.new("roomia_denoise")
                cam_ = bpy.data.objects.new("roomia_denoise_cam", bpy.data.cameras.new("roomia_denoise_cam"))
                sc.collection.objects.link(cam_)
                sc.camera = cam_
                sc.render.engine = "BLENDER_WORKBENCH"
                sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = size, size, 100
                sc.use_nodes = True
                nt = sc.node_tree
                for n in list(nt.nodes):
                    nt.nodes.remove(n)
                src = nt.nodes.new("CompositorNodeImage")
                src.image = img
                dn = nt.nodes.new("CompositorNodeDenoise")
                dn.use_hdr = True
                comp = nt.nodes.new("CompositorNodeComposite")
                nt.links.new(src.outputs["Image"], dn.inputs["Image"])
                nt.links.new(dn.outputs["Image"], comp.inputs["Image"])
                sc.render.image_settings.file_format = "OPEN_EXR"
                sc.render.image_settings.color_depth = "32"
                sc.render.filepath = os.path.join(out_dir, "lightmap-denoised.exr")
                bpy.ops.render.render(write_still=True, scene=sc.name)
                inp = oiio.ImageInput.open(sc.render.filepath)
                den = inp.read_image(0, 0, 0, 3, "float").reshape(size, size, 3)
                inp.close()
                os.remove(sc.render.filepath)
                # not part of the place: it would go into the export as an empty scene
                bpy.data.objects.remove(cam_)
                bpy.data.scenes.remove(sc)
                # only where something was baked: the empty space between the islands stays empty
                rgb = np.where(rgb.max(2, keepdims=True) > 0, np.maximum(den, 0.0), 0.0).astype(np.float32)
                print("TOUR_INFO bake lightmap denoised %.1fs" % (time.time() - t1), flush=True)
            except Exception as e:
                print("TOUR_INFO bake lightmap not denoised: %s" % e, flush=True)
        lit = rgb.max(2) > 0
        median = float(np.median((rgb[lit] @ LUMA))) if lit.any() else 0.0
        rng = np.random.default_rng(1)
        code = encode(rgb) * np.float32(255.0) + rng.uniform(-0.5, 0.5, rgb.shape).astype(np.float32)
        out = np.clip(np.round(code), 0, 255).astype(np.uint8)
        del code
        path_lm = os.path.join(out_dir, "explore-light.png")
        o_ = oiio.ImageOutput.create(path_lm)
        o_.open(path_lm, oiio.ImageSpec(size, size, 3, "uint8"))
        o_.write_image(out)
        o_.close()
        del out
        # the lightmap node is not part of the shading; it goes before the export so it is not written as a texture
        for slot in archo.material_slots:
            if slot.material is not None and "roomia_lightmap" in slot.material.node_tree.nodes:
                slot.material.node_tree.nodes.remove(slot.material.node_tree.nodes["roomia_lightmap"])
        if first_uv:
            me.uv_layers.active = me.uv_layers[first_uv]
        bpy.ops.object.select_all(action="DESELECT")
        for n, k in kinds.items():
            ob = scene.objects.get(n)
            if ob is not None:
                ob.select_set(True)
        archo.select_set(True)
        deto.select_set(True)
        t1 = time.time()
        # AUTO keeps each texture as it came (PNG or JPEG): converting to WEBP here lost Plaster_05 on the Ecolodge
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "explore.glb"), export_format="GLB", use_selection=True, export_yup=True,
                                  export_texcoords=True, export_normals=True, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                                  export_materials="EXPORT", export_image_format="AUTO", export_lights=False, export_cameras=False)
        with open(os.path.join(out_dir, "explore.json"), "w") as f:
            json.dump({"encoding": "log2", "lo": LO, "hi": HI, "exposureEv": ev_fixed, "fill": fill, "medianLight": median,
                       "viewEv": {str(i): evs[i] for i in frames}, "lightmapSize": size, "samples": scene.cycles.samples,
                       "furniture": [n for n, k in kinds.items() if k == "furniture"], "glass": [n for n, k in kinds.items() if k == "glass"]}, f)
        print("TOUR_INFO bake export %.1fs; median light %.3f at the exposure; total %.1fs" % (time.time() - t1, median, time.time() - t_bake), flush=True)
        print("TOUR_OK", flush=True)
        raise SystemExit(0)
    cam_data.type = "PERSP"
    scene.view_settings.exposure = 0.0
    if energy > 0:
        sun_data.energy = sun_energy
    scene.render.use_simplify = False
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = scene.render.resolution_y = FACE
elif FULL and spec.get("faceMode", "animation") == "animation":
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
for i, eye in enumerate(all_eyes if FULL and not CYCLES_PANO and spec.get("faceMode", "animation") != "animation" else []):
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

# 5. Mirrors (27 Oct, Suite): EEVEE cannot show what a mirror faces when that is behind the camera, so mirrors came
# out as flat beige panels (and the paste-back of 27 Oct put that panel back). The reflection is made afterwards
# from the panorama itself (REFLECT_SCRIPT): Blender gives, per viewpoint, how far the first surface is in every
# direction, and the mirrors' pixels with their distance and orientation.
MIRROR_MATS = {m.name for m in bpy.data.materials if m.use_nodes and role_of(m) == "mirror"}
surface_tree = None

def surfaces():
    # One tree of this storey, each triangle with its kind: 0 a surface, 1 a mirror, 2 glass (seen through).
    global surface_tree
    if surface_tree is not None:
        return surface_tree
    from mathutils.bvhtree import BVHTree
    verts, tris, kinds, offset = [], [], [], 0
    for ob in scene.objects:
        if ob.type != "MESH" or ob.hide_render or not ob.visible_get():
            continue
        me = ob.data
        me.calc_loop_triangles()
        if len(me.loop_triangles) == 0:
            continue
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        tri = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("vertices", tri)
        mi = np.empty(len(me.loop_triangles), np.int32)
        me.loop_triangles.foreach_get("material_index", mi)
        tri = tri.reshape(-1, 3)
        mw = np.array(ob.matrix_world, np.float32)
        w = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
        z, xy = w[:, 2][tri], w[:, :2][tri]
        keep = ((z.max(1) > SURFACE_Z[0] - 0.5) & (z.min(1) < SURFACE_Z[1] + 0.5) & (xy[:, :, 0].max(1) > lo.x - 2) & (xy[:, :, 0].min(1) < hi.x + 2)
                & (xy[:, :, 1].max(1) > lo.y - 2) & (xy[:, :, 1].min(1) < hi.y + 2))
        if not keep.any():
            continue
        slot_kinds = []
        for slot in ob.material_slots:
            m = slot.material
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m is not None and m.use_nodes else None
            glass = b is not None and (b.inputs["Transmission Weight"].default_value > 0.5 or b.inputs["Alpha"].default_value < 0.6)
            slot_kinds.append(1 if m is not None and m.name in MIRROR_MATS else 2 if glass else 0)
        table = np.array(slot_kinds or [0], np.int8)
        used = np.unique(tri[keep])
        remap = np.full(len(w), -1, np.int64)
        remap[used] = np.arange(len(used)) + offset
        verts.append(w[used])
        tris.append(remap[tri[keep]])
        kinds.append(table[np.clip(mi[keep], 0, len(table) - 1)])
        offset += len(used)
    V = np.concatenate(verts) if verts else np.zeros((0, 3), np.float32)
    T = np.concatenate(tris) if tris else np.zeros((0, 3), np.int64)
    surface_tree = (BVHTree.FromPolygons(V, T, all_triangles=True), np.concatenate(kinds) if kinds else np.zeros(0, np.int8))
    return surface_tree

def surface_hit(o, d):
    # Distance, normal and kind of the first surface along d (glass is passed through).
    tree, kinds = surfaces()
    start = o
    for _ in range(8):
        loc, nrm, idx, _dist = tree.ray_cast(o, d, 80.0)
        if loc is None:
            return None, None, 0
        if kinds[idx] != 2:
            return (loc - start).length, nrm, int(kinds[idx])
        o = loc + d * 0.01
    return None, None, 0

def pano_dir(col, row, w, h, yaw):
    # The panoramas' own projection (STITCH_SCRIPT): the middle column looks along yaw, left to right turns right.
    lon = (col + 0.5) / w * 2 * math.pi - math.pi
    lat = math.pi / 2 - (row + 0.5) / h * math.pi
    az = yaw - lon
    return Vector((math.cos(lat) * math.cos(az), math.cos(lat) * math.sin(az), math.sin(lat)))

def mirror_data(i, eye, yaw):
    if not MIRROR_MATS:
        return
    t0 = time.time()
    # A quick look first: most viewpoints see no mirror.
    if not any(surface_hit(eye, pano_dir(c, r, 128, 64, yaw))[2] == 1 for r in range(64) for c in range(128)):
        return
    W, H, F = 1024, 512, 4
    depth = np.full((H, W), 80.0, np.float32)
    kind = np.zeros((H, W), np.int8)
    for r in range(H):
        for c in range(W):
            t, _n, k = surface_hit(eye, pano_dir(c, r, W, H, yaw))
            if t is not None:
                depth[r, c], kind[r, c] = t, k
    # The mirrors again at the panorama's size (F x F rays per pixel above) for clean edges.
    near = kind == 1
    near = near | np.roll(near, 1, 0) | np.roll(near, -1, 0) | np.roll(near, 1, 1) | np.roll(near, -1, 1)
    rows, cols, ts, ns = [], [], [], []
    for r0, c0 in zip(*np.nonzero(near)):
        for a in range(F):
            for b in range(F):
                r, c = int(r0) * F + a, int(c0) * F + b
                t, n, k = surface_hit(eye, pano_dir(c, r, W * F, H * F, yaw))
                if k == 1:
                    rows.append(r); cols.append(c); ts.append(t); ns.append(tuple(n))
    np.savez_compressed(os.path.join(out_dir, "mirror-%d.npz" % i), yaw=np.float32(yaw), width=np.int32(W * F), depth=depth.astype(np.float16),
                        rows=np.array(rows, np.int32), cols=np.array(cols, np.int32), t=np.array(ts, np.float32), n=np.array(ns, np.float32).reshape(-1, 3))
    print("TOUR_INFO mirrors view %d: %d pixels, %.1fs" % (i, len(rows), time.time() - t0), flush=True)

def ceiling_mask(eye, forward, up, fov, path, N=256):
    # The upward face of an AI 360°: its ceiling (and what hangs from it) stays Blender, its walls come from the
    # image model, so the walls go on to the ceiling without the break of a whole Blender face (27 Oct, Suite).
    f = Vector(forward)
    rt = f.cross(Vector(up)).normalized()
    u = rt.cross(f).normalized()
    th = math.tan(math.radians(fov / 2))
    m = np.zeros((N, N), np.uint8)
    for k in range(N):
        y = 1 - (k + 0.5) / N * 2
        for j in range(N):
            d = (f + rt * (((j + 0.5) / N * 2 - 1) * th) + u * (y * th)).normalized()
            # The tree, not scene.ray_cast: 5.7 us a ray instead of 1.7 ms (27 Oct, Suite).
            t, nrm, _k = surface_hit(eye, d)
            if t is not None and abs(nrm.normalized().z) > 0.7 and d.z * t > 0.4:
                m[k, j] = 1
    np.save(path, m)

# Cycles reflects the room in the mirrors itself.
if FULL and MIRROR_MATS and not CYCLES_PANO:
    for i, yaw in sorted(({v["index"]: v["yaw"] for v in meta["views"] if not v["outside"]} | {a["index"]: a["yaw"] for a in meta.get("auto", [])}).items()):
        mirror_data(i, all_eyes[i], yaw)
    surface_tree = None

def ai_faces(fwd):
    # The six faces of a photo-quality 360°, the same as in 3. below.
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    return [("front", fwd, Vector((0, 0, 1))), ("right", right, Vector((0, 0, 1))), ("back", -fwd, Vector((0, 0, 1))),
            ("left", -right, Vector((0, 0, 1))), ("up", Vector((0, 0, 1)), -fwd), ("down", Vector((0, 0, -1)), fwd)]

def read_mask(path):
    img = bpy.data.images.load(path)
    px = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    os.remove(path)
    return int((px[0::4] > 0.5).sum())

# 4. A new version of the file (27 Oct): which faces of the photo-quality 360° views and which photos can see
# what changed. Every face and photo view rendered small and flat, the new or changed objects white, the
# places where removed objects stood as white boxes, everything else black. One sample each: seconds.
if FULL and spec.get("previousObjects"):
    t_mask = time.time()
    report = {"offset": [file_shift.x, file_shift.z, -file_shift.y], "added": len(changed), "removed": len(ghosts), "faces": {}, "photos": {}}
    if changed or ghosts:
        names = {o["name"] for o in changed}
        for ob in scene.objects:
            ob.color = (1, 1, 1, 1) if ob.name in names else (0, 0, 0, 1)
        for o in ghosts:
            lo_, hi_ = Vector(o["lo"]) + file_shift, Vector(o["hi"]) + file_shift
            bpy.ops.mesh.primitive_cube_add(location=(lo_ + hi_) / 2)
            box = bpy.context.object
            box.name = "roomia_ghost"
            box.scale = [max(0.01, (hi_[a] - lo_[a]) / 2) for a in range(3)]
            box.color = (1, 1, 1, 1)
        flat = bpy.data.materials.new("roomia_mask")
        flat.use_nodes = True
        nodes, links = flat.node_tree.nodes, flat.node_tree.links
        nodes.clear()
        info, glow, out = nodes.new("ShaderNodeObjectInfo"), nodes.new("ShaderNodeEmission"), nodes.new("ShaderNodeOutputMaterial")
        links.new(info.outputs["Color"], glow.inputs["Color"])
        links.new(glow.outputs[0], out.inputs["Surface"])
        # Every object drawn with it (the view layer's material override is ignored by this renderer).
        for ob in scene.objects:
            if ob.type == "LIGHT":
                ob.hide_render = True
            elif ob.type == "MESH":
                if not ob.material_slots:
                    ob.data.materials.append(flat)
                for slot in ob.material_slots:
                    slot.link = "OBJECT"
                    slot.material = flat
        bg.inputs[1].default_value = 0.0
        scene.eevee.taa_render_samples = 1
        scene.eevee.use_raytracing = False
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0.0
        scene.render.film_transparent = False
        for ob in (cam, probe, dome):
            if ob is not None:
                ob.animation_data_clear()
        cam_data.sensor_fit = "VERTICAL"

        def render_frames(frames, w, h, prefix):
            # frames: (key, matrix, vertical fov in degrees)
            scene.render.resolution_x, scene.render.resolution_y = w, h
            for f, (key, mat, fov) in enumerate(frames, 1):
                cam.matrix_world = mat
                cam.keyframe_insert("location", frame=f)
                cam.keyframe_insert("rotation_euler", frame=f)
                cam_data.angle = math.radians(fov)
                cam_data.keyframe_insert("lens", frame=f)
            for owner in (cam, cam_data):
                if owner.animation_data and owner.animation_data.action:
                    for fc in owner.animation_data.action.fcurves:
                        for kp in fc.keyframe_points:
                            kp.interpolation = "CONSTANT"
            scene.frame_start, scene.frame_end = 1, max(1, len(frames))
            scene.render.filepath = os.path.join(out_dir, prefix)
            counts = {}
            if frames:
                bpy.ops.render.render(animation=True)
                for f, (key, _, _) in enumerate(frames, 1):
                    counts[key] = read_mask(os.path.join(out_dir, "%s%04d.png" % (prefix, f)))
            cam.animation_data_clear()
            cam_data.animation_data_clear()
            return counts

        heads = {v["index"]: v["yaw"] for v in meta["views"] if not v["outside"]}
        heads.update({a["index"]: a["yaw"] for a in meta.get("auto", [])})
        frames = []
        for i, yaw in sorted(heads.items()):
            for name, forward, up in ai_faces(Vector((math.cos(yaw), math.sin(yaw), 0.0))):
                aim(all_eyes[i], forward, up)
                frames.append(((i, name), cam.matrix_world.copy(), float(spec.get("aiFov", 100))))
        for (i, name), n in render_frames(frames, 128, 128, "mask-").items():
            report["faces"].setdefault(str(i), {})[name] = n
        frames = []
        for p in spec.get("updatePhotos", []):
            px_, py_, pz_ = p["position"]
            qx, qy, qz, qw = p["quaternion"]
            mat = (M @ Quaternion((qw, qx, qy, qz)).to_matrix()).to_4x4()
            mat.translation = Vector((px_, -pz_, py_))
            frames.append((p["file"], mat, float(p["fov"])))
        report["photos"] = render_frames(frames, 192, 128, "maskp-")
    with open(os.path.join(out_dir, "update-masks.json"), "w") as fh:
        json.dump(report, fh)
    print("TOUR_INFO update masks %.1fs" % (time.time() - t_mask), flush=True)

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
    # Mirrors (27 Oct): the image model read two arched mirrors as windows onto a garden (Bloc B F5, Point 9).
    # Every face also gets a mask of where the mirrors are, drawn by the render itself (a shader output that
    # only mirror materials write): it tells the prompt there is a mirror, and the real reflection is put back.
    mirror_mats = [m for m in bpy.data.materials if m.use_nodes and role_of(m) == "mirror"]
    if mirror_mats:
        aov = bpy.context.view_layer.aovs.add()
        aov.name, aov.type = "roomia_mirror", "VALUE"
        for m in mirror_mats:
            node = m.node_tree.nodes.new("ShaderNodeOutputAOV")
            node.aov_name = "roomia_mirror"
            node.inputs["Value"].default_value = 1.0
        scene.use_nodes = True
        tree = scene.node_tree
        rl = next((n for n in tree.nodes if n.type == "R_LAYERS"), None) or tree.nodes.new("CompositorNodeRLayers")
        comp = next((n for n in tree.nodes if n.type == "COMPOSITE"), None) or tree.nodes.new("CompositorNodeComposite")
        if not comp.inputs["Image"].is_linked:
            tree.links.new(rl.outputs["Image"], comp.inputs["Image"])
        mirror_out = tree.nodes.new("CompositorNodeOutputFile")
        mirror_out.base_path = out_dir
        mirror_out.format.file_format = "PNG"
        mirror_out.format.color_mode = "BW"
        mirror_out.file_slots[0].path = "aimirror-"
        tree.links.new(rl.outputs["roomia_mirror"], mirror_out.inputs[0])
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
            ceiling = None
            if name == "up":
                ceiling = os.path.join(out_dir, "ai-%d-up-ceiling.npy" % i)
                ceiling_mask(eye, forward, up, AI_FOV, ceiling)
            meta["faces"].append({"name": name, "forward": list(forward), "up": list(up), "capture": path, "near": near, "distance": round(median, 2), "bare": bare, "planes": round(bare_share, 2),
                                  "mirror": os.path.join(out_dir, "ai-%d-%s-mirror.png" % (i, name)) if mirror_mats else None, "ceiling": ceiling})
            print("TOUR_INFO face %d %s planes %.2f%s%s" % (i, name, bare_share, " bare" if bare else "", " near" if near else ""), flush=True)
        mirror_data(i, eye, math.atan2(fwd.y, fwd.x))
        ai_metas.append((i, meta))
    surface_tree = None
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
        mask = os.path.join(out_dir, "aimirror-%04d.png" % f)
        if os.path.exists(mask):
            os.replace(mask, path[:-4] + "-mirror.png")
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
# the level's files carry its suffix ("" for the main level, "-n<level>" for the others)
sfx = sys.argv[8] if len(sys.argv) > 8 else ""
render = Image.open(work + "/plan-hd%s.png" % sfx).convert("RGBA")
W, H = render.size
segments = np.load(work + "/plan-lines%s.npy" % sfx)
tall = segments[:, 4] > 0.5 if segments.shape[1] > 4 else np.ones(len(segments), bool)
width = max(2, round(max(W, H) / 900))
hd_mpp = mpp * web_w / W
blender_meta = json.load(open(work + "/tour-blender.json"))
plan_meta = next((L for L in blender_meta.get("levels", []) if L.get("suffix") == sfx), blender_meta["plan"])

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
if rooms and plan_meta.get("frame") and os.path.exists(work + "/plan-rooms%s.npy" % sfx):
    grid = np.load(work + "/plan-rooms%s.npy" % sfx).astype(bool)
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
import os, sys
import numpy as np
from PIL import Image

face_dir, index, yaw, out, width = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], int(sys.argv[5])
height = width // 2
raw = "%s/pano-raw-%s.png" % (face_dir, index)

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

def grade_cycles(x):
    # Cycles has true light and colour already: the EEVEE grade above turned it orange. A little colour and contrast only.
    x = np.clip(x / 255, 0, 1)
    lum = (x * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    x = np.clip(lum + (x - lum) * 1.06, 0, 1)
    k = 2.6
    s = 1 / (1 + np.exp(-k * (x - 0.5)))
    lo, hi = 1 / (1 + np.exp(k * 0.5)), 1 / (1 + np.exp(-k * 0.5))
    return (s - lo) / (hi - lo) * 255

# A Cycles panorama (panoEngine "cycles") is rendered whole, already centred on the view: only graded.
if os.path.exists(raw):
    img = np.asarray(Image.open(raw).convert("RGB").resize((width, height), Image.LANCZOS), np.float32)
    Image.fromarray(np.clip(grade_cycles(img) + 0.5, 0, 255).astype(np.uint8)).save(out, quality=90, optimize=True, progressive=True)
    sys.exit(0)

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

/**
 * The Blender 360°: 'cycles' renders each one whole with a 360° camera (28 Oct); 'eevee' renders six cube faces that are
 * stitched (faster, but EEVEE lights each face differently and the ceiling showed the edge of the upward one).
 */
const PANO_ENGINE = process.env.ROOMIA_PANO_ENGINE === 'eevee' ? 'eevee' : 'cycles'
/**
 * Cycles samples per 360°: at 32 and 64 the denoiser left smudges on ceilings lit only by bounced light, 128 is clean
 * (Ecolodge 28 Oct: about 30 s, 50 s and 90 s per viewpoint on the RTX 3060).
 */
const CYCLES_SAMPLES = Math.max(16, Number(process.env.ROOMIA_CYCLES_SAMPLES ?? 128))
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
faces.json: {"fov": 100, "heading": [x, y, z], "faces": [{"name", "forward", "up", "image", "ai": bool, "mask"?, "invert"?}, ...]}
mask: a .npy of where the face counts (1) or not (0), all of it inverted with "invert"."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

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
    mask = None
    if f.get("mask"):
        m = np.asarray(Image.fromarray(np.load(f["mask"]).astype(np.float32)).resize((1024, 1024), Image.BILINEAR), np.float32)
        m = np.clip(ndimage.gaussian_filter(m, 6), 0, 1)
        mask = 1 - m if f.get("invert") else m
    faces.append({"name": f.get("name", ""), "f": fw, "r": r, "u": u, "img": img, "ai": bool(f["ai"]), "gain": np.ones(3, np.float32), "mask": mask})


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
    if face["mask"] is not None:
        w = w * face["mask"][y0, x0]
    if face["ai"]:
        return c * face["gain"], w
    # A lit lamp in a Blender face stays white: darkened to the AI faces' exposure it turned grey, a lamp
    # switched off next to the lamps the image model lit (27 Oct, Suite ceilings).
    lit = np.clip((c.mean(-1, keepdims=True) - 215) / 30, 0, 1)
    return c * face["gain"] * (1 - lit) + c * np.maximum(face["gain"], 1) * lit, w


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

/**
 * Mirrors in an AI face (27 Oct). "info <mask>": how much of the face is mirror and where, for the prompt.
 * "paste <capture> <mask> <ai> <out>": the mirrors of the Blender capture put back into the AI picture, brought
 * to the AI picture's exposure and colour, with a soft edge: a mirror can never come back as a window.
 */
/** ROOMIA_MIRROR_PASTE=0 lets the image model's own mirrors through (they look richer, but may show a window). */
const MIRROR_PASTE = process.env.ROOMIA_MIRROR_PASTE !== '0'
/** Less mirror than this in a face (a sliver at an edge) is left to the model. */
const MIRROR_MIN_SHARE = 0.003
const mirrorPrompt = (where: string) =>
  `This picture contains a mirror (${where}). Keep it a mirror exactly where it is, reflecting this same room: it is not a window, a door or an opening, and it never shows an outdoor view.`

const MIRROR_SCRIPT = String.raw`
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

def load_mask(path, size):
    return np.asarray(Image.open(path).convert("L").resize((size, size), Image.NEAREST)) > 127

if sys.argv[1] == "info":
    m = load_mask(sys.argv[2], 256)
    share = float(m.mean())
    where = ""
    if share > 0:
        ys, xs = np.nonzero(m)
        x, y = xs.mean() / 256, ys.mean() / 256
        h = "on the left" if x < 0.36 else "on the right" if x > 0.64 else "in the middle"
        v = "upper part" if y < 0.36 else "lower part" if y > 0.64 else ""
        where = h + (", " + v if v else "")
    print(json.dumps({"share": round(share, 4), "where": where}))
else:
    capture, mask, ai, out = sys.argv[2:6]
    a = np.asarray(Image.open(ai).convert("RGB"), np.float32)
    S = a.shape[0]
    c = np.asarray(Image.open(capture).convert("RGB").resize((S, S), Image.LANCZOS), np.float32)
    m = load_mask(mask, S)
    grown = ndimage.binary_dilation(m, iterations=max(1, S // 400))
    soft = np.clip(ndimage.gaussian_filter(grown.astype(np.float32), S / 700), 0, 1)[..., None]
    # The capture's light is neutral: its colours are brought to the AI picture's, measured on the rest of the face.
    rest = ~ndimage.binary_dilation(m, iterations=S // 50)
    la, lc = a.mean(-1), c.mean(-1)
    rest &= (la > 20) & (la < 235) & (lc > 20) & (lc < 235)
    gain = np.ones(3, np.float32)
    if rest.sum() > 1000:
        gain = np.clip(np.median((a[rest] + 1) / (c[rest] + 1), 0), 0.6, 1.6)
    mixed = a * (1 - soft) + np.clip(c * gain, 0, 255) * soft
    Image.fromarray(np.clip(mixed + 0.5, 0, 255).astype(np.uint8)).save(out, quality=95)
    print(json.dumps({"gain": [round(float(g), 3) for g in gain]}))
`

/**
 * The mirrors of a panorama made from the panorama itself (27 Oct, Suite): each mirror pixel shows what its reflected
 * ray meets, found by stepping along that ray against the distances Blender measured around the viewpoint (the
 * mirror-N.npz of the tour script). The reflection is the room as the panorama shows it, AI or Blender, so it
 * always matches. Usage: reflect.py <pano.jpg> <mirror-N.npz>; the panorama is rewritten.
 */
const REFLECT_SCRIPT = String.raw`
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

pano_path, data_path = sys.argv[1], sys.argv[2]
data = np.load(data_path)
rows, cols = data["rows"], data["cols"]
pano = np.asarray(Image.open(pano_path).convert("RGB"), np.float32)
H, W = pano.shape[:2]
if len(rows) == 0 or W != int(data["width"]):
    print("no mirror")
    sys.exit(0)
yaw = float(data["yaw"])
depth = data["depth"].astype(np.float32)
dh, dw = depth.shape

def dirs(r, c, w, h):
    lon = (c + 0.5) / w * 2 * np.pi - np.pi
    lat = np.pi / 2 - (r + 0.5) / h * np.pi
    az = yaw - lon
    return np.stack([np.cos(lat) * np.cos(az), np.cos(lat) * np.sin(az), np.sin(lat)], -1)

def to_pixel(q, w, h):
    lon = np.mod(yaw - np.arctan2(q[..., 1], q[..., 0]) + np.pi, 2 * np.pi) - np.pi
    lat = np.arcsin(np.clip(q[..., 2], -1, 1))
    return (lon + np.pi) / (2 * np.pi) * w - 0.5, (np.pi / 2 - lat) / np.pi * h - 0.5

def depth_at(q):
    x, y = to_pixel(q, dw, dh)
    return depth[np.clip(np.round(y).astype(np.int64), 0, dh - 1), np.mod(np.round(x).astype(np.int64), dw)]

d = dirs(rows.astype(np.float32), cols.astype(np.float32), W, H)
n = data["n"] / np.maximum(np.linalg.norm(data["n"], axis=-1, keepdims=True), 1e-6)
n = np.where((n * d).sum(-1, keepdims=True) > 0, -n, n)
p = d * data["t"][:, None]
r = d - 2 * (d * n).sum(-1, keepdims=True) * n
steps = np.geomspace(0.03, 40, 192).astype(np.float32)
colour = np.empty((len(rows), 3), np.float32)
for s0 in range(0, len(rows), 4096):
    P, R = p[s0:s0 + 4096], r[s0:s0 + 4096]
    Q = P[:, None, :] + R[:, None, :] * steps[None, :, None]
    L = np.linalg.norm(Q, axis=-1)
    D = depth_at(Q / L[..., None])
    behind = L >= D - 0.01
    # A hit is a step just behind the surface seen from the eye; far behind it, the ray passed behind something.
    hit = behind & (L - D < 0.15 + 0.1 * D)
    first = np.where(hit.any(1), hit.argmax(1), np.where(behind.any(1), behind.argmax(1), len(steps) - 1))
    lo_s, hi_s = steps[np.maximum(first - 1, 0)], steps[first]
    for _ in range(6):
        mid = (lo_s + hi_s) / 2
        Qm = P + R * mid[:, None]
        Lm = np.linalg.norm(Qm, axis=-1)
        b = Lm >= depth_at(Qm / Lm[:, None]) - 0.01
        hi_s, lo_s = np.where(b, mid, hi_s), np.where(b, lo_s, mid)
    Qh = P + R * hi_s[:, None]
    x, y = to_pixel(Qh / np.linalg.norm(Qh, axis=-1, keepdims=True), W, H)
    x0 = np.floor(x).astype(np.int64); y0 = np.clip(np.floor(y).astype(np.int64), 0, H - 2)
    fx = (x - x0)[:, None]; fy = np.clip(y - y0, 0, 1)[:, None]
    xa, xb = np.mod(x0, W), np.mod(x0 + 1, W)
    colour[s0:s0 + 4096] = (pano[y0, xa] * (1 - fx) * (1 - fy) + pano[y0, xb] * fx * (1 - fy)
                            + pano[y0 + 1, xa] * (1 - fx) * fy + pano[y0 + 1, xb] * fx * fy)
mask = np.zeros((H, W), np.float32)
mask[rows, cols] = 1
alpha = (ndimage.gaussian_filter(mask, 0.8) * mask)[..., None]
reflected = np.zeros_like(pano)
reflected[rows, cols] = colour * 0.93  # a mirror gives back a little less light than it receives
# Slightly soft, like a real mirror seen in a photo: hides the steps where the reflected rays meet curtain folds.
reflected = ndimage.gaussian_filter(reflected, (1.2, 1.2, 0)) / np.maximum(ndimage.gaussian_filter(mask, 1.2), 1e-3)[..., None]
out = pano * (1 - alpha) + reflected * alpha
Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)).save(pano_path, quality=90, optimize=True, progressive=True)
print("mirror pixels", len(rows))
`

/**
 * Empties a work folder. On the project's NTFS disk a file still open somewhere is only renamed .fuse_hidden… when
 * deleted, and its folder cannot be removed (ENOTEMPTY, 27 Oct): what is left is harmless and must not stop a job.
 */
async function clearDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(err => console.error('work folder not removed', dir, err.code))
}

/** The reflections of a panorama's mirrors (REFLECT_SCRIPT), when Blender found mirrors around its viewpoint. */
async function reflectMirrors(script: string, pano: string, data: string): Promise<boolean> {
  if (!(await stat(data).then(() => true, () => false))) return false
  const done = await run(PYTHON, [script, pano, data])
  if (done.code !== 0) console.error('tour mirror reflection failed', pano, done.stderr.slice(-500))
  return done.code === 0
}

/**
 * One face cut back out of a finished panorama (27 Oct, updates of AI 360° made before the faces were kept): the
 * reverse of STITCH_AI_SCRIPT's projection. Usage: pano_face.py <pano.jpg> <face.json> <out.jpg>, face.json: {"fov",
 * "heading", "forward", "up", "size"}.
 */
const PANO_FACE_SCRIPT = String.raw`
import json, sys
import numpy as np
from PIL import Image

pano = np.asarray(Image.open(sys.argv[1]).convert("RGB"), np.float32)
spec = json.load(open(sys.argv[2]))
H, W = pano.shape[:2]
S = int(spec.get("size", 1024))
tan_half = np.tan(np.radians(spec["fov"] / 2))
f = np.array(spec["forward"], np.float32); up = np.array(spec["up"], np.float32)
r = np.cross(f, up); r /= np.linalg.norm(r); u = np.cross(r, f)
h = np.array(spec["heading"], np.float32)
yaw0 = float(np.arctan2(h[1], h[0]))
g = (np.arange(S, dtype=np.float32) + 0.5) / S * 2 - 1
x, y = np.meshgrid(g, -g)
d = f[None, None] + (x[..., None] * r + y[..., None] * u) * tan_half
d /= np.linalg.norm(d, axis=-1, keepdims=True)
az = np.arctan2(d[..., 1], d[..., 0])
lat = np.arcsin(np.clip(d[..., 2], -1, 1))
col = ((yaw0 - az + np.pi) % (2 * np.pi)) / (2 * np.pi) * W - 0.5
row = (np.pi / 2 - lat) / np.pi * H - 0.5
c0 = np.floor(col).astype(np.int32); r0 = np.clip(np.floor(row).astype(np.int32), 0, H - 1)
fc = (col - c0)[..., None]; fr = np.clip(row - r0, 0, 1)[..., None]
c1 = (c0 + 1) % W; c0 %= W; r1 = np.clip(r0 + 1, 0, H - 1)
out = pano[r0, c0] * (1 - fc) * (1 - fr) + pano[r0, c1] * fc * (1 - fr) + pano[r1, c0] * (1 - fc) * fr + pano[r1, c1] * fc * fr
Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)).save(sys.argv[3], quality=95)
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
/** One upscale at a time on the GPU (pano-upscale.ts). */
const withUpscaleSlot = limiter(1)
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

/** The scene settings of a tour build. The objects' fingerprints include the materials as these settings leave them,
 * so a build and a fingerprint-only run must use the same ones. */
export async function tourSceneSpec(sceneId: string) {
  return {
    glb: sourcePath(sceneId),
    realGlass: true,
    sharpMirrors: false,
    outdoorSky: true,
    interior: TOUR_LIGHTING.interior,
    roles: await readMaterialRoles(sceneId),
    finishRoughness: FINISH_ROUGHNESS,
    lighting: blenderLighting(TOUR_LIGHTING),
  }
}

/** The latest photo of each saved view (what the tour shows), with the view it was taken from. */
async function latestPhotos(sceneId: string, cameras: SceneCamera[]) {
  const seen = new Set<string>()
  const found: { file: string; view: ViewSpec; camera: number; time?: string; lens: string }[] = []
  for (const photo of await listPhotos(sceneId)) {
    const camera = cameras.findIndex(c => c.name === photo.view)
    if (camera < 0 || seen.has(photo.view!)) continue
    seen.add(photo.view!)
    const lens = photo.lens === 'file' || photo.lens === '35' || photo.lens === '24' || photo.lens === '18' ? photo.lens : '24'
    found.push({ file: photo.file, view: viewFromSceneCamera(cameras[camera], lensHfov(lens, cameras[camera])), camera, time: photo.time, lens })
  }
  return found
}

async function build(sceneId: string, cameras: SceneCamera[], { shiftViews = false } = {}) {
  const started = performance.now()
  const dir = tourDir(sceneId)
  const work = path.join(dir, 'work')
  await clearDir(work)
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
  // A new version of the file, with the fingerprints of the old one: an update. The points stay where they were
  // and only what sees a change is redone (see TourUpdate).
  const objectsPath = path.join(dir, 'objects.json')
  const isUpdate = !!before && !same && (await stat(objectsPath).then(() => true, () => false))
  const photos = isUpdate ? await latestPhotos(sceneId, cameras) : []
  const beforeAuto = (before?.views ?? []).filter(v => v.auto && v.position && v.target).sort((a, b) => a.index - b.index)
  const scriptPath = path.join(work, 'tour.py')
  const specPath = path.join(work, 'tour.json')
  await writeFile(scriptPath, TOUR_SCRIPT)
  await writeFile(
    specPath,
    JSON.stringify({
      ...(await tourSceneSpec(sceneId)),
      outDir: work,
      views: cameras.map(c => ({ name: c.name, position: c.position, target: c.target })),
      previousAuto: beforeAuto.map(v => ({ position: v.position, target: v.target, keep: Boolean(v.panoAi), approved: Boolean(v.panoAiApproved) })),
      previousSame: same || isUpdate,
      ...(isUpdate ? { previousObjects: objectsPath, shiftViews, updatePhotos: photos.map(p => ({ file: p.file, ...p.view })), aiFov: 100 } : {}),
      faceSize: FACE_SIZE,
      planSize: PLAN_SIZE,
      viewTransform: 'AgX',
      autoViews: true,
      autoMax: AUTO_MAX,
      panoEngine: PANO_ENGINE,
      cyclesSamples: CYCLES_SAMPLES,
      // 0.02 (31 Oct): a +8 EV room in 67 s instead of 90 at 128 samples, the same plaster and ceilings as 0.01
      cyclesNoise: 0.02,
    }),
  )
  let pointCount = cameras.length
  // Blender ends with code 0 even when the script stops on an error: only the script's last line says it got through.
  let finished = false
  // Stage times, from the TOUR_TIME lines of the script (ChatGPT, 25 Oct: measure before optimising).
  const marks: Record<string, number> = {}
  const mark = (name: string) => (marks[name] = performance.now())
  const totalBefore = total
  // What Blender said about this build (its TOUR_ lines and any error), kept in the tour folder: the work folder is
  // cleared afterwards, and a build stopped for memory left nothing to read (31 Oct).
  const log: string[] = []
  const blender = () => withBlenderSlot(async () => {
    mark('blender')
    await progress('Ouverture du fichier complet…')
    log.push(`${new Date().toISOString()} blender ${JSON.parse(await readFile(specPath, 'utf8')).panoEngine}`)
    const result = await run(BLENDER, ['--background', '--python', scriptPath, '--', specPath], line => {
      if (line.startsWith('TOUR_') || /Error|Traceback/.test(line)) log.push(line)
      if (line.startsWith('TOUR_OK')) finished = true
      if (line.startsWith('TOUR_TIME')) mark(line.split(' ')[1])
      // The file is open: the placement that follows takes minutes on a large site, and the page must not look stuck.
      if (line.startsWith('TOUR_TIME scene_ready')) void progress('Recherche des pièces et placement des points de vue…')
      if (line.startsWith('TOUR_AUTO')) {
        const placed = Number(line.split(' ')[1]) || 0
        pointCount += placed
        total += placed * 7
        void progress(`${placed} points placés automatiquement`)
        return
      }
      if (!line.startsWith('TOUR_STEP')) return
      // A Cycles panorama is one step of Blender's in place of six faces.
      done += line.startsWith('TOUR_STEP pano') ? 6 : 1
      void progress(line.includes('plan') ? 'Plan et points de vue' : `Vue 360° ${Number(line.split(' ')[2]) + 1} / ${pointCount}`)
    })
    log.push(...result.stderr.split('\n').filter(l => /Arrêté|Error|Traceback|mémoire/.test(l)).slice(-5))
    log.push(`exit ${result.code}${finished ? '' : ' (not finished)'}`)
    await writeFile(path.join(dir, 'build-log.txt'), log.join('\n') + '\n').catch(() => undefined)
    return result
  })
  let result = await blender()
  if ((result.code !== 0 || !finished) && PANO_ENGINE === 'cycles') {
    // Cycles needs the whole file in the graphics card's memory: a site too big for it (or a Cycles error) gets the
    // EEVEE 360° rather than no tour.
    console.error('tour Cycles failed, building with EEVEE', sceneId, result.stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300))
    const spec = JSON.parse(await readFile(specPath, 'utf8'))
    await writeFile(specPath, JSON.stringify({ ...spec, panoEngine: 'eevee' }))
    for (const f of await readdir(work)) if (f.startsWith('pano-raw-')) await rm(path.join(work, f), { force: true })
    ;[pointCount, total, done, finished] = [cameras.length, totalBefore, 0, false]
    result = await blender()
  }
  mark('blender_done')
  if (result.code !== 0 || !finished) throw new Error(`Blender a échoué : ${result.stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`)
  const masks = isUpdate
    ? (JSON.parse(await readFile(path.join(work, 'update-masks.json'), 'utf8')) as {
        offset: [number, number, number]
        added: number
        removed: number
        faces: Record<string, Record<string, number>>
        photos: Record<string, number>
      })
    : null

  const meta = JSON.parse(await readFile(path.join(work, 'tour-blender.json'), 'utf8')) as {
    plan: { width: number; height: number; mpp: number }
    /** Every level with points, bottom up; suffix "" is the main one (the plain plan files). */
    levels?: { index: number; suffix: string; main: boolean; width: number; height: number; mpp: number; floor: number; frame?: [number, number, number, number]; outdoor?: boolean }[]
    views: { index: number; plan: { x: number; y: number; angle: number }; yaw: number; outside?: boolean; facesWall?: boolean; level?: number }[]
    auto?: {
      index: number
      position: [number, number, number]
      target: [number, number, number]
      yaw: number
      plan: { x: number; y: number; angle: number }
      /** Index in previousAuto of the old point this one is. */
      previous?: number | null
      level?: number
    }[]
    links?: [number, number][]
  }
  const stitch = path.join(work, 'stitch.py')
  await writeFile(stitch, STITCH_SCRIPT)
  const reflect = path.join(work, 'reflect.py')
  await writeFile(reflect, REFLECT_SCRIPT)
  // Each stitch is a separate Python process on the processor; Blender has exited, so a few fit side by side.
  let stitchedCount = 0
  const stitchOne = async (index: number, yaw: number) => {
    const file = `pano-${index}.jpg`
    const stitched = await run(PYTHON, [stitch, work, String(index), String(yaw), path.join(dir, file), String(PANO_WIDTH)])
    done += 1
    stitchedCount += 1
    void progress(`Assemblage 360° ${stitchedCount} / ${pointCount}`)
    if (stitched.code !== 0) console.error('tour stitch failed', index, stitched.stderr.slice(-500))
    else await reflectMirrors(reflect, path.join(dir, file), path.join(work, `mirror-${index}.npz`))
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
    level: view.level,
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
      level: point.level,
    })
  }
  const planScript = path.join(work, 'plan.py')
  await writeFile(planScript, PLAN_SCRIPT)
  // One plan per level (31 Oct): the main level keeps the plain names, the others plan-n<level>….png.
  const planLevels = meta.levels?.length ? meta.levels : [{ index: 0, suffix: '', main: true, ...meta.plan, floor: 0 }]
  for (const level of planLevels) {
    const name = (kind: string) => `plan${level.suffix}${kind}.png`
    const planned = await run(PYTHON, [
      planScript, work, path.join(dir, name('-hd')), path.join(dir, name('-hd-traits')), path.join(dir, name('')),
      String(level.width), String(level.height), String(level.mpp), level.suffix,
    ])
    if (planned.code !== 0) console.error('tour plan failed', level.suffix, planned.stderr.slice(-500))
  }
  // Named from the bottom up; a level with only outdoor areas is "Extérieur" when it is the only such one.
  const outdoorOnly = planLevels.filter(l => l.outdoor).length === 1
  const levels: TourLevel[] | undefined =
    planLevels.length > 1
      ? planLevels.map((level, n) => ({
          index: level.index,
          name: level.outdoor && outdoorOnly ? 'Extérieur' : `Niveau ${n + 1}`,
          file: `plan${level.suffix}.png`,
          hd: `plan${level.suffix}-hd.png`,
          lines: `plan${level.suffix}-hd-traits.png`,
          width: level.width,
          height: level.height,
          frame: level.frame,
          ...(level.outdoor ? { outdoor: true } : {}),
        }))
      : undefined
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
    // An automatic point moved off a wall (see the placement): its AI 360° was made from the old place.
    const shift = masks?.offset ?? [0, 0, 0]
    const moved = v.auto && v.position && old.position && Math.hypot(...v.position.map((x, a) => x - old.position![a] - shift[a])) > 0.05
    if (old.panoAi && !moved) {
      v.panoAi = old.panoAi
      if (old.panoAiHd) v.panoAiHd = old.panoAiHd
      if (old.panoAiCheck) v.panoAiCheck = old.panoAiCheck
      // The faces that see a change: none when the file is the same, all when there is nothing to compare with.
      const seen = masks?.faces[String(v.index)] ?? {}
      const changedFaces = same ? [] : masks ? AI_FACES.filter(f => (seen[f] ?? 0) >= MASK_MIN_PIXELS) : AI_FACES
      const redo = [...new Set([...(old.panoAiUpdate ?? (old.panoAiStale ? AI_FACES : [])), ...changedFaces])]
      v.panoAiApproved = redo.length === 0 && old.panoAiApproved === true
      if (old.panoAiStale || redo.length) v.panoAiStale = true
      if (redo.length) v.panoAiUpdate = AI_FACES.filter(f => redo.includes(f))
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
  // The new version sits a little off the old one: the designer's views kept from the old version move with it.
  if (masks && shiftViews && masks.offset.some(x => Math.abs(x) > 1e-4)) {
    const move = (p: [number, number, number]) => p.map((x, a) => x + masks.offset[a]) as [number, number, number]
    await writeCameras(sceneId, cameras.map(c => ({ ...c, position: move(c.position), target: move(c.target) })))
  }
  let update = same ? before?.update : undefined
  if (masks) {
    const shown = new Set(photos.map(p => p.file))
    const changedPhotos = photos.filter(p => (masks.photos[p.file] ?? 0) >= MASK_MIN_PIXELS).map(p => p.file)
    update = {
      at: new Date().toISOString(),
      added: masks.added,
      removed: masks.removed,
      // Photos already waiting for an update stay in the list as long as they are still the ones shown.
      photos: [...new Set([...(before?.update?.photos ?? []).filter(f => shown.has(f)), ...changedPhotos])],
    }
    console.log('tour update', sceneId, JSON.stringify({ added: masks.added, removed: masks.removed, offset: masks.offset, photos: update.photos.length }))
  }
  // This version's fingerprints, for the next one.
  await copyFile(path.join(work, 'objects.json'), objectsPath).catch(() => undefined)
  // the walkable map for the free walk (Roomia Explorer)
  await copyFile(path.join(work, 'nav.json'), path.join(dir, 'nav.json')).catch(() => undefined)
  const tour: TourBuild = {
    builtAt: new Date().toISOString(),
    seconds: Math.round((performance.now() - started) / 1000),
    sourceMtime,
    aiImages: before?.aiImages ?? 0,
    plan: { file: 'plan.png', hd: 'plan-hd.png', lines: 'plan-hd-traits.png', width: meta.plan.width, height: meta.plan.height },
    ...(levels ? { levels } : {}),
    views,
    links: meta.links ?? [],
    timings,
    ...(update ? { update } : {}),
  }
  await writeFile(tourPath(sceneId), JSON.stringify(tour))
  await clearDir(work)
  await writeStatus(sceneId, { state: 'done', done: total, total })
}

/** Starts the panoramas and the plan in the background (several minutes); the status file tells the progress. */
export async function startTourBuild(
  sceneId: string,
  options: { shiftViews?: boolean; photoQuality?: TourAiLight } = {},
): Promise<TourStatus> {
  const current = await readTourStatus(sceneId)
  if (current.state === 'building') return current
  // Saved views are optional: Blender places its own points in every room.
  const cameras = await readCameras(sceneId)
  const status: TourStatus = { state: 'building', step: 'Démarrage…', done: 0, total: 1 + cameras.length * 7, startedAt: new Date().toISOString(), pid: process.pid }
  await writeStatus(sceneId, status)
  void build(sceneId, cameras, options)
    .then(async () => {
      // The complete tour: every stop still in Blender quality goes on to photo quality (paid).
      if (!options.photoQuality) return
      const built = await readBuild(sceneId)
      const stops = (built?.views ?? []).filter(v => v.pano && !v.panoAi && !v.outside && !v.hidden).map(v => v.index)
      if (stops.length) await startTourAi(sceneId, stops, options.photoQuality)
    })
    .catch(async err => {
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
 * Makes the 360° of some viewpoints photoreal. Since 27 Oct the Blender panorama is edited whole in one image
 * (pano-ai.ts, 1 image per viewpoint): six faces edited separately never agreed on their light and wall lines.
 * ROOMIA_PANO_AI=faces brings back the six-face method: Blender renders six overlapping faces per viewpoint
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
  const single = !FACES_AI
  const status: TourStatus = { state: 'building', kind: 'ai', step: 'Démarrage…', done: 0, total: wanted.length * (single ? 1 : 13), startedAt: new Date().toISOString(), pid: process.pid }
  await writeStatus(sceneId, status)
  void (single ? buildAiSingle(sceneId, wanted, light) : buildAi(sceneId, points, wanted, light)).catch(async err => {
    console.error('tour AI failed', err)
    await writeStatus(sceneId, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
  })
  return status
}

/**
 * Makes an update of the file visible (see TourUpdate): in each AI 360° the faces that see a change are made again
 * and the others are taken from the run that made them; then the photos that show a change are taken again with
 * their own settings. Costs one image per face or photo redone.
 */
export async function startTourUpdate(sceneId: string): Promise<TourStatus> {
  const current = await readTourStatus(sceneId)
  if (current.state === 'building') return current
  const built = await readBuild(sceneId)
  if (!built) throw new Error('Préparez d’abord la visite 360°.')
  const cameras = await readCameras(sceneId)
  const points = tourPoints(cameras, built)
  const views = built.views.filter(v => v.panoAi && v.panoAiUpdate?.length && !v.outside && !v.hidden && points[v.index])
  const photos = built.update?.photos ?? []
  if (views.length === 0 && photos.length === 0) throw new Error('Rien à mettre à jour.')
  // A panorama edited whole is edited again whole, from the new Blender one (1 image).
  const singles = views.filter(v => SINGLE_AI.test(v.panoAi!))
  const faced = views.filter(v => !SINGLE_AI.test(v.panoAi!))
  const { reuse, light } = await reusableFaces(sceneId, faced)
  const status: TourStatus = { state: 'building', kind: 'ai', step: 'Démarrage…', done: 0, total: faced.length * 13 + singles.length + photos.length, startedAt: new Date().toISOString(), pid: process.pid }
  await writeStatus(sceneId, status)
  void (async () => {
    const madeSingle = singles.length ? await buildAiSingle(sceneId, singles.map(v => v.index), 'soleil') : null
    const made = faced.length && !madeSingle?.noCredit ? await buildAi(sceneId, points, faced.map(v => v.index), light, reuse) : null
    if (photos.length && !made?.noCredit && !madeSingle?.noCredit) await remakePhotos(sceneId, photos)
  })().catch(async err => {
    console.error('tour update failed', err)
    await writeStatus(sceneId, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
  })
  return status
}

/**
 * Puts the real mirrors back into AI 360° views made before that existed (free: no image is bought). Every face is
 * taken from the view as it is, and the mirrors of a new capture are pasted in. Views a person approved are left
 * alone; a view with no mirror keeps its panorama.
 */
export async function startMirrorRepair(sceneId: string): Promise<TourStatus> {
  const current = await readTourStatus(sceneId)
  if (current.state === 'building') return current
  const built = await readBuild(sceneId)
  if (!built) throw new Error('Préparez d’abord la visite 360°.')
  const points = tourPoints(await readCameras(sceneId), built)
  // A panorama edited whole has the mirrors of the Blender one already.
  const views = built.views.filter(v => v.panoAi && !SINGLE_AI.test(v.panoAi) && !v.panoAiApproved && !v.panoAiStale && !v.outside && !v.hidden && points[v.index])
  if (views.length === 0) throw new Error('Aucune vue qualité photo à réparer (les vues validées ne sont pas touchées).')
  const { reuse, light } = await reusableFaces(sceneId, views.map(v => ({ ...v, panoAiUpdate: [] })))
  const status: TourStatus = { state: 'building', kind: 'ai', step: 'Démarrage…', done: 0, total: views.length * 13, startedAt: new Date().toISOString(), pid: process.pid }
  await writeStatus(sceneId, status)
  void buildAi(sceneId, points, views.map(v => v.index), light, reuse, { onlyMirrors: true }).catch(async err => {
    console.error('tour mirror repair failed', err)
    await writeStatus(sceneId, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
  })
  return status
}

/** The faces of the AI 360° views being updated that can be taken as they are, and the light they were made in. */
async function reusableFaces(sceneId: string, views: TourViewPoint[]) {
  const dir = tourDir(sceneId)
  const lights = new Map<string, number>()
  const log = (await readFile(path.join(dir, 'ai-faces.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
  const reuse = new Map<string, string>()
  for (const v of views) {
    // pano-<index when made>-ai-<run>.jpg, or pano-<index>-ai.jpg for the first ones (no run, no kept faces).
    const named = /^pano-(\d+)-ai(?:-([a-z0-9]+))?\.jpg$/.exec(v.panoAi ?? '')
    if (!named) continue
    const [, made, runId = ''] = named
    const line = runId ? log.find(l => l.includes(`"run":"${runId}"`)) : undefined
    const light = line ? (JSON.parse(line) as { light?: string }).light : undefined
    if (light) lights.set(light, (lights.get(light) ?? 0) + 1)
    for (const face of AI_FACES.filter(f => !v.panoAiUpdate?.includes(f))) {
      // The face as it was made; for a run that kept no faces, cut back out of its panorama.
      reuse.set(`${v.index}-${face}`, `pano:${path.join(dir, v.panoAi!)}`)
      for (const file of [`${made}-${face}-ai-full.jpg`, `${made}-${face}-ai.jpg`]) {
        const kept = path.join(dir, 'faces', runId, file)
        if (await stat(kept).then(() => true, () => false)) {
          reuse.set(`${v.index}-${face}`, kept)
          break
        }
      }
    }
  }
  // One light for the job: the one most of these views were made in, so the new faces match the kept ones.
  const light = [...lights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return { reuse, light: TOUR_AI_LIGHTS.find(l => l === light) ?? 'soleil' }
}

/** Takes again, with their own settings, the photos an update of the file changed, and keeps them like any photo. */
async function remakePhotos(sceneId: string, files: string[]) {
  const cameras = await readCameras(sceneId)
  const runs = new Map<string, Record<string, unknown>>()
  for (const line of (await readFile(path.join(sceneDir(sceneId), 'runs.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
    try {
      const run = JSON.parse(line) as Record<string, unknown>
      if (run.ok && typeof run.photoFile === 'string') runs.set(path.basename(run.photoFile), run)
    } catch {
      // a damaged line only loses that photo's settings
    }
  }
  let done = 0
  let failed = 0
  for (const file of files) {
    const before = runs.get(file)
    const camera = cameras.findIndex(c => c.name === before?.view)
    await writeStatus(sceneId, { state: 'building', kind: 'ai', step: `Photo ${done + failed + 1} / ${files.length} · ${before?.view ?? file}`, done: done + failed, total: files.length, pid: process.pid })
    const request = parseCaptureRequest({ cameraIndex: camera, lens: before?.lens, time: before?.time, sun: before?.sun, interior: before?.interior }, cameras)
    const started = performance.now()
    const run: Record<string, unknown> = { at: new Date().toISOString(), view: before?.view, time: before?.time, sun: before?.sun, interior: before?.interior, lens: before?.lens, update: true, replaces: file }
    try {
      if (!before || typeof request === 'string') throw new Error(typeof request === 'string' ? request : 'Réglages de la photo introuvables.')
      if (process.env.ROOMIA_AI_DRYRUN === '1') throw new Error('dry run')
      const capture = await getCapture(sceneId, request)
      run.captureSeconds = Number(capture.seconds.toFixed(1))
      run.captureReused = capture.reused
      const photo = await generatePhotoreal(capture.png, buildSceneRenderPrompt(request.lighting))
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${request.name.replace(/\W+/g, '_')}`
      await mkdir(photosDir(sceneId), { recursive: true })
      await writeFile(path.join(photosDir(sceneId), `${name}.jpg`), Buffer.from(photo.base64, 'base64'))
      await writeFile(path.join(photosDir(sceneId), `${name}-capture.png`), capture.png)
      Object.assign(run, { photoSeconds: Number(photo.seconds.toFixed(1)), photoFile: `photos/${name}.jpg`, quality: photo.quality, fellBack: photo.fellBack, fidelity: photo.fidelity, provider: photo.provider, size: photo.size, ok: true })
      done += 1
      const latest = await readBuild(sceneId)
      if (latest?.update) {
        latest.update.photos = latest.update.photos.filter(f => f !== file)
        await writeFile(tourPath(sceneId), JSON.stringify(latest))
      }
    } catch (err) {
      failed += 1
      run.ok = false
      run.error = err instanceof Error ? err.message.slice(0, 200) : String(err)
      console.error('tour update photo failed', file, run.error)
      if ((err as { status?: number }).status === 403) break
    } finally {
      run.totalSeconds = Number(((performance.now() - started) / 1000).toFixed(1))
      await appendFile(path.join(sceneDir(sceneId), 'runs.jsonl'), `${JSON.stringify(run)}\n`).catch(() => undefined)
    }
  }
  await writeStatus(sceneId, { state: 'done', done: files.length, total: files.length, step: `${done} photo(s) refaite(s)${failed ? `, ${failed} échouée(s)` : ''}` })
}

/** The fingerprints of the file as it is (see fingerprints() in the Blender script), for a version that predates them. */
async function fingerprintFile(sceneId: string) {
  const work = path.join(tourDir(sceneId), 'work-prints')
  await clearDir(work)
  await mkdir(work, { recursive: true })
  const specPath = path.join(work, 'tour.json')
  await writeFile(path.join(work, 'tour.py'), TOUR_SCRIPT)
  await writeFile(specPath, JSON.stringify({ ...(await tourSceneSpec(sceneId)), outDir: work, views: [], fingerprintOnly: true }))
  const result = await withBlenderSlot(() => run(BLENDER, ['--background', '--python', path.join(work, 'tour.py'), '--', specPath]))
  if (result.code !== 0) throw new Error(`Blender a échoué : ${result.stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`)
  await copyFile(path.join(work, 'objects.json'), path.join(tourDir(sceneId), 'objects.json'))
  await clearDir(work)
}

/**
 * A new version of the project's file, uploaded and prepared as a scene of its own (fromId), becomes the file of
 * this scene: its tour, photos and history stay. The tour is then rebuilt, which finds what changed (TourUpdate).
 * The new version's saved views replace the old ones when it has some; otherwise the old ones are kept.
 */
export async function startNewVersion(sceneId: string, fromId: string): Promise<TourStatus> {
  if (fromId === sceneId) throw new Error('Choisissez un autre fichier.')
  const [meta, next] = await Promise.all([readMeta(sceneId), readMeta(fromId)])
  if (!meta || !next || next.status !== 'ready') throw new Error('La nouvelle version n’est pas encore prête.')
  if ((await readTourStatus(sceneId)).state === 'building') throw new Error('Une préparation est en cours : attendez qu’elle finisse.')
  if (!(await readBuild(sceneId))) throw new Error('Préparez d’abord la visite 360° de la version actuelle.')
  const status: TourStatus = { state: 'building', step: 'Comparaison avec la version actuelle…', done: 0, total: 1, startedAt: new Date().toISOString(), pid: process.pid }
  await writeStatus(sceneId, status)
  void (async () => {
    if (!(await stat(path.join(tourDir(sceneId), 'objects.json')).then(() => true, () => false))) await fingerprintFile(sceneId)
    const from = sceneDir(fromId)
    const to = sceneDir(sceneId)
    for (const file of ['source.glb', 'viewport.glb', 'report.json', `original.${next.format}`]) {
      await rename(path.join(from, file), path.join(to, file)).catch(err => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      })
    }
    if (meta.format !== next.format) await rm(path.join(to, `original.${meta.format}`), { force: true })
    for (const file of await readdir(to)) if (/^scene-cache-.*\.blend$/.test(file)) await rm(path.join(to, file), { force: true })
    const views = await readCameras(fromId)
    if (views.length) await writeCameras(sceneId, views)
    await writeMeta({
      ...meta,
      fileName: next.fileName,
      format: next.format,
      bytes: next.bytes,
      report: next.report,
      versions: [...(meta.versions ?? [{ fileName: meta.fileName, at: meta.createdAt }]), { fileName: next.fileName, at: Date.now() }],
    })
    await deleteScene(fromId)
    await build(sceneId, await readCameras(sceneId), { shiftViews: views.length === 0 })
  })().catch(async err => {
    console.error('tour new version failed', err)
    await writeStatus(sceneId, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
  })
  return status
}

/**
 * reuse: AI faces of an earlier run that still show the file as it is ("index-face" → picture), taken instead of
 * buying them again (an update, see TourUpdate). onlyMirrors: a viewpoint with no mirror put back keeps its
 * panorama (see startMirrorRepair). Returns the viewpoints made.
 */
/** ROOMIA_PANO_AI=faces: the six-face AI 360° instead of the single edit. */
const FACES_AI = process.env.ROOMIA_PANO_AI === 'faces'
/** An AI 360° edited whole: its run stamp starts with "s". */
const SINGLE_AI = /-ai-s[a-z0-9]+\.jpg$/

/**
 * The AI 360° of some viewpoints, each its Blender panorama edited whole in one image (pano-ai.ts). No Blender run:
 * the tour's panoramas already have the scene's light and mirrors.
 */
/** Share of a panorama in near-black (luminance under 14/255), measured on a 512 px copy. */
async function darkShare(file: string): Promise<number> {
  const { data } = await loadSharp()(await readFile(file)).resize(512, 256).greyscale().raw().toBuffer({ resolveWithObject: true })
  let dark = 0
  for (const v of data) if (v < 14) dark += 1
  return dark / data.length
}
/** Above this share of near-black, the Blender 360° is too dark to buy an AI version of (the AI keeps the base's light). */
// Measured 29 Oct: good bases 0-7 % (Suite, Restaurant, F5, Ecolodge), the black F2 ones 37-78 %.
const DARK_BASE = 0.2

async function buildAiSingle(sceneId: string, indices: number[], light: TourAiLight) {
  const dir = tourDir(sceneId)
  const built = await readBuild(sceneId)
  if (!built) throw new Error('Préparez d’abord la visite 360°.')
  const total = indices.length
  const startedAt = new Date().toISOString()
  const started = performance.now()
  const stamp = `s${Date.now().toString(36)}`
  const made: Record<number, string> = {}
  const checks: Record<number, PanoAiCheck> = {}
  let done = 0
  let bought = 0
  let failed = 0
  let noCredit = false
  const tooDark: string[] = []
  const progress = (step: string) =>
    writeStatus(sceneId, { state: 'building', kind: 'ai', step, done, total, startedAt, pid: process.pid }).catch(() => undefined)
  await progress(`Photos 360° · 0 / ${total}`)
  await Promise.all(
    indices.map(index =>
      withAiSlot(async () => {
        const view = built.views.find(v => v.index === index)
        if (noCredit || !view?.pano) return
        const file = `pano-${index}-ai-${stamp}.jpg`
        // No credit spent on a base that is mostly black (29 Oct, Bloc B F2): the AI would keep it dark.
        const dark = await darkShare(path.join(dir, view.pano)).catch(() => 0)
        if (dark > DARK_BASE) {
          tooDark.push(view.name)
          console.error('tour AI single skipped, base too dark', sceneId, view.name, dark.toFixed(2))
          done += 1
          void progress(`Photos 360° · ${done} / ${total}`)
          return
        }
        try {
          // Test runs only: ROOMIA_AI_DRYRUN=1 goes through the whole job without buying an image.
          if (process.env.ROOMIA_AI_DRYRUN === '1') throw new Error('dry run')
          // One style since 28 Oct (a refined render, the Cycles light kept): the light choice only applies to the six faces.
          const result = await enhancePanorama(path.join(dir, view.pano), path.join(dir, file), panoPrompt())
          bought += 1
          made[index] = file
          checks[index] = result.check
          console.log('tour AI single', sceneId, view.name, JSON.stringify(result))
        } catch (err) {
          failed += 1
          if ((err as { status?: number }).status === 403) noCredit = true
          console.error('tour AI single failed', index, err instanceof Error ? err.message.slice(0, 200) : err)
        }
        done += 1
        void progress(`Photos 360° · ${done} / ${total}`)
      }),
    ),
  )
  const latest = await readBuild(sceneId)
  if (latest) {
    for (const v of latest.views) {
      if (!made[v.index]) continue
      v.panoAi = made[v.index]
      v.panoAiHd = null
      v.panoAiCheck = checks[v.index]
      v.panoAiApproved = false
      delete v.panoAiStale
      delete v.panoAiUpdate
    }
    latest.aiImages = (latest.aiImages ?? 0) + bought
    latest.builtAt = new Date().toISOString()
    await writeFile(tourPath(sceneId), JSON.stringify(latest))
  }
  const count = Object.keys(made).length
  await writeStatus(sceneId, {
    state: 'done',
    done: total,
    total,
    step: noCredit
      ? `Crédit du serveur d’images épuisé : ${count} vue(s) faite(s), ${total - count} non faite(s). Rechargez le crédit puis relancez.`
      : `${count} vue(s) en qualité photo, ${bought} image(s)${failed ? `, ${failed} échouée(s)` : ''}${tooDark.length ? `, ${tooDark.length} trop sombre(s) en 3D, non envoyée(s) (${tooDark.join(', ')})` : ''}, ${Math.round((performance.now() - started) / 1000)} s`,
  })
  // The sharper copies follow (about a minute each on the GPU): the tour shows the AI 360° meanwhile.
  void addHdCopies(sceneId, Object.values(made))
  return { made: Object.keys(made).map(Number), bought, noCredit }
}

/**
 * Makes the 8192 px copy of each AI 360° file given (pano-upscale.ts, free, one at a time) and records it on the point
 * that still shows that file. Does nothing on a PC without the upscaler. Exported for files made before it existed.
 */
export async function addHdCopies(sceneId: string, files: string[]) {
  const dir = tourDir(sceneId)
  for (const file of files) {
    const hd = file.replace(/\.jpg$/, '-hd.jpg')
    const t = performance.now()
    const ok = await withUpscaleSlot(() => upscalePanorama(path.join(dir, file), path.join(dir, hd))).catch(err => (console.error('tour AI upscale failed', file, err), false))
    if (!ok) continue
    const latest = await readBuild(sceneId)
    const view = latest?.views.find(v => v.panoAi === file)
    if (!latest || !view) {
      await rm(path.join(dir, hd), { force: true })
      continue
    }
    view.panoAiHd = hd
    await writeFile(tourPath(sceneId), JSON.stringify(latest))
    console.log('tour AI upscale', sceneId, view.name, `${((performance.now() - t) / 1000).toFixed(1)} s`)
  }
}

async function buildAi(
  sceneId: string,
  points: { name: string; position: number[]; target: number[] }[],
  indices: number[],
  light: TourAiLight,
  reuse = new Map<string, string>(),
  { onlyMirrors = false } = {},
) {
  const dir = tourDir(sceneId)
  const work = path.join(dir, 'work-ai')
  await clearDir(work)
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
  const mirrorScript = path.join(work, 'mirror.py')
  const reflectScript = path.join(work, 'reflect.py')
  await writeFile(reflectScript, REFLECT_SCRIPT)
  const panoFaceScript = path.join(work, 'pano_face.py')
  await writeFile(panoFaceScript, PANO_FACE_SCRIPT)
  await writeFile(plainScript, PLAIN_FACE_SCRIPT)
  await writeFile(stitchScript, STITCH_AI_SCRIPT)
  await writeFile(mirrorScript, MIRROR_SCRIPT)
  const prompt = `${buildSceneRenderPrompt(TOUR_AI_LIGHTING[light])}\n${PANO_FACE_PROMPT[light]}`
  const log = path.join(dir, 'ai-faces.jsonl')

  // Each face is handled as soon as Blender has written it (ChatGPT, 26 Oct): checked, sent to the image model
  // while Blender renders the next ones, and a viewpoint is stitched as soon as its six faces are done.
  type MetaFace = { name: string; forward: number[]; up: number[]; capture: string; near?: boolean; bare?: boolean; planes?: number; distance?: number; mirror?: string | null; ceiling?: string | null }
  // mask: where this face counts in the panorama (the upward face's ceiling, see stitchView); invert: everywhere else.
  type Face = { name: string; forward: number[]; up: number[]; image: string; ai: boolean; mask?: string; invert?: boolean }
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
  const mirrored = new Set<number>()

  const stitchView = (index: number) =>
    stitchLimit(async () => {
      const meta = metas.get(index)!
      // The upward face made by the image model gives the walls; its ceiling stays the Blender capture's, lamps lit.
      const faces = meta.faces.flatMap(f => {
        const face = finished.get(index)!.find(d => d.name === f.name)!
        return face.ai && face.mask ? [face, { name: 'up-ceiling', forward: face.forward, up: face.up, image: f.capture, ai: false, mask: face.mask }] : [face]
      })
      const facesJson = path.join(work, `stitch-${index}.json`)
      await writeFile(facesJson, JSON.stringify({ fov: meta.fov, heading: meta.heading, faces }))
      const file = `pano-${index}-ai-${stamp}.jpg`
      const stitched = await run(PYTHON, [stitchScript, facesJson, path.join(dir, file), String(PANO_WIDTH)])
      done += 1
      void progress(`Assemblage 360° · ${points[index].name}`)
      if (stitched.code === 0 && (await reflectMirrors(reflectScript, path.join(dir, file), path.join(work, `mirror-${index}.npz`)))) mirrored.add(index)
      if (stitched.code === 0 && faces.some(f => f.ai) && (!onlyMirrors || mirrored.has(index))) made[index] = file
      else if (stitched.code !== 0) console.error('tour AI stitch failed', index, stitched.stderr.slice(-500))
    })

  const handleFace = async (index: number, name: string) => {
    await metasLoaded
    const meta = metas.get(index)
    const face = meta?.faces.find(f => f.name === name)
    if (!meta || !face) return
    // A bare wall (plain in the image, or only flat planes in the geometry), or a wall/cupboard right in front
    // of the camera: the image model would invent something there. The ceiling stays Blender too: the AI
    // lit it differently from the walls and drew arcs at the joins. Since 27 Oct the upward face goes to the
    // image model for the tops of the walls, and only its ceiling is kept from Blender (face.ceiling).
    let decision = name === 'up' ? (face.ceiling ? 'ai' : 'ceiling') : face.near ? 'near' : face.bare ? 'bare' : ''
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
    let reused = decision === 'ai' ? reuse.get(`${index}-${name}`) : undefined
    if (reused?.startsWith('pano:')) {
      // Cut out of the panorama it was made for; if that fails, the face is made again.
      const spec = path.join(work, `face-${index}-${name}.json`)
      const out = path.join(work, `ai-${index}-${name}-kept.jpg`)
      await writeFile(spec, JSON.stringify({ fov: meta.fov, heading: meta.heading, forward: face.forward, up: face.up, size: 1024 }))
      const cut = await run(PYTHON, [panoFaceScript, reused.slice(5), spec, out])
      if (cut.code !== 0) console.error('tour AI face not cut from its panorama', index, name, cut.stderr.slice(-300))
      reused = cut.code === 0 ? out : undefined
    }
    // Where the face shows a mirror (a mask rendered with the capture): said in the prompt, and put back afterwards.
    let mirror: { share: number; where: string } | null = null
    if (decision === 'ai' && face.mirror && MIRROR_PASTE) {
      let answer = ''
      const info = await run(PYTHON, [mirrorScript, 'info', face.mirror], line => (answer += line))
      if (info.code === 0 && answer) {
        const found = JSON.parse(answer) as { share: number; where: string }
        if (found.share >= MIRROR_MIN_SHARE) mirror = found
      }
    }
    if (reused) {
      result.image = reused
      result.ai = true
      entry.decision = 'reused'
      // Made before mirrors were put back: done now, from this capture.
      if (mirror && face.mirror) {
        const pasted = path.join(work, `ai-${index}-${name}-mirror.jpg`)
        if ((await run(PYTHON, [mirrorScript, 'paste', face.capture, face.mirror, result.image, pasted])).code === 0) {
          result.image = pasted
          entry.mirror = mirror.share
          mirrored.add(index)
        }
      }
    } else if (decision === 'ai' && onlyMirrors) {
      // A repair never buys an image: a face that could not be taken stays as its capture.
      entry.decision = 'not-bought'
    } else if (decision === 'ai' && noCredit) {
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
            photo = await generatePhotoreal(capture, mirror ? `${prompt}\n${mirrorPrompt(mirror.where)}` : prompt)
          } catch (err) {
            // One more try only when the request failed fast with a server, rate or connection error: it was not
            // processed, so it was not paid for. A slow failure may have been made and billed; "no credit" stops.
            const status = (err as { status?: number }).status
            const fast = performance.now() - t < 15_000
            if (!fast || status === 403 || (status && status < 500 && status !== 429)) throw err
            entry.retried = true
            await new Promise(resolve => setTimeout(resolve, status === 429 ? 15_000 : 5_000))
            photo = await generatePhotoreal(capture, mirror ? `${prompt}\n${mirrorPrompt(mirror.where)}` : prompt)
          }
          bought += 1
          latencies.push((performance.now() - t) / 1000)
          const image = path.join(work, `ai-${index}-${name}.jpg`)
          await writeFile(image, Buffer.from(photo.base64, 'base64'))
          result.image = image
          result.ai = true
          entry.ok = true
          entry.quality = photo.quality
          if (mirror && face.mirror) {
            // The real mirror back in place of whatever the model drew there (a window onto a garden, on Bloc B F5).
            const pasted = path.join(work, `ai-${index}-${name}-mirror.jpg`)
            const put = await run(PYTHON, [mirrorScript, 'paste', face.capture, face.mirror, image, pasted])
            if (put.code === 0) {
              result.image = pasted
              entry.mirror = mirror.share
              mirrored.add(index)
            } else console.error('tour AI mirror paste failed', index, name, put.stderr.slice(-300))
          }
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
    if (result.ai && name === 'up' && face.ceiling) {
      result.mask = face.ceiling
      result.invert = true
    }
    // The faces are kept for the review page (ChatGPT, 26 Oct): what the guard decided, and what the AI made.
    try {
      const keep = path.join(dir, 'faces', stamp)
      await mkdir(keep, { recursive: true })
      entry.run = stamp
      entry.capture = `${index}-${name}-capture.jpg`
      await loadSharp()(await readFile(face.capture)).resize(768, 768).jpeg({ quality: 82 }).toBuffer().then(b => writeFile(path.join(keep, entry.capture as string), b))
      if (result.ai) {
        entry.ai = `${index}-${name}-ai.jpg`
        // Read into memory first: sharp keeps a file it opened, and the work folder could not be removed (27 Oct).
        const aiImage = await readFile(result.image)
        await loadSharp()(aiImage).resize(768, 768).jpeg({ quality: 82 }).toBuffer().then(b => writeFile(path.join(keep, entry.ai as string), b))
        // Full size too: an update of the file takes the faces that did not change from here.
        await loadSharp()(aiImage).jpeg({ quality: 92 }).toBuffer().then(b => writeFile(path.join(keep, `${index}-${name}-ai-full.jpg`), b))
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
      v.panoAiHd = null
      delete v.panoAiCheck
      v.panoAiApproved = false
      delete v.panoAiStale
      delete v.panoAiUpdate
    }
    latest.aiImages = (latest.aiImages ?? 0) + bought
    latest.builtAt = new Date().toISOString()
    await writeFile(tourPath(sceneId), JSON.stringify(latest))
  }
  // The views are saved: a late file in the work folder (ENOTEMPTY, 27 Oct) must not fail the run.
  await clearDir(work)
  await writeStatus(sceneId, {
    state: 'done',
    done: total,
    total,
    step: noCredit
      ? `Crédit du serveur d’images épuisé : ${Object.keys(made).length} vue(s) faite(s), ${starved.size} non faite(s). Rechargez le crédit puis relancez.`
      : `${Object.keys(made).length} vue(s) en qualité photo, ${bought} images${failed ? `, ${failed} échouée(s)` : ''}, ${seconds('start', 'stitched')} s`,
  })
  return { made: Object.keys(made).map(Number), bought, noCredit }
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
export async function reviewTourAi(sceneId: string, index: number, approve: boolean, reason?: PanoRejectReason) {
  const built = await readBuild(sceneId)
  const view = built?.views.find(v => v.index === index)
  if (!built || !view?.panoAi) throw new Error('Pas de 360° en qualité photo pour cette vue.')
  // Every decision is kept, with the file it was about: with ai-faces.jsonl, the start of an evaluation set.
  await appendFile(
    path.join(tourDir(sceneId), 'reviews.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), index, point: view.name, file: view.panoAi, approve, method: SINGLE_AI.test(view.panoAi) ? 'single' : 'faces', ...(reason ? { reason } : {}) }) + '\n',
  ).catch(() => undefined)
  if (approve) {
    view.panoAiApproved = true
    delete view.panoAiStale
  } else {
    await rename(path.join(tourDir(sceneId), view.panoAi), path.join(tourDir(sceneId), view.panoAi.replace('.jpg', '-rejected.jpg'))).catch(() => undefined)
    if (view.panoAiHd) await rm(path.join(tourDir(sceneId), view.panoAiHd), { force: true }).catch(() => undefined)
    view.panoAi = null
    view.panoAiHd = null
    delete view.panoAiCheck
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
  /** A sharper copy of what pano shows, for large screens (the viewer swaps it in once it has loaded). */
  panoHd: string | null
  /** The automatic checks of the AI 360°, for the reviewer. */
  panoAiCheck: PanoAiCheck | null
  panoAiApproved: boolean
  /** The AI 360° was made from an older version of the file (see TourViewPoint.panoAiStale). */
  panoAiStale: boolean
  /** The saved view looks at a wall (see TourViewPoint.facesWall): no photo on purpose, don't offer to make one. */
  noPhoto: boolean
  pano: string | null
  plan: TourViewPoint['plan']
  /** Its level on a site with several (TourBuild.levels), else null. */
  level: number | null
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
      panoHd: (point?.panoAi && (review || point.panoAiApproved) && point.panoAiHd) || null,
      panoAiCheck: (review && point?.panoAiCheck) || null,
      panoAiApproved: point?.panoAiApproved === true,
      panoAiStale: point?.panoAiStale === true,
      plan: point?.plan ?? null,
      level: point?.level ?? null,
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
      panoHd: (point.panoAi && (review || point.panoAiApproved) && point.panoAiHd) || null,
      panoAiCheck: (review && point.panoAiCheck) || null,
      panoAiApproved: point.panoAiApproved === true,
      panoAiStale: point.panoAiStale === true,
      plan: point.plan,
      level: point.level ?? null,
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
  // For the reviewer: what the last new version of the file changed and what its update would cost.
  const pending = (built?.views ?? []).filter(v => v.panoAi && v.panoAiUpdate?.length && !v.outside && !v.hidden)
  const update =
    review && built?.update
      ? {
          at: built.update.at,
          added: built.update.added,
          removed: built.update.removed,
          views: pending.map(v => ({ index: v.index, name: v.name, faces: v.panoAiUpdate! })),
          photos: built.update.photos,
          // At most: a bare wall may stay Blender (the upward face goes to the image model since 27 Oct).
          images: pending.reduce((n, v) => n + v.panoAiUpdate!.length, 0) + built.update.photos.length,
        }
      : null
  // the free walk needs the walkable map the build writes with the 360° (nav.json, since 31 Oct)
  const walk = await stat(path.join(tourDir(sceneId), 'nav.json')).then(
    () => true,
    () => false,
  )
  return { status, plan: built?.plan ?? null, levels: built?.levels ?? null, builtAt: built?.builtAt ?? null, walk, views, update }
}
