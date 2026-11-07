import { createReadStream, createWriteStream } from 'node:fs'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Zip, ZipPassThrough } from 'fflate'
import { enqueueScene } from './scene-jobs'
import { createScene, isSceneId, originalPath, readMeta, SCENES_DIR, writeMeta } from './scene-store'

/**
 * Roomia Desktop: a model sent by the SketchUp extension "Envoyer à Roomia" (sketchup/roomia_envoyer). The extension
 * exports into %LOCALAPPDATA%\Roomia\inbox\<folder>: the model (.dae with its texture folder, or .glb), the saved scenes
 * as views.json, a copy of the .skp (every texture of the model) and roomia-send.json. Here the folder becomes one
 * .zip — the import the Studio already knows (lib/scene-prep: dae + textures + skp + views JSON) — and a new project.
 */

export const INBOX_DIR = () => process.env.ROOMIA_INBOX_DIR ?? path.join(path.dirname(SCENES_DIR), 'inbox')
export const INBOX_NAME = /^[A-Za-z0-9_-]{1,64}$/

export interface SendInfo {
  title?: string
  /** SketchUp's model.guid: the same model sent again is a new version of the same project. */
  guid?: string
  skp?: string
  sketchup?: string
  views?: number
}

async function walk(dir: string, root = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, root)))
    else if (e.isFile()) out.push(path.relative(root, full))
  }
  return out
}

/** Every file of the folder into one stored (uncompressed) zip: quick, and the model's images are compressed already. */
async function zipFolder(dir: string, files: string[], target: string): Promise<number> {
  const out = createWriteStream(target)
  let failed: Error | null = null
  const done = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve)
    out.on('error', reject)
  })
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failed = err
      out.destroy(err)
      return
    }
    out.write(chunk)
    if (final) out.end()
  })
  for (const rel of files) {
    const entry = new ZipPassThrough(rel.split(path.sep).join('/'))
    zip.add(entry)
    for await (const piece of createReadStream(path.join(dir, rel))) {
      if (failed) throw failed
      entry.push(piece as Uint8Array)
    }
    entry.push(new Uint8Array(0), true)
  }
  zip.end()
  await done
  return (await stat(target)).size
}

/** The project this model was sent as before (newest), for "new version" on Mes projets. */
async function previousOf(guid: string): Promise<string | null> {
  let best: { id: string; at: number } | null = null
  for (const id of (await readdir(SCENES_DIR).catch(() => [] as string[])).filter(isSceneId)) {
    const meta = await readMeta(id).catch(() => null)
    if (meta?.source?.guid === guid && meta.status !== 'failed' && (!best || meta.createdAt > best.at)) best = { id, at: meta.createdAt }
  }
  return best?.id ?? null
}

export async function importInbox(name: string): Promise<{ id: string; previous: string | null }> {
  if (!INBOX_NAME.test(name)) throw new Error('Envoi introuvable.')
  const dir = path.join(INBOX_DIR(), name)
  const info = JSON.parse(await readFile(path.join(dir, 'roomia-send.json'), 'utf8')) as SendInfo
  const files = (await walk(dir)).filter(f => f !== 'roomia-send.json' && f !== 'ready')
  const models = files.filter(f => /\.(dae|glb)$/i.test(f))
  if (!models.length) throw new Error('L’envoi ne contient pas de modèle (.dae ou .glb).')
  const title = String(info.title ?? 'Projet SketchUp').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'Projet SketchUp'
  const guid = typeof info.guid === 'string' ? info.guid.slice(0, 64) : undefined
  const previous = guid ? await previousOf(guid) : null
  const meta = await createScene(`${title}.zip`, 'zip')
  try {
    const bytes = await zipFolder(dir, files, originalPath(meta.id, 'zip'))
    await writeMeta({ ...meta, bytes, source: { kind: 'sketchup', guid, at: Date.now(), ...(previous ? { versionOf: previous } : {}) } })
  } catch (err) {
    await writeMeta({ ...meta, status: 'failed', error: `Envoi illisible : ${err instanceof Error ? err.message : err}` })
    throw err
  }
  enqueueScene(meta.id)
  await rm(dir, { recursive: true, force: true })
  return { id: meta.id, previous }
}
