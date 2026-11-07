// The AI look (8 Nov): the golden splat's shape kept, its colours refit to the capture's AI-corrected panoramas
// (rgb_ai, scripts/ai_gain_panos.py), smoothed, installed as tour/splat-ai.* (?sv=ai) beside golden and day.
// npx tsx --env-file=.env.local scripts/look-ai-build.mts <sceneId> [steps]
import { spawn } from 'node:child_process'
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { splatDir } from '../lib/splat-capture'
import { tourDir } from '../lib/scene-tour'
import { installSplat } from '../lib/splat-train'

const [sceneId, steps = '5000'] = process.argv.slice(2)
const PY = process.env.ROOMIA_SPLAT_PYTHON ?? '/media/jackhammer/DATA/Linux-Work/roomia-splat/venv/bin/python'
const base = splatDir(sceneId)
const capture = path.join(base, 'capture-look')
const golden = path.join(base, 'train-look-golden')
const out = path.join(base, 'train-look-ai')
const t0 = Date.now()
const at = () => `[${((Date.now() - t0) / 1000).toFixed(0)}s]`
const run = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const c = spawn(PY, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const take = (d: Buffer) => d.toString().split('\n').forEach(l => /range|step \d+ \/|trained|SMOOTH|Traceback|Error/.test(l) && console.log(at(), l.slice(0, 180)))
    c.stdout.on('data', take)
    c.stderr.on('data', take)
    c.on('close', code => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
  })
await rm(out, { recursive: true, force: true })
const gtr = JSON.parse(await readFile(path.join(golden, 'train.json'), 'utf8')) as { lo: number; hi: number }
await run([path.join('scripts', 'splat_train.py'), capture, out, JSON.stringify({ steps: Number(steps), sh: 1, res: 768, resStart: 512, resAt: 0.6, cap: 1800000, init: 1400000, reg: 0, fromPly: path.join(golden, 'splat-raw.ply'), freeze: true, rgbKey: 'rgb_ai', lrColour: 2.5e-3 })])
const tr = JSON.parse(await readFile(path.join(out, 'train.json'), 'utf8')) as { lo: number; hi: number }
const ply = path.join(out, 'splat.ply'), raw = path.join(out, 'splat-raw.ply')
await copyFile(ply, raw)
await run([path.join('scripts', 'splat_smooth.py'), raw, ply, JSON.stringify({ range: tr.hi - tr.lo })])
const info = (await installSplat(sceneId, { capture, out, sh: 1, name: 'splat-ai' })) as Record<string, unknown>
const tour = tourDir(sceneId)
// the golden model (no second 160 MB copy), the golden look's grade and exposure; the three looks know each other
const g = JSON.parse(await readFile(path.join(tour, 'splat-golden.json'), 'utf8')) as Record<string, unknown>
await rm(path.join(tour, 'splat-ai-model.glb'), { force: true })
Object.assign(info, { model: g.model, grade: g.grade, exposure: g.exposure, look: 'ai', looks: ['splat-golden', 'splat-day', 'splat-ai'] })
await writeFile(path.join(tour, 'splat-ai.json'), JSON.stringify(info, null, 1))
for (const n of ['golden', 'day']) {
  const p = path.join(tour, `splat-${n}.json`)
  const j = JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>
  j.looks = ['splat-golden', 'splat-day', 'splat-ai']
  await writeFile(p, JSON.stringify(j, null, 1))
}
console.log(at(), `installed splat-ai: ${info.splats} splats, ${((info.bytes as number) / 1e6).toFixed(1)} MB, light range ${gtr.lo.toFixed(1)}..${gtr.hi.toFixed(1)} -> ${tr.lo.toFixed(1)}..${tr.hi.toFixed(1)}`)
