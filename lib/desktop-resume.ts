import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { killAllRoomiaBlenders } from './blender-guard'
import { startLookRender } from './look-pipeline'
import { enqueueScene } from './scene-jobs'
import { startTourBuild, tourDir, type TourStatus } from './scene-tour'
import { isSceneId, originalPath, readMeta, sceneDir, SCENES_DIR } from './scene-store'

/**
 * Roomia Desktop: work the app was doing when it closed or crashed starts again by itself (instrumentation.ts).
 * - An import left half-way is prepared again from the file it kept.
 * - A free tour build (Blender) is started again, and so is a free "Présentation" render (lib/look-pipeline.ts) cut the same way.
 *   A paid AI step never restarts on its own: the architect decides (the tiles already made are kept). A job the person stopped
 *   with "Arrêter" is not restarted either.
 * One build at a time (the Blender slot queues the others), oldest first.
 */
export async function resumeInterruptedWork(): Promise<void> {
  // a Blender left by a job of an older server (cut by an update or a crash) would still heat the card, unseen: end it first
  await killAllRoomiaBlenders().catch(() => 0)
  const ids = (await readdir(SCENES_DIR).catch(() => [] as string[])).filter(isSceneId)
  const tours: { id: string; at: number }[] = []
  const looks: string[] = []
  // this server's own start: an import begun since then is this server's, still running (5 Nov: a send from SketchUp
  // arrived while the app was opening, and the resume read its zip half-written)
  const startedAt = Date.now() - process.uptime() * 1000
  for (const id of ids) {
    const meta = await readMeta(id).catch(() => null)
    if (!meta) continue
    if (meta.status === 'processing' && meta.createdAt >= startedAt) continue
    if (meta.status === 'processing' && (await stat(originalPath(id, meta.format)).then(() => true, () => false))) {
      console.log(`resume: import of ${id} (${meta.fileName})`)
      enqueueScene(id)
      continue
    }
    if (meta.status !== 'ready') continue
    const raw = JSON.parse(await readFile(path.join(tourDir(id), 'status.json'), 'utf8').catch(() => '{}')) as TourStatus
    if (raw.state === 'building' && raw.kind !== 'ai' && raw.pid !== process.pid) tours.push({ id, at: Date.parse(raw.startedAt ?? '') || 0 })
    const look = JSON.parse(await readFile(path.join(sceneDir(id), 'look', 'auto', 'state.json'), 'utf8').catch(() => '{}')) as { stage?: string; job?: string }
    if (look.stage === 'running' && look.job === 'render') looks.push(id)
  }
  for (const { id } of tours.sort((a, b) => a.at - b.at)) {
    console.log(`resume: tour build of ${id}`)
    // the old server's pid may belong to another program by now (Windows reuses them): mark the build as cut first
    await writeFile(path.join(tourDir(id), 'status.json'), JSON.stringify({ state: 'failed', error: 'Interrompue, reprise automatique.' }))
    await startTourBuild(id).catch(err => console.error(`resume of ${id} failed`, err))
  }
  for (const id of looks) {
    console.log(`resume: presentation render of ${id}`)
    await startLookRender(id).catch(err => console.error(`resume of the presentation of ${id} failed`, err))
  }
}
