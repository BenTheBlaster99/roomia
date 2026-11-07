// The walk with a look recipe (7 Nov, Phase 4): one capture lit by the recipe, each look (golden hour, day) made per
// panorama from the light groups; the splat's shape trained once on the first look, the others only refit its colours
// (same shape, a colour set per look). Installed as tour/splat-<look>.* with the look's grade.
//
// npx tsx --env-file=.env.local scripts/look-build.mts <sceneId> <recipe.json> ['<capture json>'] ['<train json>']
//   capture json may hold skipCapture: true (train and install from the last capture)
import { spawn } from 'node:child_process'
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captureSplat, splatDir } from '../lib/splat-capture'
import { tourDir } from '../lib/scene-tour'
import { installSplat } from '../lib/splat-train'

type Look = { gains: Record<string, number>; tints?: Record<string, number[]>; grade?: Record<string, unknown> }
const [sceneId, recipePath, capJson = '{}', trainJson = '{}'] = process.argv.slice(2)
const R = JSON.parse(await readFile(recipePath, 'utf8')) as { looks: Record<string, Look> }
const looks: Record<string, Record<string, number[]>> = {}
for (const [name, lk] of Object.entries(R.looks)) {
  looks[name] = {}
  for (const [g, gain] of Object.entries(lk.gains)) looks[name][g] = (lk.tints?.[g] ?? [1, 1, 1]).map(x => x * gain)
}
const names = Object.keys(looks)
const t0 = Date.now()
const at = () => `[${((Date.now() - t0) / 1000).toFixed(0)}s]`
const cap = JSON.parse(capJson) as Record<string, unknown>
const outName = (cap.outName as string) ?? 'capture-look'
if (!cap.skipCapture) {
  await captureSplat(
    sceneId,
    {
      mode: 'panos', maxPositions: 150, panoWidth: 1536, samples: 16, hover: 2, tests: 0, initPoints: 1500000, matte: true, exportDecimate: 0.5,
      outName, recipe: { file: path.resolve(recipePath), scriptsDir: path.resolve('scripts'), looks }, ...cap,
    },
    line => {
      if (/SPLAT_(TIME|INFO|STEP)|Error|Traceback/.test(line)) console.log(at(), line.slice(0, 220))
    },
  )
}
const tCap = (Date.now() - t0) / 1000
const capture = path.join(splatDir(sceneId), outName)
// the glow materials need a white colour in the walk's model (model colour x splat light)
await new Promise<void>(resolve => {
  const c = spawn('npx', ['tsx', path.join('scripts', 'look-model-glow.mts'), path.join(capture, 'model-packed.glb')], { stdio: 'ignore' })
  c.on('close', () => resolve())
})
const PY = process.env.ROOMIA_SPLAT_PYTHON ?? '/media/jackhammer/DATA/Linux-Work/roomia-splat/venv/bin/python'
const run = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(PY, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    if (child.pid) writeFile(`/proc/${child.pid}/oom_score_adj`, '900').catch(() => {})
    let buf = ''
    const take = (c: Buffer) => {
      buf += c.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (/range|step \d+ \/|trained|PSNR|SMOOTH|Traceback|Error/.test(line)) console.log(at(), line.slice(0, 200))
      }
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('close', c => (c === 0 ? resolve() : reject(new Error(`trainer exit ${c}`))))
  })
const base = { steps: 5000, sh: 1, res: 768, resStart: 512, resAt: 0.6, cap: 1800000, init: 1400000, reg: 0, refitSteps: 5000, lrColour: 2.5e-3, ...JSON.parse(trainJson) }
const trainDir = (n: string) => path.join(splatDir(sceneId), `train-look-${n}`)
const script = path.join(process.cwd(), 'scripts', 'splat_train.py')
// wall smoothing (scripts/splat_smooth.py): no view-dependent colour, light noise on flat surfaces blended away
const smooth = async (n: string) => {
  const ply = path.join(trainDir(n), 'splat.ply'), raw = path.join(trainDir(n), 'splat-raw.ply')
  await copyFile(ply, raw)
  const tr = JSON.parse(await readFile(path.join(trainDir(n), 'train.json'), 'utf8')) as { lo: number; hi: number }
  await run([path.join(process.cwd(), 'scripts', 'splat_smooth.py'), raw, ply, JSON.stringify({ range: tr.hi - tr.lo, ...(base.smooth ?? {}) })])
}
if (!base.skipTrain) {
  for (const n of base.only ?? names) await rm(trainDir(n), { recursive: true, force: true })
  if (!base.only || base.only.includes(names[0])) {
    await run([script, capture, trainDir(names[0]), JSON.stringify(base)])
    await smooth(names[0])
  }
}
const tShape = (Date.now() - t0) / 1000
if (!base.skipTrain)
  for (const n of (base.only ?? names).filter((x: string) => x !== names[0])) {
    // the shape is the first look's as trained (before smoothing), only the colours learn this look
    await run([script, capture, trainDir(n), JSON.stringify({ ...base, fromPly: path.join(trainDir(names[0]), 'splat-raw.ply'), freeze: true, rgbKey: `rgb_${n}`, steps: base.refitSteps })])
    await smooth(n)
  }
const tTrain = (Date.now() - t0) / 1000
const tour = tourDir(sceneId)
for (const n of names) {
  const name = `splat-${n.slice(0, 8)}`
  const info = (await installSplat(sceneId, { capture, out: trainDir(n), sh: 1, name })) as Record<string, unknown> & { probes?: { file: string; eye: number[] }[] }
  if (n !== names[0]) {
    // the same model as the first look (no second copy); this look's own reflection probes
    await rm(path.join(tour, `${name}-model.glb`), { force: true })
    info.model = `splat-${names[0].slice(0, 8)}-model.glb`
    const raw: string[] = []
    for (const [i] of (info.probes ?? []).entries()) {
      const f = `${name}-probe-${String(i).padStart(2, '0')}.hdr`
      await copyFile(path.join(capture, 'probes', `probe-${String(i).padStart(2, '0')}-${n}.hdr`), path.join(tour, f))
      raw.push(path.join(tour, f))
    }
    if (raw.length)
      await new Promise<void>(resolve => {
        const c = spawn(PY, [path.join(process.cwd(), 'scripts', 'splat_probes.py'), tour, ...raw], { stdio: 'ignore' })
        c.on('close', () => resolve())
      })
  }
  // the walk exposes like an eye (median), so the stills' absolute exposure becomes the look's own offset (walkExposure)
  const grade = { ...(R.looks[n].grade ?? {}), exposure: (R.looks[n] as { walkExposure?: number }).walkExposure ?? 0 }
  Object.assign(info, { look: n, grade, looks: names.map(x => `splat-${x.slice(0, 8)}`) })
  await writeFile(path.join(tour, `${name}.json`), JSON.stringify(info, null, 1))
  console.log(at(), `installed ${name}: ${info.splats} splats, ${((info.bytes as number) / 1e6).toFixed(1)} MB`)
}
const total = (Date.now() - t0) / 1000
console.log(at(), `TOTAL ${(total / 60).toFixed(1)} min (capture ${(tCap / 60).toFixed(1)}, shape ${((tShape - tCap) / 60).toFixed(1)}, other looks ${((tTrain - tShape) / 60).toFixed(1)}, install ${((total - tTrain) / 60).toFixed(1)})`)
