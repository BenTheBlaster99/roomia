import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  originalPath,
  readMeta,
  sceneDir,
  writeMeta,
  type SceneMeta,
  type SceneReport,
} from './scene-store'

const CONCURRENCY = Number(process.env.SCENE_PREP_CONCURRENCY ?? 1)
const MAX_MEMORY_MB = Number(process.env.SCENE_PREP_MAX_MB ?? 8192)
const TIMEOUT_MS = Number(process.env.SCENE_PREP_TIMEOUT_MS ?? 15 * 60_000)
export const MAX_QUEUED = Number(process.env.SCENE_PREP_MAX_QUEUED ?? 20)

const queue: string[] = []
const active = new Set<string>()

export function queueLength(): number {
  return queue.length + active.size
}

/** True while this server process is still working on the scene (false after a restart). */
export function isWorking(id: string): boolean {
  return active.has(id) || queue.includes(id)
}

export function enqueueScene(id: string): void {
  queue.push(id)
  pump()
}

function pump(): void {
  while (active.size < CONCURRENCY && queue.length) {
    const id = queue.shift()!
    active.add(id)
    void run(id).finally(() => {
      active.delete(id)
      pump()
    })
  }
}

/**
 * The heavy lifting runs in its own process so a huge scene can run out of memory or crash
 * without taking the web server down.
 */
function runPrepProcess(meta: SceneMeta): Promise<void> {
  const root = process.cwd()
  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const script = path.join(root, 'scripts', 'prepare-scene.ts')
  const args = [
    `--max-old-space-size=${MAX_MEMORY_MB}`,
    tsxCli,
    script,
    originalPath(meta.id, meta.format),
    sceneDir(meta.id),
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.stdout.resume()
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Délai dépassé pendant la préparation'))
    }, TIMEOUT_MS)
    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      const lastLine = stderr.trim().split('\n').filter(Boolean).pop()
      reject(new Error(lastLine || `Préparation interrompue (code ${code})`))
    })
  })
}

async function run(id: string): Promise<void> {
  const meta = await readMeta(id)
  if (!meta) return
  const started = Date.now()
  try {
    await runPrepProcess(meta)
    const raw = JSON.parse(await readFile(path.join(sceneDir(id), 'report.json'), 'utf8')) as SceneReport
    const report: SceneReport = {
      inBytes: raw.inBytes,
      outBytes: raw.outBytes,
      trianglesIn: raw.trianglesIn,
      trianglesOut: raw.trianglesOut,
      totalSeconds: raw.totalSeconds,
      missingTextures: raw.missingTextures,
    }
    await writeMeta({ ...meta, status: 'ready', report })
    console.log(`scene ${id} ready in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Préparation impossible'
    console.error(`scene ${id} failed:`, message)
    await writeMeta({ ...meta, status: 'failed', error: message })
  }
}
