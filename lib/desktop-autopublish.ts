import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { publishStatus, startPublishing } from './desktop-publish'
import { lookBusy } from './look-pipeline'
import { cloudMode } from './roomia-cloud'
import { isWorking } from './scene-jobs'
import { PHOTO_FILE } from './scene-photos'
import { isSceneId, readMeta, SCENES_DIR, sceneDir } from './scene-store'
import { TOUR_FILE, tourDir } from './scene-tour'

/**
 * 25 Nov: a client's link never stays behind the project. Sarah's link kept the morning's Blender panoramas and an empty
 * gallery after the evening's AI light and photos, because nobody pressed "Publier" again. Every minute, a project that
 * has a link and whose tour changed since it was published (AI light, photos, a point hidden or renamed, new plans) is
 * published again, once nothing has been written for QUIET_MS and no render, AI or import runs on it.
 */

const EVERY_MS = 60_000
const QUIET_MS = Number(process.env.ROOMIA_AUTOPUBLISH_QUIET_MS ?? 3 * 60_000)
const RETRY_MS = 10 * 60_000

/** What the client's link shows, as names, sizes and dates: the same files lib/desktop-publish.ts sends (runs.jsonl aside, it changes with every job). */
export async function publishSignature(sceneId: string): Promise<{ sig: string; newest: number }> {
  const dir = sceneDir(sceneId)
  const tdir = tourDir(sceneId)
  const entries: string[] = []
  let newest = 0
  const add = async (rel: string, file: string) => {
    const s = await stat(file).catch(() => null)
    if (!s?.isFile()) return
    entries.push(`${rel}:${s.size}:${Math.round(s.mtimeMs)}`)
    newest = Math.max(newest, s.mtimeMs)
  }
  const tourJson = await readFile(path.join(tdir, 'tour.json'), 'utf8').catch(() => '')
  const named = new Set<string>()
  if (tourJson) {
    JSON.parse(tourJson, (_key, value) => {
      if (typeof value === 'string' && TOUR_FILE.test(value)) named.add(value)
      return value
    })
  }
  await add('cameras.json', path.join(dir, 'cameras.json'))
  await add('tour/tour.json', path.join(tdir, 'tour.json'))
  await add('tour/labels.json', path.join(tdir, 'labels.json'))
  for (const f of await readdir(path.join(dir, 'photos')).catch(() => [] as string[])) {
    if (PHOTO_FILE.test(f)) await add(`photos/${f}`, path.join(dir, 'photos', f))
  }
  for (const f of await readdir(tdir).catch(() => [] as string[])) {
    if (!TOUR_FILE.test(f) || f === 'tour-published.json') continue
    if (/^pano-\d+-ai/.test(f) && !named.has(f)) continue
    await add(`tour/${f}`, path.join(tdir, f))
  }
  entries.sort()
  return { sig: createHash('sha1').update(entries.join('\n')).digest('hex'), newest }
}

const lastTry = new Map<string, number>()

async function checkProject(sceneId: string): Promise<void> {
  const meta = await readMeta(sceneId).catch(() => null)
  const pub = meta?.publishedAs
  if (!meta || meta.status !== 'ready' || !pub) return
  if (publishStatus(sceneId)?.state === 'sending' || lookBusy(sceneId) || isWorking(sceneId)) return
  if (Date.now() - (lastTry.get(sceneId) ?? 0) < RETRY_MS) return
  const { sig, newest } = await publishSignature(sceneId)
  // a link published before 25 Nov has no signature: compared by date instead
  const changed = pub.sig ? pub.sig !== sig : newest > pub.at
  if (!changed || Date.now() - newest < QUIET_MS) return
  lastTry.set(sceneId, Date.now())
  console.log(`autopublish: ${sceneId} changed since ${new Date(pub.at).toISOString()}, updating ${pub.url}`)
  await startPublishing(sceneId).catch(err => console.error('autopublish failed', sceneId, err))
}

let started = false

export function startAutoPublish(): void {
  if (started || !cloudMode()) return
  started = true
  let running = false
  setInterval(async () => {
    if (running) return
    running = true
    try {
      const ids = (await readdir(SCENES_DIR).catch(() => [] as string[])).filter(isSceneId)
      for (const id of ids) await checkProject(id).catch(err => console.error('autopublish check failed', id, err))
    } finally {
      running = false
    }
  }, EVERY_MS).unref()
}
