// The AI step of the plan fill (12 Nov): every crop made by plan_fill_prepare.py goes to the gateway as a photo, one call, one image,
// 14 DA each, nothing retried behind the scenes. Only the magenta spots are asked for; plan_fill_finish.py takes nothing else back.
// npx tsx --env-file=.env.local scripts/plan-fill-gateway.mts <fillDir> [views f0,f2,...]
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { generatePhotoreal } from '../lib/photoreal'

const [dir, only] = process.argv.slice(2)
const meta = JSON.parse(await readFile(path.join(dir, 'views.json'), 'utf8')) as { views: { name: string }[] }
const want = only ? new Set(only.split(',')) : null
const prompt =
  'This is a furnished top-down architectural floor plan render of an apartment, seen straight from above. ' +
  'Some parts of the floor and furniture are painted flat magenta (#FF00FF): the capture is missing there. ' +
  'Repaint ONLY the magenta areas so they continue what surrounds them: the same floor tiles and marble pattern with the same herringbone layout, ' +
  'the same rug, the same sofa or furniture seen from above, the same colours, the same soft light, at the same scale. ' +
  'Where the magenta touches a wall or the white background, stop exactly at that edge. ' +
  'Do not change anything that is not magenta. Do not add text, labels, people, shadows, or new objects that are not clearly implied by the surroundings. No magenta may remain.'
const report: Record<string, unknown>[] = []
for (const v of meta.views.filter(v => !want || want.has(v.name))) {
  const input = await readFile(path.join(dir, `${v.name}-in.png`))
  const t0 = Date.now()
  try {
    const r = await generatePhotoreal(input, prompt, { size: '1536x1024', maxInput: 2048, ask: true })
    await writeFile(path.join(dir, `${v.name}-ai.jpg`), Buffer.from(r.base64, 'base64'))
    const e = { view: v.name, seconds: Math.round((Date.now() - t0) / 100) / 10, quality: r.quality, fellBack: r.fellBack, fidelity: r.fidelity, size: r.size }
    report.push(e); console.log('FILL', JSON.stringify(e))
  } catch (err) {
    const e = { view: v.name, error: String((err as Error).message).slice(0, 200) }
    report.push(e); console.log('FILL', JSON.stringify(e))
  }
}
await writeFile(path.join(dir, 'gateway-report.json'), JSON.stringify(report, null, 1))
console.log('FILL_GATEWAY_DONE', report.filter(r => !('error' in r)).length, 'images')
