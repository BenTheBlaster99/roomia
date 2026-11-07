// Look recipe, step 0 (7 Nov, Phase 1): prepares the scene exactly as the walk capture does and saves it as
// <scene>/look/prepared.blend, with the lights and glowing materials listed in scene-info.json.
//
// npx tsx scripts/look-prep.mts <sceneId>
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BLENDER } from '../lib/blender-render'
import { TOUR_SCRIPT, tourDir, tourSceneSpec } from '../lib/scene-tour'
import { readCameras, sceneDir } from '../lib/scene-store'

const sceneId = process.argv[2]
const out = path.join(sceneDir(sceneId), 'look')
const work = path.join(out, 'work')
await mkdir(work, { recursive: true })
const tour = JSON.parse(await readFile(path.join(tourDir(sceneId), 'tour.json'), 'utf8')) as {
  views?: { auto?: boolean; position?: number[]; target?: number[]; panoAi?: boolean; panoAiApproved?: boolean; index: number }[]
}
const auto = (tour.views ?? []).filter(v => v.auto && v.position && v.target).sort((a, b) => a.index - b.index)
const cameras = await readCameras(sceneId)
const scriptPath = path.join(work, 'tour.py')
const specPath = path.join(work, 'tour.json')
await writeFile(scriptPath, TOUR_SCRIPT)
await writeFile(
  specPath,
  JSON.stringify({
    ...(await tourSceneSpec(sceneId)),
    outDir: work,
    views: cameras.map(c => ({ name: c.name, position: c.position, target: c.target })),
    previousAuto: auto.map(v => ({ position: v.position, target: v.target, keep: Boolean(v.panoAi), approved: Boolean(v.panoAiApproved) })),
    previousSame: true,
    faceSize: 1024,
    planSize: 1800,
    viewTransform: 'AgX',
    autoViews: true,
    autoMax: 14,
    panoEngine: 'cycles',
    cyclesSamples: 128,
    cyclesNoise: 0.02,
    splatCapture: path.resolve('scripts/look_prep.py'),
    look: { outDir: out },
  }),
)
const t0 = Date.now()
const code = await new Promise<number>(resolve => {
  const child = spawn(BLENDER, ['--background', '--python', scriptPath, '--', specPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (child.pid) writeFile(`/proc/${child.pid}/oom_score_adj`, '900').catch(() => {})
  let buf = ''
  const take = (chunk: Buffer) => {
    buf += chunk.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (/^(LOOK_|TOUR_TIME|TOUR_INFO|SCENE_CACHE)|Error|Traceback/.test(line)) console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`, line)
    }
  }
  child.stdout.on('data', take)
  child.stderr.on('data', take)
  child.on('close', c => resolve(c ?? 1))
})
console.log('exit', code, `${((Date.now() - t0) / 1000).toFixed(0)}s`)
