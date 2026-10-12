/**
 * Scene preparation: heavy scene in → source GLB + light viewport GLB out.
 * A .zip may hold a .dae plus its folder of texture images.
 *
 *   npm run prepare-scene -- <file.zip|file.dae|file.glb> [outDir]
 *
 * outDir defaults to "<file>-prepared" next to the input. The input is never touched.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { prepareScene } from '../lib/scene-prep'

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

  const { sourcePath, viewportPath, report } = await prepareScene(input, outDir, console.log)
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
