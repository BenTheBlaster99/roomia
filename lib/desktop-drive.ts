import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { nanoid } from 'nanoid'
import { getDb } from './db'
import { PHOTO_FILE } from './scene-photos'
import { isSceneId, readMeta, SCENES_DIR, sceneDir, writeMeta, type SceneMeta } from './scene-store'
import { TOUR_FILE } from './scene-tour'

/**
 * A Roomia Desktop account's space on Roomia's server ("Mon espace"): what it paid for and what it published stays
 * here, whatever happens to the architect's PC.
 *
 * - Photos: every AI photo delivered to the account (app/api/desktop/photo keeps them by job).
 * - Tours: a tour built on the architect's PC, published for their clients. It lands as a scene of its own with only
 *   the tour and the photos (no model), marked `published` so anyone with the link can view it and it is never
 *   pruned (lib/scene-store.ts). Files come in resumable pieces (a Cloudflare request is capped at 100 MB).
 */

// like the Studio's own uploads (UPLOAD_CHUNK_BYTES): a piece must arrive well within Cloudflare's 100 s on a weak line
export const PUBLISH_CHUNK_BYTES = 8 * 1024 * 1024
const MAX_TOUR_BYTES = 3 * 1024 ** 3
const MAX_TOURS_PER_ACCOUNT = 50
const MAX_FILES = 2000

export interface DrivePhoto {
  job: string
  project: string
  view: string
  at: number
}

/** The account's delivered photos, newest first. */
export function listDrivePhotos(userId: number, limit = 500): DrivePhoto[] {
  return getDb()
    .prepare("SELECT id, scene_id, view, finished_at, created_at FROM jobs WHERE user_id = ? AND status = 'consumed' AND scene_id LIKE 'desktop:%' ORDER BY COALESCE(finished_at, created_at) DESC LIMIT ?")
    .all(userId, limit)
    .map(r => ({
      job: String(r.id),
      project: String(r.scene_id).replace(/^desktop:/, ''),
      view: String(r.view ?? ''),
      at: Number(r.finished_at ?? r.created_at),
    }))
}

export interface DriveTour {
  id: string
  title: string
  at: number
  bytes: number
  from?: string
}

export async function listDriveTours(userId: number): Promise<DriveTour[]> {
  const tours: DriveTour[] = []
  for (const id of await readdir(SCENES_DIR).catch(() => [] as string[])) {
    if (!isSceneId(id)) continue
    const meta = await readMeta(id).catch(() => null)
    if (!meta?.published || meta.published.userId !== userId || meta.status !== 'ready') continue
    tours.push({ id, title: meta.fileName, at: meta.published.at, bytes: meta.published.bytes, from: meta.published.from })
  }
  return tours.sort((a, b) => b.at - a.at)
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** A published tour of this account, or null. */
async function ownTour(userId: number, id: string): Promise<SceneMeta | null> {
  if (!isSceneId(id)) return null
  const meta = await readMeta(id).catch(() => null)
  return meta?.published?.userId === userId ? meta : null
}

/**
 * Starts a publication: a new tour, or a new upload for one this account already published (same link). Files go to
 * `incoming/` and replace the live ones only when the upload is complete (finishPublish).
 */
export async function startPublish(userId: number, title: string, from: string, id?: string): Promise<{ id: string }> {
  if (id) {
    const meta = await ownTour(userId, id)
    if (!meta) throw new DriveError('Visite introuvable sur votre compte.', 404)
    await rm(path.join(sceneDir(id), 'incoming'), { recursive: true, force: true })
    await mkdir(path.join(sceneDir(id), 'incoming'), { recursive: true })
    return { id }
  }
  if ((await listDriveTours(userId)).length >= MAX_TOURS_PER_ACCOUNT) {
    throw new DriveError(`Limite de ${MAX_TOURS_PER_ACCOUNT} visites publiées atteinte : retirez-en une depuis Mon espace.`, 409)
  }
  const newId = nanoid()
  await mkdir(path.join(sceneDir(newId), 'incoming'), { recursive: true })
  // 'processing' until the files are in: nobody sees a half-sent tour
  await writeMeta({
    id: newId,
    status: 'processing',
    fileName: title.slice(0, 120) || 'Visite',
    format: 'glb',
    bytes: 0,
    createdAt: Date.now(),
    ownerId: userId,
    published: { userId, at: Date.now(), bytes: 0, from: from.slice(0, 40) },
  })
  return { id: newId }
}

/** The files a published tour may hold: the saved views, the photos, and the tour's own files. */
export function publishablePath(rel: string): boolean {
  if (rel === 'cameras.json' || rel === 'runs.jsonl') return true
  const [dir, file, extra] = rel.split('/')
  if (extra !== undefined || !file) return false
  if (dir === 'photos') return PHOTO_FILE.test(file)
  if (dir === 'tour') return file === 'tour.json' || TOUR_FILE.test(file)
  return false
}

/**
 * One piece of one file, at `offset`. The offset must be the size already received (a retry of a piece that arrived
 * answers its size, so the app goes on from there).
 */
export async function putPublishChunk(userId: number, id: string, rel: string, offset: number, body: ReadableStream<Uint8Array>): Promise<number> {
  if (!(await ownTour(userId, id))) throw new DriveError('Visite introuvable sur votre compte.', 404)
  if (!publishablePath(rel)) throw new DriveError(`Fichier refusé : ${rel}`, 400)
  const file = path.join(sceneDir(id), 'incoming', rel)
  await mkdir(path.dirname(file), { recursive: true })
  const have = await stat(file).then(s => s.size, () => 0)
  if (offset !== have) return have
  if (offset + PUBLISH_CHUNK_BYTES > MAX_TOUR_BYTES) throw new DriveError('Visite trop lourde.', 413)
  let received = 0
  const limited = Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>)
  limited.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (received > PUBLISH_CHUNK_BYTES + 1024) limited.destroy(new DriveError('Morceau trop gros.', 413))
  })
  await pipeline(limited, createWriteStream(file, { flags: offset ? 'a' : 'w' }))
  return offset + received
}

/** Checks every file arrived whole, swaps the new files in, and opens the tour to its link. */
export async function finishPublish(userId: number, id: string, files: { path: string; bytes: number }[]): Promise<{ id: string; bytes: number }> {
  const meta = await ownTour(userId, id)
  if (!meta) throw new DriveError('Visite introuvable sur votre compte.', 404)
  if (!files.length || files.length > MAX_FILES) throw new DriveError('Liste de fichiers invalide.', 400)
  if (!files.some(f => f.path === 'tour/tour.json')) throw new DriveError('Cette visite n’a pas encore de 360° : créez-la avant de la publier.', 400)
  const incoming = path.join(sceneDir(id), 'incoming')
  let bytes = 0
  for (const f of files) {
    if (!publishablePath(f.path)) throw new DriveError(`Fichier refusé : ${f.path}`, 400)
    const size = await stat(path.join(incoming, f.path)).then(s => s.size, () => -1)
    if (size !== f.bytes) throw new DriveError(`Envoi incomplet (${f.path}) : relancez la publication.`, 409)
    bytes += size
  }
  if (bytes > MAX_TOUR_BYTES) throw new DriveError('Visite trop lourde.', 413)
  const dir = sceneDir(id)
  // the old files go aside first, so a failed swap never leaves a half tour behind the link
  const old = path.join(dir, `old-${Date.now()}`)
  await mkdir(old, { recursive: true })
  for (const name of ['tour', 'photos', 'cameras.json', 'runs.jsonl']) {
    await rename(path.join(dir, name), path.join(old, name)).catch(() => undefined)
  }
  for (const name of ['tour', 'photos', 'cameras.json', 'runs.jsonl']) {
    await rename(path.join(incoming, name), path.join(dir, name)).catch(() => undefined)
  }
  await mkdir(path.join(dir, 'tour'), { recursive: true })
  await mkdir(path.join(dir, 'photos'), { recursive: true })
  // the tour was built on the architect's PC: it is done here
  await writeFile(path.join(dir, 'tour', 'status.json'), JSON.stringify({ state: 'done' }))
  await rm(old, { recursive: true, force: true })
  await rm(incoming, { recursive: true, force: true })
  await writeMeta({ ...meta, status: 'ready', bytes, published: { ...meta.published!, at: Date.now(), bytes } })
  return { id, bytes }
}

export async function unpublish(userId: number, id: string): Promise<void> {
  if (!(await ownTour(userId, id))) throw new DriveError('Visite introuvable sur votre compte.', 404)
  await rm(sceneDir(id), { recursive: true, force: true })
}
