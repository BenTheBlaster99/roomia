import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { isSceneId, readCameras, readMeta, SCENES_DIR, sceneDir, type SceneMeta } from './scene-store'
import { readTourStatus, tourDir } from './scene-tour'

/** Roomia Desktop only: the projects on this PC ("Mes projets"). */
export const desktopMode = () => process.env.ROOMIA_DESKTOP === '1'

export interface DesktopProject {
  id: string
  name: string
  fileName: string
  status: SceneMeta['status']
  error?: string
  createdAt: number
  updatedAt: number
  bytes: number
  views: number
  tour: 'none' | 'building' | 'done' | 'failed'
  walk: boolean
  photos: number
  published: SceneMeta['publishedAs'] | null
  /** Sent again from SketchUp: the project it is a new version of, to update that project's tour instead. */
  versionOf: { id: string; name: string; tour: boolean } | null
}

async function folderBytes(dir: string, depth = 0): Promise<{ bytes: number; newest: number }> {
  let bytes = 0
  let newest = 0
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth > 4) continue
      const sub = await folderBytes(full, depth + 1)
      bytes += sub.bytes
      newest = Math.max(newest, sub.newest)
    } else {
      const s = await stat(full).catch(() => null)
      if (s) {
        bytes += s.size
        newest = Math.max(newest, s.mtimeMs)
      }
    }
  }
  return { bytes, newest }
}

export async function readProject(id: string): Promise<DesktopProject | null> {
  const meta = await readMeta(id).catch(() => null)
  if (!meta) return null
  const [size, cameras, status, tourJson, nav, photos] = await Promise.all([
    folderBytes(sceneDir(id)),
    readCameras(id),
    readTourStatus(id).catch(() => ({ state: 'idle' as const })),
    stat(path.join(tourDir(id), 'tour.json')).then(() => true, () => false),
    stat(path.join(tourDir(id), 'nav.json')).then(() => true, () => false),
    readdir(path.join(sceneDir(id), 'photos')).then(f => f.filter(n => n.endsWith('.jpg') && !n.endsWith('-capture.jpg')).length, () => 0),
  ])
  return {
    id,
    name: meta.fileName.replace(/\.(glb|dae|zip)$/i, ''),
    fileName: meta.fileName,
    status: meta.status,
    error: meta.error,
    createdAt: meta.createdAt,
    updatedAt: Math.max(meta.createdAt, size.newest),
    bytes: size.bytes,
    views: cameras.length,
    tour: status.state === 'building' ? 'building' : status.state === 'failed' ? 'failed' : tourJson ? 'done' : 'none',
    walk: nav,
    photos,
    published: meta.publishedAs ?? null,
    versionOf: await versionOf(meta),
  }
}

async function versionOf(meta: SceneMeta): Promise<DesktopProject['versionOf']> {
  const id = meta.source?.versionOf
  if (!id || !isSceneId(id)) return null
  const old = await readMeta(id).catch(() => null)
  if (!old || old.status !== 'ready') return null
  const tour = await stat(path.join(tourDir(id), 'tour.json')).then(() => true, () => false)
  return { id, name: old.fileName.replace(/\.(glb|dae|zip)$/i, ''), tour }
}

export async function listProjects(): Promise<DesktopProject[]> {
  const ids = (await readdir(SCENES_DIR).catch(() => [] as string[])).filter(isSceneId)
  const projects = (await Promise.all(ids.map(readProject))).filter((p): p is DesktopProject => !!p)
  return projects.sort((a, b) => b.updatedAt - a.updatedAt)
}
