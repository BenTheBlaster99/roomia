import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import type { SceneCamera } from './scene-cameras'
import { cleanRoles, type MaterialRoles } from './material-roles'

export const SCENES_DIR = process.env.SCENES_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), '.scenes')
export const MAX_SCENE_BYTES = Number(process.env.SCENE_MAX_BYTES ?? 2 * 1024 ** 3)
const SCENE_TTL_MS = Number(process.env.SCENE_TTL_HOURS ?? 24 * 7) * 3600_000

/** Size of each piece the browser sends in a resumable upload. Small enough to finish in seconds on a weak line. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

export const SCENE_FORMATS = ['dae', 'glb', 'zip'] as const
export type SceneFormat = (typeof SCENE_FORMATS)[number]

export type SceneStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export interface SceneReport {
  inBytes: number
  outBytes: number
  trianglesIn: number
  trianglesOut: number
  totalSeconds: number
  /** Texture images the scene asked for but that were not in the upload. */
  missingTextures?: string[]
  /** Textures the exporter replaced with an "invalid Texture" image (removed during preparation). */
  placeholderTextures?: number
}

export interface SceneMeta {
  id: string
  status: SceneStatus
  fileName: string
  format: SceneFormat
  bytes: number
  createdAt: number
  error?: string
  report?: SceneReport
}

const ID_PATTERN = /^[A-Za-z0-9_-]{21}$/

export function isSceneId(id: string): boolean {
  return ID_PATTERN.test(id)
}

/** Directory for one scene. Ids are random nanoids, never user-provided names. */
export function sceneDir(id: string): string {
  if (!isSceneId(id)) throw new Error('Invalid scene id')
  return path.join(SCENES_DIR, id)
}

export const originalPath = (id: string, format: SceneFormat) =>
  path.join(sceneDir(id), `original.${format}`)
export const sourcePath = (id: string) => path.join(sceneDir(id), 'source.glb')
export const viewportPath = (id: string) => path.join(sceneDir(id), 'viewport.glb')
export const camerasPath = (id: string) => path.join(sceneDir(id), 'cameras.json')
export const materialRolesPath = (id: string) => path.join(sceneDir(id), 'material-roles.json')

export function sceneFormatOf(fileName: string): SceneFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return SCENE_FORMATS.find(f => f === ext) ?? null
}

export async function readMeta(id: string): Promise<SceneMeta | null> {
  if (!isSceneId(id)) return null
  try {
    return JSON.parse(await readFile(path.join(sceneDir(id), 'meta.json'), 'utf8')) as SceneMeta
  } catch {
    return null
  }
}

export async function writeMeta(meta: SceneMeta): Promise<void> {
  const file = path.join(sceneDir(meta.id), 'meta.json')
  await writeFile(`${file}.tmp`, JSON.stringify(meta))
  await rename(`${file}.tmp`, file)
}

export async function createScene(
  fileName: string,
  format: SceneFormat,
  status: SceneStatus = 'processing',
): Promise<SceneMeta> {
  const id = nanoid()
  await mkdir(sceneDir(id), { recursive: true })
  const meta: SceneMeta = {
    id,
    status,
    fileName: fileName.slice(0, 200),
    format,
    bytes: 0,
    createdAt: Date.now(),
  }
  await writeMeta(meta)
  void pruneOldScenes()
  return meta
}

export async function deleteScene(id: string): Promise<void> {
  await rm(sceneDir(id), { recursive: true, force: true })
}

/** Removes scenes older than SCENE_TTL_HOURS (default 7 days). Best effort. */
async function pruneOldScenes(): Promise<void> {
  try {
    const now = Date.now()
    for (const id of await readdir(SCENES_DIR)) {
      if (!isSceneId(id)) continue
      const s = await stat(sceneDir(id))
      if (now - s.mtimeMs > SCENE_TTL_MS) await deleteScene(id)
    }
  } catch {
    // nothing to prune yet
  }
}

export async function readCameras(id: string): Promise<SceneCamera[]> {
  try {
    return JSON.parse(await readFile(camerasPath(id), 'utf8')) as SceneCamera[]
  } catch {
    return []
  }
}

export async function writeCameras(id: string, cameras: SceneCamera[]): Promise<void> {
  await writeFile(camerasPath(id), JSON.stringify(cameras))
}

/** The designer's material roles for a scene (mirror, glass, light…); empty when none were set. */
export async function readMaterialRoles(id: string): Promise<MaterialRoles> {
  const raw = await readFile(materialRolesPath(id), 'utf8').catch(() => null)
  return raw ? cleanRoles(JSON.parse(raw)) : {}
}

export async function writeMaterialRoles(id: string, roles: MaterialRoles): Promise<void> {
  await writeFile(materialRolesPath(id), JSON.stringify(roles))
}
