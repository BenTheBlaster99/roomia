import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { blenderLighting, type Lighting } from './render-lighting'
import { lookAtQuaternion, verticalFov, type SceneCamera } from './scene-cameras'

const BLENDER = process.env.ROOMIA_BLENDER ?? 'blender'
const TIMEOUT_MS = Number(process.env.ROOMIA_BLENDER_TIMEOUT_MS ?? 150_000)
export const CAPTURE_WIDTH = 1280
export const CAPTURE_HEIGHT = 720

const BLENDER_SCRIPT = `
import bpy, json, math, sys
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv
spec = json.loads(open(argv[argv.index("--") + 1], encoding="utf-8").read())

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=spec["glb"])

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
scene.render.engine = "BLENDER_EEVEE_NEXT"
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

export interface ViewSpec {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  /** Vertical field of view in degrees. */
  fov: number
}

/** A saved scene camera as a render view, for the capture's 16:9 frame. */
export function viewFromSceneCamera(camera: SceneCamera): ViewSpec {
  return {
    position: camera.position,
    quaternion: lookAtQuaternion(camera.position, camera.target),
    fov: verticalFov(camera.hfov, CAPTURE_WIDTH / CAPTURE_HEIGHT),
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
): Promise<{ png: Buffer; seconds: number }> {
  if (!(await access(glb).then(() => true, () => false))) {
    throw new BlenderRenderError('Le fichier complet est introuvable.', 404)
  }
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
        lighting: lighting ? blenderLighting(lighting) : undefined,
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
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
