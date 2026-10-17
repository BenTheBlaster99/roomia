import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CAPTURE_HEIGHT, CAPTURE_WIDTH, DEFAULT_CAPTURE, renderSceneView, viewFromSceneCamera, type ViewSpec } from './blender-render'
import type { MaterialRoles } from './material-roles'
import { isTimeOfDay, type Lighting } from './render-lighting'
import { DEFAULT_LENS, isLensId, lensHfov, verticalFov, type LensId, type SceneCamera } from './scene-cameras'
import { readMaterialRoles, sceneDir, sourcePath } from './scene-store'

/** Name used in logs and file names when the photo is taken from Studio's own camera. */
export const CURRENT_VIEW_NAME = 'Vue actuelle'

export interface CaptureRequest {
  view: ViewSpec
  name: string
  lens: LensId | 'current'
  lighting: Lighting
}

const finite = (value: unknown, length: number): number[] | null => {
  if (!Array.isArray(value) || value.length !== length) return null
  const nums = value.map(Number)
  return nums.some(n => !Number.isFinite(n)) ? null : nums
}

/**
 * Reads what to capture from a request body: either one of the scene's saved views (cameraIndex
 * plus a lens) or Studio's current camera (`current`: position + quaternion in the file's frame,
 * and its horizontal field of view, so the 3:2 capture spans what the screen showed).
 */
export function parseCaptureRequest(body: Record<string, unknown> | null, cameras: SceneCamera[]): CaptureRequest | string {
  const lighting: Lighting = {
    time: isTimeOfDay(body?.time) ? body.time : 'midi',
    sun: body?.sun !== false,
    interior: body?.interior !== false,
  }
  const current = body?.current as Record<string, unknown> | undefined
  if (current) {
    const position = finite(current.position, 3)
    const quaternion = finite(current.quaternion, 4)
    const hfov = Number(current.hfov)
    if (!position || !quaternion || !Number.isFinite(hfov) || hfov < 10 || hfov > 140) return 'Caméra invalide.'
    return {
      view: {
        position: position as ViewSpec['position'],
        quaternion: quaternion as ViewSpec['quaternion'],
        fov: verticalFov(hfov, CAPTURE_WIDTH / CAPTURE_HEIGHT),
      },
      name: CURRENT_VIEW_NAME,
      lens: 'current',
      lighting,
    }
  }
  const index = Number(body?.cameraIndex)
  const camera = Number.isInteger(index) ? cameras[index] : undefined
  if (!camera) return 'Vue enregistrée introuvable.'
  const lens = body && isLensId(body.lens) ? body.lens : DEFAULT_LENS
  return { view: viewFromSceneCamera(camera, lensHfov(lens, camera)), name: camera.name, lens, lighting }
}

/**
 * Same view, capture setup, light and file version → same capture (the file's mtime changes when
 * a scene is cleaned). With neutral capture light only the interior lights matter, so one
 * capture serves every time of day.
 */
async function captureFile(sceneId: string, request: CaptureRequest, roles: MaterialRoles): Promise<string> {
  const { mtimeMs } = await stat(sourcePath(sceneId))
  const light = DEFAULT_CAPTURE.neutralLight ? { interior: request.lighting.interior } : request.lighting
  const key = createHash('sha1')
    .update(JSON.stringify([request.view, DEFAULT_CAPTURE, light, roles, mtimeMs]))
    .digest('hex')
    .slice(0, 20)
  return path.join(sceneDir(sceneId), 'captures', `${key}.png`)
}

/**
 * The Blender capture for a request, rendered once and kept: "Vérifier la vue" makes it for
 * free, and the photo that follows (or a retry after a gateway failure) skips the 1.5-2.5 min
 * Blender step.
 */
export async function getCapture(
  sceneId: string,
  request: CaptureRequest,
): Promise<{ png: Buffer; seconds: number; reused: boolean }> {
  // Changing a material's role (Studio > Matériaux) changes the capture, so it is part of the key.
  const roles = await readMaterialRoles(sceneId)
  const file = await captureFile(sceneId, request, roles)
  const kept = await readFile(file).catch(() => null)
  if (kept) return { png: kept, seconds: 0, reused: true }
  const { png, seconds } = await renderSceneView(sourcePath(sceneId), request.view, request.lighting, DEFAULT_CAPTURE, roles)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, png)
  return { png, seconds, reused: false }
}
