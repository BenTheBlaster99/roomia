import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { freemem, tmpdir } from 'node:os'
import path from 'node:path'
import { blenderLighting, NEUTRAL_CAPTURE_LIGHT, type Lighting } from './render-lighting'
import { FINISH_ROUGHNESS, type MaterialRoles } from './material-roles'
import { lookAtQuaternion, verticalFov, type SceneCamera } from './scene-cameras'

export const BLENDER = process.env.ROOMIA_BLENDER ?? 'blender'
/** A big scene takes ~140 s to load in Blender; the old 150 s limit killed renders that were merely a little slow. */
const TIMEOUT_MS = Number(process.env.ROOMIA_BLENDER_TIMEOUT_MS ?? 900_000)
/** 'eevee' (fast, needs a GPU: the default) or 'cycles' (CPU only, works on any server, slower). */
const ENGINE = process.env.ROOMIA_BLENDER_ENGINE?.toLowerCase() === 'cycles' ? 'CYCLES' : 'EEVEE'
const CYCLES_SAMPLES = Number(process.env.ROOMIA_CYCLES_SAMPLES ?? 32)
/** Captures share one GPU: two at once each take 30-50 s instead of ~8 s, so they run one at a time. */
const MAX_CONCURRENT = Math.max(1, Number(process.env.ROOMIA_BLENDER_CONCURRENCY ?? 1))
let running = 0
const waiting: (() => void)[] = []

async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1
    return
  }
  await new Promise<void>(resolve => waiting.push(resolve))
}

function releaseSlot(): void {
  const next = waiting.shift()
  if (next) next() // the slot passes straight to the next waiting capture
  else running -= 1
}

/**
 * Stops a Blender run before it takes the PC down: the PC froze on 26 Oct when a double-size plan render of
 * Bloc B F5 filled its memory. Below 1.5 GB of free memory, or 0.5 GB of free graphics memory, the job fails
 * instead. Returns the function that stops watching.
 */
const MIN_FREE_MB = Number(process.env.ROOMIA_MIN_FREE_MB ?? 1500)
const MIN_FREE_GPU_MB = Number(process.env.ROOMIA_MIN_FREE_GPU_MB ?? 500)
export function guardMemory(child: ChildProcess, onStop: (reason: string) => void): () => void {
  let stopped = false
  const stop = (reason: string) => {
    if (stopped) return
    stopped = true
    console.error('blender stopped:', reason)
    onStop(reason)
    child.kill('SIGKILL')
  }
  const timer = setInterval(() => {
    // Linux counts the file cache it can drop as available; elsewhere (Roomia Desktop on Windows) the OS's free memory
    const available = process.platform === 'linux'
      ? readFile('/proc/meminfo', 'utf8').then(info => Number(/MemAvailable:\s+(\d+)/.exec(info)?.[1]) / 1024)
      : Promise.resolve(freemem() / 1048576)
    available
      .then(mb => {
        if (mb && mb < MIN_FREE_MB) stop(`mémoire presque pleine (${Math.round(mb)} Mo libres)`)
      })
      .catch(() => undefined)
    execFile('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 1500 }, (err, out) => {
      if (err) return
      const [used, total] = out.split(',').map(Number)
      if (total && total - used < MIN_FREE_GPU_MB) stop(`mémoire graphique presque pleine (${total - used} Mo libres)`)
    })
  }, 1000)
  return () => clearInterval(timer)
}

/** Runs a Blender job in the same one-at-a-time slot as the captures (a tour waits for a capture, and the other way round). */
export async function withBlenderSlot<T>(job: () => Promise<T>): Promise<T> {
  await acquireSlot()
  try {
    return await job()
  } finally {
    releaseSlot()
  }
}

/** 3:2, the same shape as the final photo (1536×1024), so the photo step never has to re-frame. */
export const CAPTURE_WIDTH = 1536
export const CAPTURE_HEIGHT = 1024

/**
 * Opens the file and prepares it the same way for every Blender job (photo captures and tours):
 * mirrors, glass, lights and the designer's material edits. Defines add_mirror_probes(), which
 * expects a global `cam` (the camera).
 */
export const SCENE_SETUP_SCRIPT = String.raw`
import bpy, json, math, sys
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv
spec = json.loads(open(argv[argv.index("--") + 1], encoding="utf-8").read())

# Importing the 500 MB GLB takes about a minute; opening the same scene saved as a .blend takes seconds
# (measured 25 Oct: 58 s against 1.6 s). The first job saves the imported scene next to the file, before
# anything is changed, and later jobs open it. A new file or a new Blender version makes a new cache.
import glob, os
glb = spec["glb"]
st = os.stat(glb)
cache = os.path.join(os.path.dirname(glb), "scene-cache-%d-%d-%s.blend" % (st.st_size, int(st.st_mtime), bpy.app.version_string.split(" ")[0]))
if spec.get("blendCache", True) and os.path.exists(cache):
    bpy.ops.wm.open_mainfile(filepath=cache, load_ui=False)
    print("SCENE_CACHE opened", flush=True)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    if spec.get("blendCache", True):
        try:
            tmp = cache + ".%d.tmp" % os.getpid()
            bpy.ops.wm.save_as_mainfile(filepath=tmp, copy=True, compress=False)
            os.replace(tmp, cache)
            for old in glob.glob(os.path.join(os.path.dirname(glb), "scene-cache-*.blend")):
                if old != cache:
                    os.remove(old)
            print("SCENE_CACHE saved", flush=True)
        except Exception as err:
            print("SCENE_CACHE failed", err, flush=True)

# Shading normals turned into the wall (29 Oct, Bloc B F2 from D5 Render): the file stores a normal per corner, and
# 46 % of them pointed against their own face. Cycles lights a surface from the side its normal faces, so walls and
# ceilings came out pure black whatever their colour, the lamps or the fill (EEVEE's ambient light hid it). Each
# corner normal that points against its face is turned round; the smoothing the designer gave is kept.
import numpy as np
flipped, done_meshes = 0, set()
for ob in bpy.data.objects:
    if ob.type != "MESH" or ob.data.name in done_meshes or not ob.data.has_custom_normals:
        continue
    me = ob.data
    done_meshes.add(me.name)
    n = len(me.loops)
    if n == 0:
        continue
    ln = np.empty(n * 3, np.float32)
    me.corner_normals.foreach_get("vector", ln)
    ln = ln.reshape(-1, 3)
    pn = np.empty(len(me.polygons) * 3, np.float32)
    me.polygons.foreach_get("normal", pn)
    tots = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_total", tots)
    back = (ln * np.repeat(pn.reshape(-1, 3), tots, axis=0)).sum(1) < 0
    if back.any():
        ln[back] *= -1
        me.normals_split_custom_set(ln)
        flipped += int(back.sum())
if flipped:
    print("NORMALS turned round", flipped, flush=True)

# The SketchUp export keeps no reflectivity, transparency or emission, only the material NAMES.
# So mirrors, glass and lights are recognised by name and given the right look for the capture.
import re
MIRROR = re.compile(r"mirror|miroir", re.I)
GLASS = re.compile(r"glass|verre|vitre|window", re.I)
# Sheer curtains are see-through too, but cloth, not glass: they keep their soft transparency.
FABRIC = re.compile(r"curtain|rideau|voilage|tulle|sheer|drape|cortina", re.I)
LIGHT = re.compile(r"^(led|light|lights|lamp|spot)$|\bled\b|bedside lights|lumin|plafonnier|neon", re.I)

def link_into(mat, node, socket):
    return [l for l in mat.node_tree.links if l.to_node == node and l.to_socket.name == socket]

# The designer's roles (Studio > Matériaux) win; otherwise mirrors and lights are guessed from the
# name and glass from transparency. Blender may add ".001" to a repeated name.
EDITS = spec.get("roles") or {}
FINISH_ROUGHNESS = spec.get("finishRoughness") or {}

def edit_of(mat):
    return EDITS.get(re.sub(r"\.\d{3}$", "", mat.name)) or {}

def role_of(mat):
    base = re.sub(r"\.\d{3}$", "", mat.name)
    if edit_of(mat).get("role"):
        return edit_of(mat)["role"]
    if MIRROR.search(base):
        return "mirror"
    if GLASS.search(base):
        return "glass-name"
    if LIGHT.search(base):
        return "light"
    return "auto"

for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        continue
    role = role_of(mat)
    # SketchUp's glTF export writes no metallicFactor, and glTF then means fully metallic: walls, ceilings and floors
    # came in as rough metal, which has no colour of its own and only reflects the room (black ceiling arcs and a white
    # wall in Cycles, grey and flat in EEVEE; Ecolodge, Restaurant, 28 Oct). Metallic 1 with roughness 1, both
    # untouched defaults, is that missing value, not a real metal.
    metal, rough = bsdf.inputs["Metallic"], bsdf.inputs["Roughness"]
    if metal.default_value == 1.0 and rough.default_value == 1.0 and not link_into(mat, bsdf, "Metallic") and not link_into(mat, bsdf, "Roughness"):
        metal.default_value = 0.0
    # No telling name (an ArchiCAD export): a material that glows on its own is a light.
    glow = bsdf.inputs["Emission Color"].default_value
    if role == "auto" and bsdf.inputs["Emission Strength"].default_value > 0 and max(glow[:3]) > 0.5 and not link_into(mat, bsdf, "Emission Color"):
        role = "light"
    if role == "mirror":
        for l in link_into(mat, bsdf, "Base Color"):
            mat.node_tree.links.remove(l)
        bsdf.inputs["Base Color"].default_value = (0.92, 0.92, 0.92, 1)
        bsdf.inputs["Metallic"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = 0.0 if spec.get("sharpMirrors") else 0.02
    elif role == "glass-name":
        # A glass material with a picture on it (a green checkerboard) becomes plain clear glass.
        textured = link_into(mat, bsdf, "Base Color")
        for l in textured + link_into(mat, bsdf, "Alpha"):
            mat.node_tree.links.remove(l)
        if textured:
            bsdf.inputs["Base Color"].default_value = (0.95, 0.98, 1.0, 1)
            bsdf.inputs["Alpha"].default_value = 0.08
            bsdf.inputs["Roughness"].default_value = 0.02
    elif role == "glass" and not spec.get("realGlass"):
        for l in link_into(mat, bsdf, "Alpha"):
            mat.node_tree.links.remove(l)
        bsdf.inputs["Alpha"].default_value = 0.15
        bsdf.inputs["Roughness"].default_value = 0.02
    elif role == "light" and spec.get("interior", True):
        bsdf.inputs["Emission Color"].default_value = (1.0, 0.86, 0.62, 1)
        bsdf.inputs["Emission Strength"].default_value = 12.0
    # The designer's colour and finish (Studio > Matériaux): a flat colour replaces the texture.
    edit = edit_of(mat)
    if edit.get("color") and role != "mirror":
        for l in link_into(mat, bsdf, "Base Color"):
            mat.node_tree.links.remove(l)
        hexcol = edit["color"].lstrip("#")
        srgb = [int(hexcol[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
        bsdf.inputs["Base Color"].default_value = (*linear, 1)
    if edit.get("finish") in FINISH_ROUGHNESS and role != "mirror":
        for l in link_into(mat, bsdf, "Roughness"):
            mat.node_tree.links.remove(l)
        bsdf.inputs["Roughness"].default_value = FINISH_ROUGHNESS[edit["finish"]]

# Enscape's lights (27 Oct, Suite): SketchUp files made for Enscape mark each light with a small object of no
# material, which Enscape lights up. Rendered as they are, they were grey discs next to the lit LED spots, half
# the ceiling looking switched off. They glow like the other lights (and are hidden when the lights are off).
ENSCAPE_LIGHT = re.compile(r"Enscape\.\w*Light", re.I)
enscape_glow = None
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    owner, names = ob, []
    while owner is not None:
        names.append(owner.name)
        owner = owner.parent
    if not any(ENSCAPE_LIGHT.search(n) for n in names):
        continue
    if not spec.get("interior", True):
        ob.hide_render = True
        continue
    if enscape_glow is None:
        enscape_glow = bpy.data.materials.new("roomia_enscape_light")
        enscape_glow.use_nodes = True
        glow_bsdf = enscape_glow.node_tree.nodes["Principled BSDF"]
        glow_bsdf.inputs["Base Color"].default_value = (1.0, 0.95, 0.85, 1)
        glow_bsdf.inputs["Emission Color"].default_value = (1.0, 0.86, 0.62, 1)
        glow_bsdf.inputs["Emission Strength"].default_value = 12.0
    if not ob.material_slots:
        ob.data.materials.append(enscape_glow)
    for slot in ob.material_slots:
        slot.link = "OBJECT"
        slot.material = enscape_glow

# D5 Render's lights (29 Oct, Bloc B F2): D5 exports each light as an empty "D5RenderLight.Spot#3" holding a 20 cm
# icon mesh, not as a light. Cycles then had no lamp at all and the apartment came out black. The icon is hidden and a
# real light takes its place: spots shine along the icon's +Y (straight down in every F2 marker), strips are LED lines.
D5_LIGHT = re.compile(r"D5RenderLight\.(Spot|Point|Strip|Area|Rect|Line)", re.I)
d5_lights = 0
for ob in list(bpy.data.objects):
    if ob.type != "MESH" or ob.parent is None:
        continue
    kind = D5_LIGHT.search(ob.parent.name)
    if not kind:
        continue
    ob.hide_render = True
    if not spec.get("interior", True) or spec.get("d5Lights") is False:
        continue
    kind = kind.group(1).lower()
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    centre = sum(bb, Vector()) / 8
    size = sorted(max(p[k] for p in bb) - min(p[k] for p in bb) for k in range(3))
    if kind in ("strip", "line", "area", "rect"):
        data = bpy.data.lights.new("d5_" + kind, "AREA")
        data.shape = "RECTANGLE"
        data.size, data.size_y = max(size[2], 0.05), max(size[1], 0.02)
        data.energy = 40.0 * max(size[2], 0.3)
        aim = Vector((0, 0, -1))
    elif kind == "spot":
        data = bpy.data.lights.new("d5_spot", "SPOT")
        data.energy, data.spot_size, data.spot_blend = 60.0, math.radians(100), 0.6
        aim = (ob.parent.matrix_world.to_3x3() @ Vector((0, 1, 0))).normalized()
        if aim.z > -0.3:
            aim = Vector((0, 0, -1))
    else:
        data = bpy.data.lights.new("d5_point", "POINT")
        data.energy = 80.0
        aim = Vector((0, 0, -1))
    data.color = (1.0, 0.86, 0.62)
    data.shadow_soft_size = 0.05
    lamp = bpy.data.objects.new(data.name, data)
    bpy.context.scene.collection.objects.link(lamp)
    lamp.location = centre
    lamp.rotation_euler = aim.to_track_quat("-Z", "Y").to_euler()
    d5_lights += 1
if d5_lights:
    print("D5 lights", d5_lights, flush=True)

def tint_of(bsdf, forced):
    # glTF glass is "base colour at some alpha"; as real glass that becomes a tint between clear and the colour.
    # An opaque material the designer marked as glass gets a light tint of its colour.
    r, g, b, _ = bsdf.inputs["Base Color"].default_value
    a = bsdf.inputs["Alpha"].default_value
    if forced and a >= 0.9:
        a = 0.3
    return tuple(1.0 - a * (1.0 - c) for c in (r, g, b))

GLASS_ORIGINAL = {}  # material name -> its own colour and opacity, before it became real glass

if spec.get("realGlass"):
    # See-through materials (alpha below 0.9, no cut-out texture such as leaves) and materials the
    # designer marked as glass become real glass that refracts and keeps its tint, so smoked glass
    # stays smoked. Shadow rays pass through it, so windows don't block the sun.
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        role = role_of(mat)
        forced = role == "glass"
        if role in ("mirror", "normal", "light") or (FABRIC.search(mat.name) and not forced):
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
        if bsdf is None or out is None:
            continue
        if not forced and (link_into(mat, bsdf, "Alpha") or bsdf.inputs["Alpha"].default_value >= 0.9):
            continue
        for l in link_into(mat, bsdf, "Alpha"):
            links.remove(l)
        r0, g0, b0, _ = bsdf.inputs["Base Color"].default_value
        a0 = bsdf.inputs["Alpha"].default_value
        GLASS_ORIGINAL[mat.name] = (r0, g0, b0, 0.3 if forced and a0 >= 0.9 else a0)
        tint = tint_of(bsdf, forced)
        for l in link_into(mat, bsdf, "Base Color"):
            links.remove(l)
        bsdf.inputs["Base Color"].default_value = (*tint, 1)
        bsdf.inputs["Alpha"].default_value = 1.0
        bsdf.inputs["Transmission Weight"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = 0.02
        bsdf.inputs["IOR"].default_value = 1.45
        path = nodes.new("ShaderNodeLightPath")
        clear = nodes.new("ShaderNodeBsdfTransparent")
        mix = nodes.new("ShaderNodeMixShader")
        for l in [l for l in links if l.to_node == out and l.to_socket.name == "Surface"]:
            links.remove(l)
        links.new(path.outputs["Is Shadow Ray"], mix.inputs["Fac"])
        links.new(bsdf.outputs["BSDF"], mix.inputs[1])
        links.new(clear.outputs["BSDF"], mix.inputs[2])
        links.new(mix.outputs["Shader"], out.inputs["Surface"])
        mat.surface_render_method = "DITHERED"
        mat.use_raytrace_refraction = True

    # Refracting glass can't be seen through twice: a double-glazed door showed flat grey instead of
    # the outside, and the AI invented a room behind it (20 Oct). Upright glass (windows, doors,
    # partitions) is drawn as tinted see-through glass instead; flat glass (tables, shelves) keeps
    # the refracting, smoked look.
    see_through = {}
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or not ob.material_slots:
            continue
        rot3 = ob.matrix_world.to_3x3()
        for index, slot in enumerate(ob.material_slots):
            glass = slot.material
            if not glass or glass.name not in GLASS_ORIGINAL:
                continue
            upright = flat = 0.0
            for poly in ob.data.polygons:
                if poly.material_index == index:
                    n = (rot3 @ poly.normal).normalized()
                    if abs(n.z) < 0.5:
                        upright += poly.area
                    else:
                        flat += poly.area
            if upright <= flat:
                continue
            if glass.name not in see_through:
                copy = glass.copy()
                cb = next(n for n in copy.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                r0, g0, b0, a0 = GLASS_ORIGINAL[glass.name]
                cb.inputs["Base Color"].default_value = (r0, g0, b0, 1)
                cb.inputs["Alpha"].default_value = a0
                cb.inputs["Transmission Weight"].default_value = 0.0
                copy.surface_render_method = "BLENDED"
                copy.use_raytrace_refraction = False
                see_through[glass.name] = copy
            slot.link = "OBJECT"
            slot.material = see_through[glass.name]

def add_mirror_probes():
    # A planar probe lying on each mirror plane renders the exact reflection from the mirror's
    # own position (crystal clear), instead of a blurry guess from a probe at the camera. Mirror
    # faces are grouped by plane: one exported object often holds every mirror of the apartment.
    eye = cam.matrix_world.translation
    planes = {}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        slots = {i for i, s in enumerate(obj.material_slots) if s.material and role_of(s.material) == "mirror"}
        if not slots:
            continue
        mw, mesh = obj.matrix_world, obj.data
        rot3 = mw.to_3x3()
        for poly in mesh.polygons:
            if poly.material_index not in slots or poly.area <= 0:
                continue
            n = (rot3 @ poly.normal).normalized()
            pts = [mw @ mesh.vertices[v].co for v in poly.vertices]
            c = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)
            # SketchUp faces are often reversed: a mirror faces the room the camera is in.
            if n.dot(eye - c) < 0:
                n = -n
            key = (round(n.x, 1), round(n.y, 1), round(n.z, 1), round(n.dot(c), 1))
            group = planes.setdefault(key, {"n": Vector((0.0, 0.0, 0.0)), "pts": [], "area": 0.0})
            group["n"] += n * poly.area
            group["pts"].extend(pts)
            group["area"] += poly.area
    # The biggest mirror planes first; each planar probe re-renders the scene, so keep a cap.
    count = 0
    for group in sorted(planes.values(), key=lambda g: -g["area"])[:16]:
        normal = group["n"].normalized()
        center = sum(group["pts"], Vector((0.0, 0.0, 0.0))) / len(group["pts"])
        rot = normal.to_track_quat("Z", "Y" if abs(normal.y) < 0.9 else "X")
        inv = rot.to_matrix().transposed()
        local = [inv @ (p - center) for p in group["pts"]]
        data = bpy.data.lightprobes.new("roomia_mirror", "PLANE")
        data.influence_distance = 0.05
        probe = bpy.data.objects.new("roomia_mirror", data)
        bpy.context.collection.objects.link(probe)
        probe.location = center + normal * 0.002
        probe.rotation_mode = "QUATERNION"
        probe.rotation_quaternion = rot
        probe.scale = (max(abs(v.x) for v in local) * 1.05 or 0.5, max(abs(v.y) for v in local) * 1.05 or 0.5, 1.0)
        count += 1
    return count

`

/** One saved view: camera, sky, light, engine, then the render. */
const VIEW_SCRIPT = String.raw`px, py, pz = spec["position"]
qx, qy, qz, qw = spec["quaternion"]
R = Quaternion((qw, qx, qy, qz)).to_matrix()
# glTF Y-up to Blender Z-up: (x, y, z) -> (x, -z, y). Camera local axes stay -Z forward, +Y up.
M = Matrix(((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0)))
mat = (M @ R).to_4x4()
mat.translation = Vector((px, -pz, py))

cam_data = bpy.data.cameras.new("roomia_view")
cam_data.sensor_fit = "VERTICAL"
cam_data.angle = math.radians(float(spec["fov"]))
cam_data.clip_start = 0.05
cam_data.clip_end = 200.0
cam = bpy.data.objects.new("roomia_view", cam_data)
bpy.context.collection.objects.link(cam)
cam.matrix_world = mat
bpy.context.scene.camera = cam

if spec.get("outdoorSky"):
    # Outside the building used to be flat grey: behind a glass door the AI read it as another room
    # and invented one (Sarah, 20 Oct). A sky dome around the building, horizon at eye level, makes
    # every window and glass door clearly show the outdoors. EEVEE draws what lies behind real glass
    # from the sphere probe, so the dome stays visible to it (that probe only feeds shiny
    # reflections); it is hidden from the volume probe so the neutral diffuse light stays neutral.
    lo = Vector((1e12, 1e12, 1e12))
    hi = Vector((-1e12, -1e12, -1e12))
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        for corner in ob.bound_box:
            w = ob.matrix_world @ Vector(corner)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    extent = (hi - lo).length if hi.x > lo.x else 50.0
    radius = max(80.0, extent * 1.5)
    eye = cam.matrix_world.translation
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=64, ring_count=32, location=((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, eye.z))
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
    stops[0].position, stops[0].color = 0.495, (0.40, 0.42, 0.36, 1)  # distant ground
    stops[1].position, stops[1].color = 0.505, (0.78, 0.85, 0.93, 1)  # pale horizon
    top = stops.new(0.75)
    top.color = (0.42, 0.62, 0.92, 1)  # blue sky
    dome.data.materials.append(sky)
    dome.visible_shadow = False
    if hasattr(dome, "hide_probe_volume"):
        dome.hide_probe_volume = True
    cam_data.clip_end = max(cam_data.clip_end, radius * 2.5)

light = spec.get("lighting") or {}
world = bpy.data.worlds.new("roomia")
bpy.context.scene.world = world
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
    # Sun points down its local -Z: tilt from vertical by (90 - elevation), spin by azimuth.
    sun.rotation_euler = (math.radians(90 - light.get("sunElevation", 38)), 0, math.radians(light.get("sunAzimuth", 35)))

scene = bpy.context.scene
if spec.get("viewTransform"):
    # "Standard" shows material colours as they are; Blender's default AgX flattens and greys them.
    scene.view_settings.view_transform = spec["viewTransform"]
if spec.get("engine") == "CYCLES":
    # Path tracing: real reflections and glass. On the GPU (OptiX) when asked; the CPU works on any server.
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    if spec.get("cyclesDevice") == "GPU":
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
    scene.cycles.samples = spec.get("samples", 32)
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    if not spec.get("viewTransform"):
        scene.view_settings.view_transform = "Standard"
    # Cycles simulates real light, so a closed room is nearly black. A soft light at the camera
    # keeps everything in view readable, like the flat ambient light EEVEE fakes.
    fill_data = bpy.data.lights.new("fill", "POINT")
    fill_data.energy = spec.get("fillEnergy") or 1500
    fill_data.shadow_soft_size = 0.8
    fill = bpy.data.objects.new("fill", fill_data)
    bpy.context.collection.objects.link(fill)
    fill.location = mat.translation
else:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    if spec.get("raytrace"):
        # Ray-traced reflections and refraction; the sphere probe at the camera lets mirrors reflect
        # the room behind the camera, which screen-space tracing alone cannot see.
        scene.eevee.use_raytracing = True
        scene.eevee.gi_cubemap_resolution = "2048"  # sharp mirror reflections (the default probe is blurry)
        probe_data = bpy.data.lightprobes.new("roomia_probe", "SPHERE")
        probe_data.influence_distance = 25.0
        probe = bpy.data.objects.new("roomia_probe", probe_data)
        bpy.context.collection.objects.link(probe)
        probe.location = mat.translation
        if spec.get("sharpMirrors"):
            # Full-resolution, high-quality tracing without the denoiser that turned mirrors into fog.
            rt = scene.eevee.ray_tracing_options
            rt.resolution_scale = "1"
            rt.screen_trace_quality = 1.0
            rt.trace_max_roughness = 0.3
            rt.use_denoise = False
            print("MIRROR_PROBES", add_mirror_probes())
scene.render.resolution_x = spec["width"]
scene.render.resolution_y = spec["height"]
scene.render.filepath = spec["out"]
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("HEAVY_VIEW_OK")
`

const BLENDER_SCRIPT = SCENE_SETUP_SCRIPT + VIEW_SCRIPT

function runBlender(scriptPath: string, specPath: string): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(BLENDER, ['--background', '--python', scriptPath, '--', specPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    // Blender prints progress to stdout; if nobody reads it the pipe fills up and Blender freezes.
    child.stdout.resume()
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
    const unguard = guardMemory(child, reason => (stderr += `\nArrêté : ${reason}`))
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

export class BlenderRenderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** How the Blender capture is made; the photo step works from it. */
export interface CaptureOptions {
  engine: 'EEVEE' | 'CYCLES'
  /** Cycles on the RTX card (OptiX) instead of the CPU. */
  gpu: boolean
  /** EEVEE ray-traced reflections and refraction, plus a reflection probe at the camera. */
  raytrace: boolean
  /** See-through materials become real tinted glass. */
  realGlass: boolean
  /** Colour management: 'Standard' keeps material colours true; Blender's default is 'AgX'. */
  viewTransform?: 'Standard' | 'AgX'
  samples: number
  fillEnergy?: number
  /** Light the capture with white daylight whatever the time of day (the photo step sets the mood). */
  neutralLight?: boolean
  /** Exact mirror reflections: a planar probe on each mirror, full-resolution tracing, no denoiser. */
  sharpMirrors?: boolean
  /** A sky dome around the building, so windows and glass doors clearly show the outdoors. */
  outdoorSky?: boolean
}

/**
 * The capture the photo step works from. Chosen on 17 Oct by comparing 4 setups on Sarah's
 * living room, dining room and bathroom: EEVEE with ray tracing, real tinted glass, true colours
 * and neutral light showed the light oak, the smoked-glass table, the radiator and curtains
 * behind glass, and mirrors that reflect. Cycles on the GPU was as fast but lit the rooms black
 * and white without real lighting work. ROOMIA_CAPTURE=legacy brings back the old capture.
 */
export const DEFAULT_CAPTURE: CaptureOptions =
  process.env.ROOMIA_CAPTURE === 'legacy'
    ? { engine: ENGINE, gpu: false, raytrace: false, realGlass: false, samples: CYCLES_SAMPLES }
    : {
        engine: 'EEVEE',
        gpu: false,
        raytrace: true,
        realGlass: true,
        viewTransform: 'Standard',
        neutralLight: true,
        // 18 Oct: Sarah found the mirrors blurry. A planar probe per mirror plane makes them crystal clear.
        sharpMirrors: true,
        // 20 Oct: behind a glass door the outside was flat grey and the AI invented a room there.
        outdoorSky: true,
        samples: CYCLES_SAMPLES,
      }

export interface ViewSpec {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  /** Vertical field of view in degrees. */
  fov: number
}

/**
 * A saved scene camera as a render view, for the capture's 3:2 frame. `hfov` overrides the saved
 * lens: SketchUp scenes default to a narrow 35° that crops rooms much tighter than interior renders.
 */
export function viewFromSceneCamera(camera: SceneCamera, hfov = camera.hfov): ViewSpec {
  return {
    position: camera.position,
    quaternion: lookAtQuaternion(camera.position, camera.target),
    fov: verticalFov(hfov, CAPTURE_WIDTH / CAPTURE_HEIGHT),
  }
}

/**
 * Renders a view of the full-quality GLB with Blender and returns the PNG.
 * Takes about 8 s for a furnished kitchen once Blender has the file in cache.
 */
export async function renderSceneView(
  glb: string,
  view: ViewSpec,
  lighting?: Lighting,
  options: CaptureOptions = DEFAULT_CAPTURE,
  roles: MaterialRoles = {},
): Promise<{ png: Buffer; seconds: number }> {
  if (!(await access(glb).then(() => true, () => false))) {
    throw new BlenderRenderError('Le fichier complet est introuvable.', 404)
  }
  await acquireSlot()
  const dir = await mkdtemp(path.join(tmpdir(), 'roomia-heavy-'))
  const started = performance.now()
  try {
    const scriptPath = path.join(dir, 'render.py')
    const specPath = path.join(dir, 'camera.json')
    const outPath = path.join(dir, 'view.png')
    await writeFile(scriptPath, BLENDER_SCRIPT)
    await writeFile(
      specPath,
      JSON.stringify({
        glb,
        out: outPath,
        ...view,
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT,
        engine: options.engine,
        cyclesDevice: options.gpu ? 'GPU' : 'CPU',
        raytrace: options.raytrace,
        realGlass: options.realGlass,
        sharpMirrors: options.sharpMirrors,
        outdoorSky: options.outdoorSky,
        roles,
        finishRoughness: FINISH_ROUGHNESS,
        viewTransform: options.viewTransform,
        samples: options.samples,
        fillEnergy: options.fillEnergy,
        interior: lighting?.interior ?? true,
        lighting: lighting ? (options.neutralLight ? NEUTRAL_CAPTURE_LIGHT : blenderLighting(lighting)) : undefined,
      }),
    )
    const result = await runBlender(scriptPath, specPath)
    if (result.code !== 0) {
      const missing = result.stderr.includes('ENOENT') || result.stderr.includes('spawn')
      throw new BlenderRenderError(
        missing ? 'Blender est introuvable sur cette machine.' : 'Le rendu du fichier complet a échoué.',
        500,
      )
    }
    return { png: await readFile(outPath), seconds: (performance.now() - started) / 1000 }
  } finally {
    releaseSlot()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
