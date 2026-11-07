// The AI step of the gateway-tile 360 (8 Nov): every view cut by pano_tiles.py goes to the gateway as an ordinary photo.
// Nothing is retried behind the scenes (ask mode): one call, one image, 14 DA each.
// npx tsx --env-file=.env.local scripts/pano-tiles-gateway.mts <tilesDir> [size=1536x1536] [views v0,v1,...]
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { generatePhotoreal } from '../lib/photoreal'
import { panoFacePrompt } from '../lib/pano-ai'

const [dir, size = '1536x1536', only] = process.argv.slice(2)
const meta = JSON.parse(await readFile(path.join(dir, 'views.json'), 'utf8')) as { views: { name: string }[] }
const want = only ? new Set(only.split(',')) : null
const prompt = panoFacePrompt()
const report: Record<string, unknown>[] = []
let next = 0
const todo = meta.views.filter(v => !want || want.has(v.name))
async function worker() {
  while (next < todo.length) {
    const v = todo[next++]
    const input = await readFile(path.join(dir, `${v.name}-in.png`))
    const t0 = Date.now()
    try {
      const r = await generatePhotoreal(input, prompt, { size, maxInput: 2048, ask: true })
      const buf = Buffer.from(r.base64, 'base64')
      await writeFile(path.join(dir, `${v.name}-ai.jpg`), buf)
      const e = { view: v.name, seconds: Math.round((Date.now() - t0) / 100) / 10, quality: r.quality, fellBack: r.fellBack, fidelity: r.fidelity, size: r.size }
      report.push(e); console.log('TILE', JSON.stringify(e))
    } catch (err) {
      const e = { view: v.name, error: String((err as Error).message).slice(0, 200) }
      report.push(e); console.log('TILE', JSON.stringify(e))
    }
  }
}
await Promise.all([worker(), worker()])
await writeFile(path.join(dir, 'gateway-report.json'), JSON.stringify(report, null, 1))
console.log('TILES_GATEWAY_DONE', report.filter(r => !('error' in r)).length, 'images')
