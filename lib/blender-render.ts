import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { blenderLighting, NEUTRAL_CAPTURE_LIGHT, type Lighting } from './render-lighting'
import type { MaterialRoles } from './material-roles'
import { lookAtQuaternion, verticalFov, type SceneCamera } from './scene-cameras'

const BLENDER = process.env.ROOMIA_BLENDER ?? 'blender'
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

/** 3:2, the same shape as the final photo (1536×1024), so the photo step never has to re-frame. */
export const CAPTURE_WIDTH = 1536
export const CAPTURE_HEIGHT = 1024

const BLENDER_SCRIPT = String.raw`
import bpy, json, math, sys
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv
spec = json.loads(open(argv[argv.index("--") + 1], encoding="utf-8").read())

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=spec["glb"])

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
ROLES = spec.get("roles") or {}

def role_of(mat):
    base = re.sub(r"\.\d{3}$", "", mat.name)
    if base in ROLES:
        return ROLES[base]
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
    if role == "mirror":
        for l in link_into(mat, bsdf, "Base Color"):
            mat.node_tree.links.remove(l)
        bsdf.inputs["Base Color"].default_value = (0.92, 0.92, 0.92, 1)
        bsdf.inputs["Metallic"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = 0.02
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

def tint_of(bsdf, forced):
    # glTF glass is "base colour at some alpha"; as real glass that becomes a tint between clear and the colour.
    # An opaque material the designer marked as glass gets a light tint of its colour.
    r, g, b, _ = bsdf.inputs["Base Color"].default_value
    a = bsdf.inputs["Alpha"].default_value
    if forced and a >= 0.9:
        a = 0.3
    return tuple(1.0 - a * (1.0 - c) for c in (r, g, b))

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

px, py, pz = spec["position"]
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
scene.render.resolution_x = spec["width"]
scene.render.resolution_y = spec["height"]
scene.render.filepath = spec["out"]
scene.render.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("HEAVY_VIEW_OK")
`

function runBlender(scriptPath: string, specPath: string): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(BLENDER, ['--background', '--python', scriptPath, '--', specPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    // Blender prints progress to stdout; if nobody reads it the pipe fills up and Blender freezes.
    child.stdout.resume()
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
    child.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-8000)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stderr })
    })
    child.on('error', err => {
      clearTimeout(timer)
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
    : { engine: 'EEVEE', gpu: false, raytrace: true, realGlass: true, viewTransform: 'Standard', neutralLight: true, samples: CYCLES_SAMPLES }

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
        roles,
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
