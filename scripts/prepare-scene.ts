/**
 * Scene preparation: heavy scene in → source GLB + light viewport GLB out.
 * A .zip may hold a .dae plus its folder of texture images.
 *
 *   npm run prepare-scene -- <file.zip|file.dae|file.glb> [outDir]
 *
 * outDir defaults to "<file>-prepared" next to the input. The input is never touched.
 */
import { execFile } from 'node:child_process'
import { open, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { prepareScene } from '../lib/scene-prep'

/** Above this a GLB's JSON is compacted first (normal files: 1–7 MB; SketchUp exports with a material per face: 360–600 MB). */
const COMPACT_JSON_BYTES = 50 * 1024 * 1024

/** The size of a GLB's JSON chunk, 0 for any other file. */
async function glbJsonBytes(file: string): Promise<number> {
  const handle = await open(file)
  try {
    const head = Buffer.alloc(20)
    await handle.read(head, 0, 20, 0)
    return head.toString('latin1', 0, 4) === 'glTF' && head.toString('latin1', 16, 20) === 'JSON' ? head.readUInt32LE(12) : 0
  } finally {
    await handle.close()
  }
}

/** Merges the duplicate materials and primitives in Python, which has no 512 MB string limit (see compact-glb.py). */
async function compacted(input: string, outDir: string): Promise<string | null> {
  if ((await glbJsonBytes(input)) < COMPACT_JSON_BYTES) return null
  const out = join(outDir, 'compact.glb')
  const { stdout } = await promisify(execFile)(process.env.ROOMIA_PYTHON ?? 'python3', [join(dirname(fileURLToPath(import.meta.url)), 'compact-glb.py'), input, out], { maxBuffer: 1 << 20 })
  console.log(stdout.trim())
  return stdout.includes('COMPACT_OK') ? out : null
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const k = (n: number) => `${(n / 1000).toFixed(0)}k`

async function main() {
  const input = process.argv[2]
  if (!input) throw new Error('usage: prepare-scene.ts <file.zip|file.dae|file.glb> [outDir]')
  const outDir =
    process.argv[3] ?? join(dirname(input), `${basename(input, extname(input))}-prepared`)
  await mkdir(outDir, { recursive: true })

  let peakRss = 0
  const timer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 200)

  const compact = await compacted(input, outDir)
  const { sourcePath, viewportPath, report } = await prepareScene(compact ?? input, outDir, console.log)
  if (compact) await rm(compact, { force: true })
  clearInterval(timer)
  await writeFile(
    join(outDir, 'report.json'),
    JSON.stringify({ ...report, peakMemoryBytes: peakRss }, null, 2),
  )

  console.log(`in   ${mb(report.inBytes)} | ${k(report.trianglesIn)} drawn tris`)
  console.log(`out  ${mb(report.outBytes)} | ${k(report.trianglesOut)} drawn tris`)
  console.log(`     saved views: ${report.cameraCount}`)
  const missing = report.missingTextures.length
  console.log(
    `     textures: ${report.embeddedTextures} embedded${missing ? `, ${missing} missing (e.g. ${report.missingTextures[0]})` : ''}`,
  )
  console.log(
    `     convert ${report.convertSeconds.toFixed(1)}s, total ${report.totalSeconds.toFixed(1)}s, peak memory ${mb(peakRss)}`,
  )
  const room = report.studio.room
  console.log(
    `     Studio check: ok — room ${room.width.toFixed(2)} × ${room.length.toFixed(2)} × ${room.height.toFixed(2)} m`,
  )
  console.log(`     source   -> ${sourcePath}`)
  console.log(`     viewport -> ${viewportPath}`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
