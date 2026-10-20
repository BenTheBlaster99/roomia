import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { sceneDir } from './scene-store'

export interface ScenePhoto {
  file: string
  at: string
  view?: string
  time?: string
  lens?: string
  quality?: string
  fellBack?: boolean
}

/** Photo files are named by us; anything else is refused so a request can't reach outside photos/. */
export const PHOTO_FILE = /^[A-Za-z0-9_.-]+\.jpg$/

export const photosDir = (sceneId: string) => path.join(sceneDir(sceneId), 'photos')

/** The scene's finished photos, newest first, with the settings each was made with. */
export async function listPhotos(sceneId: string): Promise<ScenePhoto[]> {
  const files = (await readdir(photosDir(sceneId)).catch(() => [] as string[])).filter(f => PHOTO_FILE.test(f))
  const runs = new Map<string, Record<string, unknown>>()
  const raw = await readFile(path.join(sceneDir(sceneId), 'runs.jsonl'), 'utf8').catch(() => '')
  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const run = JSON.parse(line) as Record<string, unknown>
      if (run.ok && typeof run.photoFile === 'string') runs.set(path.basename(run.photoFile), run)
    } catch {
      // a damaged log line only loses that photo's details
    }
  }
  return files
    .map(file => {
      const run = runs.get(file)
      return {
        file,
        // The file name starts with the time it was saved: 2026-10-18T15-20-16-139Z-…
        at: String(run?.at ?? file.slice(0, 24)),
        view: run?.view as string | undefined,
        time: run?.time as string | undefined,
        lens: run?.lens as string | undefined,
        quality: run?.quality as string | undefined,
        fellBack: run?.fellBack === true,
      }
    })
    .sort((a, b) => b.file.localeCompare(a.file))
}
