import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BLENDER, guardMemory, SCENE_SETUP_SCRIPT, withBlenderSlot } from './blender-render'
import { loadSharp } from './load-sharp'
import { readTour, tourSceneSpec } from './scene-tour'
import { sceneDir } from './scene-store'

/**
 * The video walkthrough of a scene (28 Oct, the free version): Blender films one slow shot in each room of the tour
 * (a push-in, a side slide or a pan, whichever the room has space for), in the order a visitor would walk, and joins
 * them with crossfades into an MP4. Blender only, no image service. A paid version (the photo-quality frames turned
 * into video by an AI model) can start from the same shots later.
 */

export const videoDir = (sceneId: string) => path.join(sceneDir(sceneId), 'video')
const statusPath = (sceneId: string) => path.join(videoDir(sceneId), 'status.json')
const videoPath = (sceneId: string) => path.join(videoDir(sceneId), 'video.json')

/** Files the video route may serve. */
export const VIDEO_FILE = /^(video-[a-z0-9]{1,12}\.mp4|poster-[a-z0-9]{1,12}\.jpg)$/

export interface VideoShot {
  /** The tour stop the shot is filmed from. */
  index: number
  name: string
  kind: 'push' | 'slide' | 'pan'
  /** When the shot starts in the video, in seconds. */
  at: number
}

export interface VideoBuild {
  builtAt: string
  /** Seconds the build took. */
  seconds: number
  file: string
  poster: string
  width: number
  height: number
  fps: number
  /** Length of the video, in seconds. */
  duration: number
  shots: VideoShot[]
}

export interface VideoStatus {
  state: 'idle' | 'building' | 'done' | 'failed'
  step?: string
  done?: number
  total?: number
  error?: string
  startedAt?: string
  pid?: number
}

export interface VideoOptions {
  width?: number
  height?: number
  fps?: number
  /** Length of each room's shot, crossfade included. */
  shotSeconds?: number
  samples?: number
  /** Test runs only: film the first few stops of the walk, and keep the frames. */
  maxShots?: number
  keepWork?: boolean
  /** Cycles noise threshold in the daylight-recipe video (default 0.05). */
  noise?: number
  /** false: the old EEVEE video even when the project has a daylight look. */
  recipe?: boolean
  /** Continue a render that was stopped: the frames already made are kept (recipe video only). */
  resume?: boolean
  /** Test runs: film only these tour views (their `index`). */
  only?: number[]
}

const DEFAULTS = { width: 1920, height: 1080, fps: 25, shotSeconds: 5, samples: 24 }
const BLENDER_TIMEOUT_MS = 3 * 60 * 60_000

const VIDEO_BODY = String.raw`
import os, time
import numpy as np
print("VIDEO_TIME scene_ready", flush=True)

scene = bpy.context.scene
depsgraph = bpy.context.evaluated_depsgraph_get()
out_dir = spec["outDir"]
frames_dir = spec.get("framesDir") or os.path.join(out_dir, "frames")
os.makedirs(frames_dir, exist_ok=True)
W, H, FPS = int(spec["width"]), int(spec["height"]), int(spec["fps"])
SHOT = max(2, round(float(spec.get("shotSeconds", 5)) * FPS))
FADE = max(1, min(SHOT // 3, round(float(spec.get("fadeSeconds", 0.8)) * FPS)))
# A little lower than the tour's eye (1.6 m): the height interior videos are filmed at.
CAM_H = float(spec.get("cameraHeight", 1.4))
HFOV = float(spec.get("hfov", 80))

def to_blender(p):
    # glTF Y-up to Blender Z-up: (x, y, z) -> (x, -z, y)
    return Vector((p[0], -p[2], p[1]))

def scene_reach(o, d, maxd):
    # How far the first surface is, asking the whole scene (maxd when nothing is that close).
    hit, loc = scene.ray_cast(depsgraph, Vector(o), Vector(d).normalized(), distance=maxd)[:2]
    return (loc - Vector(o)).length if hit else maxd

tree = None
def reach(o, d, maxd=12.0):
    # The same from the tree of what stands in the room (built below): thousands of rays a second instead of
    # hundreds. Glass counts as a wall: the camera cannot pass it, and a shot should not stare into a window.
    loc, _n, _i, dist = tree.ray_cast(Vector(o), Vector(d).normalized(), maxd)
    return maxd if loc is None else dist

def seen_object(o, d, maxd=7.0):
    loc, _n, i, _dist = tree.ray_cast(Vector(o), Vector(d).normalized(), maxd)
    return None if loc is None else int(owner[i])

AROUND = [Vector((math.cos(a), math.sin(a), 0.0)) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
def clearance(p):
    # The nearest wall or object around the camera, at its height and a little above and below (shelves, lamps).
    m = 3.0
    for dz in (-0.25, 0.0, 0.2):
        o = p + Vector((0.0, 0.0, dz))
        for d in AROUND:
            m = min(m, reach(o, d, m))
    return m

def path_ok(a, b, need):
    # The camera can glide from a to b: nothing in between, and room around it all the way.
    span = (b - a).length
    if span > 0.01 and reach(a, b - a, span + 0.05) < span + 0.05:
        return False
    return all(clearance(a.lerp(b, t)) >= need for t in (0.0, 0.25, 0.5, 0.75, 1.0))

# 1. The stops of the tour, at camera height above their own floor.
stops = []
for s in spec["stops"]:
    e = to_blender(s["position"])
    down = scene_reach(e, (0, 0, -1), 3.0)
    floor_z = e.z - down if down < 3.0 else e.z - 1.6
    stops.append({"index": s["index"], "name": s["name"], "p": Vector((e.x, e.y, floor_z + CAM_H))})
n = len(stops)
if n == 0:
    raise RuntimeError("Aucun point de visite.")

# Everything the camera could bump into or look at, at its height (walls, furniture, lamps hanging low), in one tree.
from mathutils.bvhtree import BVHTree
t_tree = time.time()
# From just above the floor (a rug is not in the way): low furniture counts for what a frame shows.
band_lo = min(s["p"].z for s in stops) - CAM_H + 0.05
band_hi = max(s["p"].z for s in stops) - CAM_H + 2.4
verts, tris, owners, offset, cache = [], [], [], 0, {}
for number, ob in enumerate(scene.objects):
    if ob.type != "MESH" or ob.hide_render or not ob.visible_get():
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
    keep = (z.max(1) > band_lo) & (z.min(1) < band_hi)
    if not keep.any():
        continue
    used = np.unique(tri[keep])
    remap = np.full(len(w), -1, np.int64)
    remap[used] = np.arange(len(used)) + offset
    verts.append(w[used])
    tris.append(remap[tri[keep]])
    owners.append(np.full(int(keep.sum()), number, np.int32))
    offset += len(used)
del cache
owner = np.concatenate(owners)
del owners
tree = BVHTree.FromPolygons(np.concatenate(verts), np.concatenate(tris), all_triangles=True)
print("VIDEO_INFO tree %d triangles %.1fs" % (sum(len(t) for t in tris), time.time() - t_tree), flush=True)
del verts, tris

# 2. The walk: from the stop that sees the most others (the living room, usually), always on to the nearest stop
# not filmed yet, nearest along the tour's links (through the doors), not through walls.
INF = 1e9
dist = [[0.0 if i == j else INF for j in range(n)] for i in range(n)]
for a, b in spec.get("links", []):
    d = (stops[a]["p"] - stops[b]["p"]).length
    dist[a][b] = dist[b][a] = d
degree = [sum(1 for j in range(n) if j != i and dist[i][j] < INF) for i in range(n)]
for k in range(n):
    for i in range(n):
        for j in range(n):
            if dist[i][k] + dist[k][j] < dist[i][j]:
                dist[i][j] = dist[i][k] + dist[k][j]
for i in range(n):
    for j in range(n):
        if dist[i][j] >= INF:
            # a stop behind a closed door: reached last, by a cut
            dist[i][j] = 20.0 + 4.0 * (stops[i]["p"] - stops[j]["p"]).length
cx = sum((s["p"] for s in stops), Vector((0.0, 0.0, 0.0))) / n
order = [max(range(n), key=lambda i: (degree[i], -(stops[i]["p"] - cx).length))]
while len(order) < n:
    order.append(min((j for j in range(n) if j not in order), key=lambda j: dist[order[-1]][j]))
if spec.get("maxShots"):
    order = order[: int(spec["maxShots"])]

# 3. One shot per stop. It looks into the room, from as far back as the room allows, the way the frame shows the most
# room and no wall right in front (glass counts as a wall, so it does not stare into a window); then a push-in, or a
# slide sideways around a point in the room, or, in a small room, a slow pan.
def ease(t):
    return 0.4 * t + 0.6 * (0.5 - 0.5 * math.cos(math.pi * t))

FOV_RAYS = [math.radians(x) for x in range(-int(HFOV / 2), int(HFOV / 2) + 1, 8)]

CENTRE_RAYS = [math.radians(x) for x in (-20, -10, 0, 10, 20)]
PITCHES = [math.radians(x) for x in (-22, -12, -4, 6)]

def view(q, a):
    # What a frame shows from q looking at a: furniture (how many different objects the frame meets: a bed, a sofa,
    # a TV wall, not one bare wall or a curtain), depth all across, and nothing close in the middle of the frame.
    r = [reach(q, (math.cos(a + o), math.sin(a + o), 0.0), 10.0) for o in FOV_RAYS]
    centre = min(reach(q, (math.cos(a + o), math.sin(a + o), 0.0), 10.0) for o in CENTRE_RAYS)
    things = {}
    for o in FOV_RAYS:
        for pitch in PITCHES:
            c = math.cos(pitch)
            hit = seen_object(q, (c * math.cos(a + o), c * math.sin(a + o), math.sin(pitch)))
            if hit is not None:
                things[hit] = things.get(hit, 0) + 1
    # one surface over most of the frame (a partition, a bare wall, a curtain) makes a dull shot
    dominance = max(things.values(), default=0) / (len(FOV_RAYS) * len(PITCHES))
    return sum(min(x, 8.0) for x in r) / len(r) + min(centre, 3.0) + 0.35 * min(len(things), 16) - 6.0 * max(0.0, dominance - 0.35), things

def view_score(q, a):
    return view(q, a)[0]

def repeats(things, shown):
    # How much of what a frame shows an earlier shot showed already (0 to 1): the walls and furniture of an open-plan
    # flat are seen from several stops, and the same twin beds four times make a dull film.
    total = sum(things.values())
    if not total or not shown:
        return 0.0
    return max(sum(min(c, before.get(o, 0)) for o, c in things.items()) / total for before in shown)

def centre_clear(q, a):
    # The nearest thing in the middle of the frame: a push-in stops before a wall fills the picture.
    return min(reach(q, (math.cos(a + o), math.sin(a + o), 0.0), 10.0) for o in CENTRE_RAYS)

def backing(p, d, need):
    # How far back from the stop the camera can start (a push-in shows the room from its edge).
    for b in (1.5, 1.2, 0.9, 0.6, 0.3):
        if path_ok(p, p - d * b, need):
            return b
    return 0.0

def push_travel(start, a):
    # How far a push-in can go: up to 1.3 m, keeping 1.8 m to the wall ahead and 2.6 m to anything in mid-frame.
    d = Vector((math.cos(a), math.sin(a), 0.0))
    travel = min(1.3, max(0.0, reach(start, d) - 1.8))
    while travel >= 0.6 and centre_clear(start + d * travel, a) < 2.6:
        travel -= 0.1
    return travel if travel >= 0.6 else 0.0

def plan_shot(stop, k, taken, shown):
    # Where to film from: anywhere within 2.5 m of the stop that is in the same room (seen straight from the stop) and
    # has room around it, like a photographer choosing a corner to shoot across the room from. A view that repeats
    # an earlier shot (same place, same way) is passed over.
    p = stop["p"]
    need = 0.35
    best = None
    for dx in np.arange(-2.5, 2.51, 0.5):
        for dy in np.arange(-2.5, 2.51, 0.5):
            q = p + Vector((float(dx), float(dy), 0.0))
            span = (q - p).length
            if span > 2.5 or (span > 0.01 and reach(p, q - p, span + 0.05) < span + 0.05) or clearance(q) < 0.45:
                continue
            for a in np.linspace(0, 2 * math.pi, 24, endpoint=False):
                a = float(a)
                d = Vector((math.cos(a), math.sin(a), 0.0))
                if any((q - tq).length < 1.2 and abs(math.atan2(math.sin(a - ta), math.cos(a - ta))) < 0.6 for tq, ta in taken):
                    continue
                travel = push_travel(q, a)
                # the first and the last frame both count: a push-in must not end on a wall
                s0, things = view(q, a)
                s1, _ = view(q + d * travel, a)
                again = repeats(things, shown)
                score = (s0 + s1) / 2 - 5.0 * again
                if best is None or score > best[0]:
                    best = (score, a, q, travel, again, things)
    if best is None:
        return None
    score, a, p, travel, again, things = best
    # nothing new to show from here: the stop is left out of the film rather than repeated
    if again > 0.4 and len(shown) >= 3:
        print("VIDEO_INFO %s left out: %.0f%% already shown" % (stop["name"], 100 * again), flush=True)
        return None
    taken.append((p, a))
    shown.append(things)
    back = 0.0
    turn = 1.0 if view_score(p, a + 0.35) >= view_score(p, a - 0.35) else -1.0
    d = Vector((math.cos(a), math.sin(a), 0.0))
    side = Vector((-d.y, d.x, 0.0))
    start = p - d * back
    depth = reach(start, d)
    options = {}
    if travel >= 0.6 and path_ok(start, start + d * travel, need):
        options["push"] = (start, start + d * travel, lambda t, a=a: a + turn * math.radians(-6 + 12 * t))
    if depth >= 2.5:
        sign = 1.0 if k % 2 == 0 else -1.0
        target = start + d * min(3.5, depth * 0.6)
        for s in (0.7, 0.5, 0.35):
            q0, q1 = start - side * s * sign, start + side * s * sign
            if path_ok(q0, q1, need):
                def look(t, q0=q0, q1=q1, target=target):
                    q = q0.lerp(q1, ease(t))
                    return math.atan2(target.y - q.y, target.x - q.x)
                options["slide"] = (q0, q1, look)
                break
    drift = start + d * 0.15 if path_ok(start, start + d * 0.15, 0.25) else start
    options["pan"] = (start, drift, lambda t, a=a: a + turn * math.radians(-22 + 44 * t))
    for kind in (("push", "slide") if k % 2 == 0 else ("slide", "push")) + ("pan",):
        if kind in options:
            q0, q1, yaw = options[kind]
            return {"kind": kind, "from": q0, "to": q1, "yaw": yaw, "score": score, "again": again}

t_plan = time.time()
shots, taken, shown = [], [], []
for i in order:
    shot = plan_shot(stops[i], len(shots), taken, shown)
    if shot is None:
        continue
    k = len(shots)
    shot["stop"] = stops[i]
    shots.append(shot)
    print("VIDEO_INFO shot %d %s %s %.2f m, %.1f m from the stop, score %.2f, %.0f%% seen before" % (k, stops[i]["name"], shot["kind"], (shot["to"] - shot["from"]).length, (shot["from"] - stops[i]["p"]).length, shot["score"], 100 * shot["again"]), flush=True)
print("VIDEO_INFO planned in %.1fs" % (time.time() - t_plan), flush=True)
print("VIDEO_SHOTS %d %d" % (len(shots), len(shots) * SHOT), flush=True)
print("VIDEO_TIME planned", flush=True)

# 4. The light and look of the tour's Blender 360° views: late-afternoon sun, the room's lights on, the sky outside.
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
scene.eevee.use_raytracing = True
scene.eevee.taa_render_samples = int(spec.get("samples", 32))
rt = scene.eevee.ray_tracing_options
rt.resolution_scale = str(spec.get("traceScale", "2"))
rt.use_denoise = True
scene.render.use_motion_blur = False

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
cam_data = bpy.data.cameras.new("roomia_video")
cam_data.sensor_fit = "HORIZONTAL"
cam_data.angle = math.radians(HFOV)
cam_data.clip_start = 0.05
cam_data.clip_end = radius * 2.5
cam = bpy.data.objects.new("roomia_video", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam
if spec.get("outdoorSky"):
    eye_z = sorted(s["p"].z for s in stops)[n // 2]
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
    stops_ = ramp.color_ramp.elements
    stops_[0].position, stops_[0].color = 0.495, (0.40, 0.42, 0.36, 1)
    stops_[1].position, stops_[1].color = 0.505, (0.78, 0.85, 0.93, 1)
    top = stops_.new(0.75)
    top.color = (0.42, 0.62, 0.92, 1)
    dome.data.materials.append(sky)
    dome.visible_shadow = False
    if hasattr(dome, "hide_probe_volume"):
        dome.hide_probe_volume = True

probe_data = bpy.data.lightprobes.new("roomia_probe", "SPHERE")
probe_data.influence_distance = 25.0
probe = bpy.data.objects.new("roomia_probe", probe_data)
bpy.context.collection.objects.link(probe)

# Mirrors: a moving camera sees them from every side, and EEVEE cannot show what lies behind the camera. A planar
# probe on a mirror renders its exact reflection from any position; each one costs a render of the scene per frame,
# so a shot gets only the few mirrors near it that it can see.
mirror_groups = {}
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    slots = {i for i, s in enumerate(ob.material_slots) if s.material and role_of(s.material) == "mirror"}
    if not slots:
        continue
    mw, mesh = ob.matrix_world, ob.data
    rot3 = mw.to_3x3()
    for poly in mesh.polygons:
        if poly.material_index not in slots or poly.area <= 0:
            continue
        nrm = (rot3 @ poly.normal).normalized()
        # one sign per plane, whichever way the face was drawn
        if (nrm.x, nrm.y, nrm.z) < (0.0, 0.0, 0.0):
            nrm = -nrm
        pts = [mw @ mesh.vertices[v].co for v in poly.vertices]
        c = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)
        key = (round(nrm.x, 1), round(nrm.y, 1), round(nrm.z, 1), round(nrm.dot(c), 1))
        g = mirror_groups.setdefault(key, {"n": Vector((0.0, 0.0, 0.0)), "pts": [], "area": 0.0})
        g["n"] += nrm * poly.area
        g["pts"].extend(pts)
        g["area"] += poly.area
mirror_groups = sorted(mirror_groups.values(), key=lambda g: -g["area"])[:32]
for g in mirror_groups:
    g["n"] = g["n"].normalized()
    g["c"] = sum(g["pts"], Vector((0.0, 0.0, 0.0))) / len(g["pts"])
mirror_probes = {}

def mirror_probe(g, sign):
    key = (id(g), sign)
    if key not in mirror_probes:
        normal = g["n"] * sign
        rot = normal.to_track_quat("Z", "Y" if abs(normal.y) < 0.9 else "X")
        inv = rot.to_matrix().transposed()
        local = [inv @ (p - g["c"]) for p in g["pts"]]
        data = bpy.data.lightprobes.new("roomia_mirror", "PLANE")
        data.influence_distance = 0.05
        ob = bpy.data.objects.new("roomia_mirror", data)
        bpy.context.collection.objects.link(ob)
        ob.location = g["c"] + normal * 0.002
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = rot
        ob.scale = (max(abs(v.x) for v in local) * 1.05 or 0.5, max(abs(v.y) for v in local) * 1.05 or 0.5, 1.0)
        ob.hide_render = True
        ob.keyframe_insert("hide_render", frame=0)
        mirror_probes[key] = ob
    return mirror_probes[key]

# 5. Every shot as part of one animation (the scene is prepared once), the camera keyed on every frame.
for k, shot in enumerate(shots):
    f0 = k * SHOT + 1
    mid = shot["from"].lerp(shot["to"], 0.5)
    yaw_prev = None
    for f in range(SHOT):
        t = f / (SHOT - 1)
        cam.location = shot["from"].lerp(shot["to"], ease(t))
        yaw = shot["yaw"](t)
        if yaw_prev is not None:
            yaw = yaw_prev + math.atan2(math.sin(yaw - yaw_prev), math.cos(yaw - yaw_prev))
        yaw_prev = yaw
        cam.rotation_euler = (math.radians(90), 0.0, yaw - math.radians(90))
        cam.keyframe_insert("location", frame=f0 + f)
        cam.keyframe_insert("rotation_euler", frame=f0 + f)
    probe.location = mid
    probe.keyframe_insert("location", frame=f0)
    near = []
    for g in mirror_groups:
        to = g["c"] - mid
        if to.length > 6.0 or to.length < 0.05:
            continue
        if reach(mid, to, to.length + 0.05) < to.length - 0.08:
            continue  # something stands between the shot and the mirror
        near.append(g)
    used = set()
    for g in near[:4]:
        sign = 1.0 if g["n"].dot(mid - g["c"]) > 0 else -1.0
        ob = mirror_probe(g, sign)
        used.add(ob.name)
    for ob in mirror_probes.values():
        ob.hide_render = ob.name not in used
        ob.keyframe_insert("hide_render", frame=f0)
    shot["mirrors"] = len(used)
for ob in [cam, probe] + list(mirror_probes.values()):
    if ob.animation_data and ob.animation_data.action:
        for fc in ob.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "CONSTANT"
print("VIDEO_INFO %d mirror probes" % len(mirror_probes), flush=True)

scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "8"
scene.render.image_settings.compression = 15
scene.render.filepath = os.path.join(frames_dir, "f-")
scene.frame_start, scene.frame_end = 1, len(shots) * SHOT
t_render = time.time()
def frame_written(sc, *args):
    print("VIDEO_STEP frame %d %.1f" % (sc.frame_current, time.time() - t_render), flush=True)
bpy.app.handlers.render_write.append(frame_written)
bpy.ops.render.render(animation=True)
bpy.app.handlers.render_write.remove(frame_written)
print("VIDEO_TIME frames", flush=True)

# 6. The film: each shot fades in over the one before it (over black for the first), and the last fades out.
edit = bpy.data.scenes.new("roomia_edit")
edit.render.resolution_x, edit.render.resolution_y = W, H
edit.render.resolution_percentage = 100
edit.render.fps = FPS
# The frames already carry their final colours: the film must not grade them a second time.
edit.view_settings.view_transform = "Standard"
edit.view_settings.look = "None"
se = edit.sequence_editor_create()
total = len(shots) * SHOT - (len(shots) - 1) * FADE
black = se.strips.new_effect("black", "COLOR", 1, 1, frame_end=total + 1)
black.color = (0.0, 0.0, 0.0)
meta_shots = []
for k, shot in enumerate(shots):
    start = 1 + k * (SHOT - FADE)
    names = ["f-%04d.png" % (k * SHOT + f + 1) for f in range(SHOT)]
    strip = se.strips.new_image("shot-%d" % k, os.path.join(frames_dir, names[0]), 2 + k, start)
    for name in names[1:]:
        strip.elements.append(name)
    strip.blend_type = "ALPHA_OVER"
    strip.blend_alpha = 0.0
    strip.keyframe_insert("blend_alpha", frame=start)
    strip.blend_alpha = 1.0
    strip.keyframe_insert("blend_alpha", frame=start + FADE)
    meta_shots.append({"index": shot["stop"]["index"], "name": shot["stop"]["name"], "kind": shot["kind"], "at": (start - 1) / FPS, "mirrors": shot["mirrors"]})
end = se.strips.new_effect("end", "COLOR", 2 + len(shots), total + 1 - FADE, frame_end=total + 1)
end.color = (0.0, 0.0, 0.0)
end.blend_type = "ALPHA_OVER"
end.blend_alpha = 0.0
end.keyframe_insert("blend_alpha", frame=total + 1 - FADE)
end.blend_alpha = 1.0
end.keyframe_insert("blend_alpha", frame=total)
edit.frame_start, edit.frame_end = 1, total
edit.render.image_settings.file_format = "FFMPEG"
ff = edit.render.ffmpeg
ff.format = "MPEG4"
ff.codec = "H264"
ff.constant_rate_factor = "HIGH"
ff.ffmpeg_preset = "GOOD"
ff.gopsize = FPS
ff.audio_codec = "NONE"
edit.render.filepath = os.path.join(out_dir, "film-")
bpy.ops.render.render(animation=True, scene=edit.name)
print("VIDEO_TIME film", flush=True)
with open(os.path.join(out_dir, "video-blender.json"), "w") as fh:
    json.dump({"duration": total / FPS, "shots": meta_shots, "poster": "f-%04d.png" % (SHOT // 2)}, fh)
print("VIDEO_OK", flush=True)
`

/** The classic video (EEVEE, a quick look): the GLB set up for rendering, then the shared body. */
export const VIDEO_SCRIPT = SCENE_SETUP_SCRIPT + VIDEO_BODY

const RECIPE_HEAD = String.raw`
import bpy, json, math, sys, os
from mathutils import Matrix, Quaternion, Vector
spec = json.loads(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8").read())
bpy.ops.wm.open_mainfile(filepath=spec["preparedBlend"], load_ui=False)
print("SCENE_PREPARED opened", flush=True)
`

function between(text: string, from: string, to: string, insert: string) {
  const a = text.indexOf(from)
  const b = text.indexOf(to, a + 1)
  if (a < 0 || b < 0) throw new Error('video script: marker not found: ' + (a < 0 ? from : to).slice(0, 60))
  return text.slice(0, a) + insert + text.slice(b)
}

/** The recipe video (12 Nov): the same shared body, the 360's light, Cycles, the 360's grade. */
async function recipeScript(): Promise<string> {
  const dir = path.join(process.cwd(), 'scripts')
  const [light, stub, render] = await Promise.all(['video_recipe_light.py', 'video_recipe_stub.py', 'video_recipe_render.py'].map(f => readFile(path.join(dir, f), 'utf8')))
  let body = between(VIDEO_BODY, '# 4. The light and look of the tour', 'lo3 = Vector((1e12, 1e12, 1e12))', light)
  // the Cycles settings and the sky dome / probes of the old path
  body = between(body, 'if spec.get("outdoorSky"):', '# 5. Every shot as part of one animation', stub)
  body = between(body, 'scene.render.resolution_x, scene.render.resolution_y = W, H', 'print("VIDEO_TIME frames", flush=True)', render)
  return RECIPE_HEAD + body
}

function run(command: string, args: string[], onLine: (line: string) => void): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => child.kill('SIGKILL'), BLENDER_TIMEOUT_MS)
    let stderr = ''
    const unguard = guardMemory(child, reason => (stderr += `\nArrêté : ${reason}`))
    let pending = ''
    // Read stdout even when nobody needs it: a full pipe freezes Blender.
    child.stdout.on('data', chunk => {
      pending += String(chunk)
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      lines.forEach(onLine)
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

async function writeStatus(sceneId: string, status: VideoStatus) {
  await mkdir(videoDir(sceneId), { recursive: true })
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

export async function readVideoStatus(sceneId: string): Promise<VideoStatus> {
  const status = JSON.parse(await readFile(statusPath(sceneId), 'utf8').catch(() => '{"state":"idle"}')) as VideoStatus
  // A build left half-way by a restart of the Studio is not running any more.
  if (status.state === 'building' && !alive(status.pid)) return { ...status, state: 'failed', error: 'La vidéo a été interrompue. Relancez-la.' }
  return status
}

export async function readVideo(sceneId: string) {
  const [status, video] = await Promise.all([
    readVideoStatus(sceneId),
    readFile(videoPath(sceneId), 'utf8').then(text => JSON.parse(text) as VideoBuild, () => null),
  ])
  return { status, video }
}

/**
 * The project's daylight look (the 360's recipe), when it has one: look/prepared.blend plus the newest look folder holding both
 * recipe-auto.json and exposure.json. The video then films with the same light and grade as the 360 (12 Nov).
 */
async function lookInputs(sceneId: string) {
  const look = path.join(sceneDir(sceneId), 'look')
  const prepared = path.join(look, 'prepared.blend')
  if (!(await stat(prepared).then(() => true, () => false))) return null
  let best: { dir: string; mtime: number } | null = null
  for (const name of await readdir(look).catch(() => [] as string[])) {
    const d = path.join(look, name)
    const m = await stat(path.join(d, 'exposure.json')).then(x => x.mtimeMs, () => 0)
    if (m && (await stat(path.join(d, 'recipe-auto.json')).then(() => true, () => false)) && (!best || m > best.mtime)) best = { dir: d, mtime: m }
  }
  if (!best) return null
  const exposure = JSON.parse(await readFile(path.join(best.dir, 'exposure.json'), 'utf8')) as { groupMedian: number; points: Record<string, { wb: number[]; used: number }> }
  const recipe = JSON.parse(await readFile(path.join(best.dir, 'recipe-auto.json'), 'utf8')) as { looks?: Record<string, { lift?: number }> }
  const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)]
  const wbs = Object.values(exposure.points).map(p => p.wb)
  return {
    prepared,
    recipe: path.join(best.dir, 'recipe-auto.json'),
    exposureEV: exposure.groupMedian,
    // every shot is exposed for its own point, as the 360 is (a dark corridor is lifted, a bright room is not): t<index> in exposure.json
    points: Object.fromEntries(Object.entries(exposure.points).map(([k, v]) => [k.replace(/^t/, ''), { ev: (v as { used: number }).used, wb: v.wb }])),
    wb: [0, 1, 2].map(c => (wbs.length ? median(wbs.map(w => w[c])) : 1)),
    lift: recipe.looks?.daylight?.lift ?? 0.04,
  }
}

async function build(sceneId: string, options: VideoOptions) {
  const started = performance.now()
  const settings = { ...DEFAULTS, ...options }
  const dir = videoDir(sceneId)
  const work = path.join(dir, 'work')
  // frames on the system disk (ext4 / the user's own drive), never the project's data disk: slow on NTFS-over-FUSE (12 Nov)
  const fast = path.join(os.homedir(), '.cache', 'roomia-video', sceneId)
  const framesDir = await mkdir(path.join(fast, 'frames'), { recursive: true }).then(() => path.join(fast, 'frames'), () => path.join(work, 'frames'))
  const rawDir = framesDir === path.join(work, 'frames') ? path.join(work, 'raw') : path.join(fast, 'raw')
  for (const d of options.resume ? [rawDir] : [framesDir, rawDir]) await rm(d, { recursive: true, force: true }).catch(() => undefined)
  await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => undefined)
  await mkdir(work, { recursive: true })
  const startedAt = new Date().toISOString()
  let done = 0
  let total = 1
  const progress = (step: string) =>
    writeStatus(sceneId, { state: 'building', step, done, total, startedAt, pid: process.pid }).catch(() => undefined)

  // The stops clients see, and which of them see each other (the walk goes through the doors, not the walls).
  const tour = await readTour(sceneId)
  const stops = tour.views.filter(v => v.pano && (!options.only || options.only.includes(v.index)))
  if (!stops.length) throw new Error("Préparez d'abord la visite 360° : la vidéo passe par ses points.")
  const at = new Map(stops.map((v, n) => [v.index, n]))
  const links = stops.flatMap((v, n) => v.links.filter(l => at.has(l) && at.get(l)! > n).map(l => [n, at.get(l)!]))

  const scriptPath = path.join(work, 'video.py')
  const specPath = path.join(work, 'video.json')
  const look = options.recipe === false ? null : await lookInputs(sceneId)
  await writeFile(scriptPath, look ? await recipeScript() : VIDEO_SCRIPT)
  if (look) console.log('video', sceneId, 'recipe mode:', look.recipe, 'exposure', look.exposureEV, 'wb', look.wb)
  await writeFile(
    specPath,
    JSON.stringify({
      ...(await tourSceneSpec(sceneId)),
      outDir: work,
      framesDir,
      rawDir,
      ...(look ? { preparedBlend: look.prepared, recipe: look.recipe, scriptsDir: path.join(process.cwd(), 'scripts'), preset: 'daylight', exposureEV: look.exposureEV, wb: look.wb, pointGrades: look.points, lift: look.lift, noise: options.noise ?? 0.05, resume: options.resume === true } : {}),
      stops: stops.map(v => ({ index: v.index, name: v.name, position: v.position })),
      links,
      viewTransform: 'AgX',
      ...settings,
    }),
  )
  await progress('En attente du processeur graphique…')
  let finished = false
  let renderStarted = 0
  const result = await withBlenderSlot(async () => {
    await progress('Ouverture du fichier complet…')
    return run(BLENDER, ['--background', '--python', scriptPath, '--', specPath], line => {
      if (line.startsWith('VIDEO_INFO')) console.log('video', sceneId, line.slice(11))
      if (line.startsWith('VIDEO_OK')) finished = true
      else if (line.startsWith('VIDEO_SHOTS')) {
        total = Number(line.split(' ')[2]) || 1
        renderStarted = performance.now()
        void progress(`${line.split(' ')[1]} plans à filmer`)
      } else if (line.startsWith('VIDEO_STEP')) {
        done = Number(line.split(' ')[2]) || done + 1
        // The time left, from the frames already made.
        const left = ((performance.now() - renderStarted) / done) * (total - done)
        void progress(`Image ${done} / ${total} — environ ${Math.max(1, Math.round(left / 60_000))} min restantes`)
      } else if (line.startsWith('VIDEO_TIME frames')) void progress('Montage de la vidéo…')
    })
  })
  if (result.code !== 0 || !finished) throw new Error(`Blender a échoué : ${result.stderr.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`)

  const meta = JSON.parse(await readFile(path.join(work, 'video-blender.json'), 'utf8')) as {
    duration: number
    shots: (VideoShot & { mirrors: number })[]
    poster: string
  }
  const film = (await readdir(work)).find(f => f.startsWith('film-') && f.endsWith('.mp4'))
  if (!film) throw new Error("Blender n'a pas écrit la vidéo.")
  // A new name for each build, so a browser never shows the previous one from its cache.
  const stamp = Date.now().toString(36)
  const file = `video-${stamp}.mp4`
  const poster = `poster-${stamp}.jpg`
  await rename(path.join(work, film), path.join(dir, file))
  const sharp = await loadSharp()
  await writeFile(path.join(dir, poster), await sharp(await readFile(path.join(framesDir, meta.poster))).jpeg({ quality: 88 }).toBuffer())
  const before = await readFile(videoPath(sceneId), 'utf8').then(text => JSON.parse(text) as VideoBuild, () => null)
  const video: VideoBuild = {
    builtAt: new Date().toISOString(),
    seconds: Math.round((performance.now() - started) / 1000),
    file,
    poster,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    duration: meta.duration,
    shots: meta.shots.map(({ index, name, kind, at }) => ({ index, name, kind, at })),
  }
  await writeFile(videoPath(sceneId), JSON.stringify(video))
  console.log('video build', sceneId, `${video.shots.length} shots`, `${video.duration}s`, `${video.seconds}s to build`)
  if (before) {
    for (const old of [before.file, before.poster]) await rm(path.join(dir, old), { force: true }).catch(() => undefined)
  }
  if (!options.keepWork) for (const d of [framesDir, rawDir]) await rm(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(() => undefined)
  if (!options.keepWork) await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }).catch(err => console.error('video work folder not removed', err.code))
  await writeStatus(sceneId, { state: 'done', done: total, total })
}

/** Starts the video in the background (tens of minutes); the status file tells the progress. */
export async function startVideoBuild(sceneId: string, options: VideoOptions = {}): Promise<VideoStatus> {
  const current = await readVideoStatus(sceneId)
  if (current.state === 'building') return current
  const status: VideoStatus = { state: 'building', step: 'Démarrage…', done: 0, total: 1, startedAt: new Date().toISOString(), pid: process.pid }
  await writeStatus(sceneId, status)
  void build(sceneId, options).catch(async err => {
    console.error('video build failed', err)
    await writeStatus(sceneId, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
  })
  return status
}

/** The size of a video file, for answering range requests (a browser asks for pieces of a video, not the whole). */
export async function videoFileSize(sceneId: string, file: string) {
  return stat(path.join(videoDir(sceneId), file)).then(s => s.size, () => null)
}
