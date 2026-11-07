import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { CreditError } from './credits'
import { cloudPublishTour, type PublishProgress } from './roomia-cloud'
import { PHOTO_FILE } from './scene-photos'
import { readMeta, sceneDir, writeMeta } from './scene-store'
import { TOUR_FILE, tourDir } from './scene-tour'

/**
 * Roomia Desktop: publishing a project's tour to Roomia's server for the architect's clients (lib/desktop-drive.ts on
 * the other side). One publication at a time per project, followed by the Studio's pages through publishStatus.
 */

const progress = new Map<string, PublishProgress>()

/** The files the clients' tour needs: the saved views, the photos, and the tour files the build actually uses. */
async function tourFiles(sceneId: string): Promise<[string, string, number][]> {
  const dir = sceneDir(sceneId)
  const tdir = tourDir(sceneId)
  const tourJson = await readFile(path.join(tdir, 'tour.json'), 'utf8').catch(() => null)
  if (!tourJson) throw new CreditError('Cette visite n’a pas encore de 360° : créez-la avant de la publier.', 400)
  // every file named in tour.json (the panoramas in use, the plans); old AI panoramas no view points to stay home
  const named = new Set<string>()
  JSON.parse(tourJson, (_key, value) => {
    if (typeof value === 'string' && TOUR_FILE.test(value)) named.add(value)
    return value
  })
  const out: [string, string, number][] = []
  const add = async (remote: string, local: string) => {
    const s = await stat(local).catch(() => null)
    if (s?.isFile()) out.push([remote, local, s.size])
  }
  await add('cameras.json', path.join(dir, 'cameras.json'))
  await add('runs.jsonl', path.join(dir, 'runs.jsonl'))
  for (const f of await readdir(path.join(dir, 'photos')).catch(() => [] as string[])) {
    if (PHOTO_FILE.test(f)) await add(`photos/${f}`, path.join(dir, 'photos', f))
  }
  await add('tour/tour.json', path.join(tdir, 'tour.json'))
  for (const f of await readdir(tdir).catch(() => [] as string[])) {
    if (!TOUR_FILE.test(f)) continue
    if (/^pano-\d+-ai/.test(f) && !named.has(f)) continue
    await add(`tour/${f}`, path.join(tdir, f))
  }
  return out
}

export function publishStatus(sceneId: string): PublishProgress | null {
  return progress.get(sceneId) ?? null
}

export async function startPublishing(sceneId: string): Promise<PublishProgress> {
  const running = progress.get(sceneId)
  if (running?.state === 'sending') return running
  const meta = await readMeta(sceneId)
  if (!meta || meta.status !== 'ready') throw new CreditError('Projet introuvable.', 404)
  const files = await tourFiles(sceneId)
  const total = files.reduce((n, f) => n + f[2], 0)
  const state: PublishProgress = { state: 'sending', sent: 0, total }
  progress.set(sceneId, state)
  const title = meta.fileName.replace(/\.(glb|dae|zip)$/i, '')
  void cloudPublishTour({ title, id: meta.publishedAs?.id, files }, (sent, all) => {
    state.sent = sent
    state.total = all
  })
    .catch(async err => {
      // the link was removed from Mon espace: publish again as a new link
      if (err instanceof CreditError && err.status === 404 && meta.publishedAs) {
        return cloudPublishTour({ title, files }, (sent, all) => {
          state.sent = sent
          state.total = all
        })
      }
      throw err
    })
    .then(async ({ id, url }) => {
      const now = await readMeta(sceneId)
      if (now) await writeMeta({ ...now, publishedAs: { id, url, at: Date.now() } })
      Object.assign(state, { state: 'done', sent: total, id, url })
    })
    .catch(err => {
      console.error('publish failed', err)
      Object.assign(state, { state: 'failed', error: err instanceof Error ? err.message : String(err) })
    })
  return state
}
