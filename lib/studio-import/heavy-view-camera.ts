export interface HeavyViewCamera {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  /** Vertical field of view of the screen camera, degrees. */
  fov: number
  /** Horizontal field of view of the screen camera, degrees. */
  hfov: number
}

let capture: (() => HeavyViewCamera | null) | null = null

export function registerHeavyCapture(fn: (() => HeavyViewCamera | null) | null) {
  capture = fn
}

export function captureHeavyCamera(): HeavyViewCamera | null {
  return capture?.() ?? null
}

/** A saved view in the imported file's own frame (metres, Y-up); hfov = horizontal field of view. */
export interface SceneViewTarget {
  position: [number, number, number]
  target: [number, number, number]
  hfov: number
}

let moveCamera: ((view: SceneViewTarget) => void) | null = null

export function registerCameraMover(fn: ((view: SceneViewTarget) => void) | null) {
  moveCamera = fn
}

/** Points Studio's camera at a saved view; does nothing until an imported room is on screen. */
export function applySceneView(view: SceneViewTarget): boolean {
  if (!moveCamera) return false
  moveCamera(view)
  return true
}
