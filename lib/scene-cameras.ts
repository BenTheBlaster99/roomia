import * as THREE from 'three'

/**
 * A saved view of a scene, in the prepared GLB's frame (metres, Y-up).
 * `hfov` is the horizontal field of view in degrees, as SketchUp stores it.
 */
export interface SceneCamera {
  name: string
  position: [number, number, number]
  target: [number, number, number]
  hfov: number
}

export type Vec3 = [number, number, number]

const INCH = 0.0254
const MAX_CAMERAS = 100

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n))

/** SketchUp inches, Z-up → glTF metres, Y-up. */
const sketchUpToGltf = ([x, y, z]: Vec3): Vec3 => [x * INCH, z * INCH, -y * INCH]

/**
 * Reads the JSON written by SketchUp camera-export extensions (e.g. Z5 Camera Transfer):
 * [{ name, camera: { eye, target, up, fov, perspective } }, …] in SketchUp inches.
 */
export function fromSketchUpScenes(data: unknown): SceneCamera[] {
  if (!Array.isArray(data)) return []
  const cameras: SceneCamera[] = []
  for (const entry of data.slice(0, MAX_CAMERAS)) {
    const cam = (entry as { camera?: Record<string, unknown> } | null)?.camera
    const name = (entry as { name?: unknown } | null)?.name
    if (!cam || typeof name !== 'string' || !isVec3(cam.eye) || !isVec3(cam.target)) continue
    if (cam.perspective === false) continue
    const fov = typeof cam.fov === 'number' && cam.fov >= 5 && cam.fov <= 150 ? cam.fov : 60
    const position = sketchUpToGltf(cam.eye)
    const target = sketchUpToGltf(cam.target)
    if (position.every((v, i) => v === target[i])) continue
    cameras.push({ name: name.slice(0, 80), position, target, hfov: fov })
  }
  return cameras
}

/** Orientation (quaternion x, y, z, w) of a camera at `position` looking at `target`, Y-up. */
export function lookAtQuaternion(position: Vec3, target: Vec3): [number, number, number, number] {
  const m = new THREE.Matrix4().lookAt(
    new THREE.Vector3(...position),
    new THREE.Vector3(...target),
    new THREE.Vector3(0, 1, 0),
  )
  const q = new THREE.Quaternion().setFromRotationMatrix(m)
  return [q.x, q.y, q.z, q.w]
}

/** Vertical field of view (degrees) for a horizontal one at the given width / height. */
export function verticalFov(hfov: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI
}

/**
 * Lens choices for a photo, as full-frame focal lengths (what designers know). 'file' keeps the
 * view's saved field of view; SketchUp's default 35° crops a room much tighter than a 24 mm render.
 */
export const LENSES = [
  { id: 'file', label: 'Fichier' },
  { id: '35', label: '35 mm' },
  { id: '24', label: '24 mm' },
  { id: '18', label: '18 mm' },
] as const
export type LensId = (typeof LENSES)[number]['id']
export const DEFAULT_LENS: LensId = '24'

export const isLensId = (v: unknown): v is LensId => LENSES.some(l => l.id === v)

/** Horizontal field of view (degrees) of a lens on a view: 24 mm → 73.7°. */
export function lensHfov(lens: LensId, camera: SceneCamera): number {
  if (lens === 'file') return camera.hfov
  return (2 * Math.atan(18 / Number(lens)) * 180) / Math.PI
}

/** "skp_camera_Scène_1" → "Scène 1". */
export function cleanCameraName(raw: string): string {
  const name = raw.replace(/^skp_camera_/, '').replace(/_/g, ' ').trim()
  return /last saved sketchup view/i.test(name) ? 'Dernière vue' : name || 'Vue'
}
