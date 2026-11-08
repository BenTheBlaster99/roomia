import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BLENDER } from './blender-render'
import { panoFacePrompt } from './pano-ai'
import { generatePhotoreal, isGatewayDown } from './photoreal'
import { cloudMode, cloudPhoto } from './roomia-cloud'
import { readCameras, readMeta, sceneDir } from './scene-store'
import { TOUR_SCRIPT, tourDir, tourSceneSpec } from './scene-tour'

/**
 * Roomia look pipeline v1 as a managed job (8 Nov), the production engine behind the "Présentation" panel of the tour page.
 * The engine is scripts/look_pipeline.py (analysis, automatic recipe, Cycles 360s, exposure, AI tiles, fence); this file is its
 * controller: it runs the stages as separate processes (Blender never lives inside the server), keeps a state file per scene so
 * a restart can resume, shows what the paid step costs before anything is sent, and never pays twice for the same tile.
 *
 *   render      free: analysis, automatic recipe, every 360 point, installed in the tour
 *   suggest     free: the points that deserve the AI tiles
 *   quote       nothing sent: the images and the cost
 *   ai          paid, only with a confirmation naming the maximum cost: tiles, lay, fence, install
 *
 * Versions kept with each job: PIPELINE_VERSION (this engine), RECIPE_VERSION (the automatic recipe), TILE_VERSION (model + prompt
 * of the tile edit; part of the tile cache key).
 */
export const PIPELINE_VERSION = 'v1'
export const RECIPE_VERSION = 'auto-1'
export const TILE_VERSION = 'face-1'
export const DA_PER_IMAGE = 14

export interface LookSuggestion {
  index: number
  name: string
  score: number
}

export interface LookState {
  stage: 'idle' | 'running' | 'ready' | 'done' | 'error' | 'interrupted'
  job: 'render' | 'ai' | null
  step: string
  log: string[]
  startedAt: number
  updatedAt: number
  error?: string
  rendered?: string[]
  skipped?: Record<string, string>
  suggestions?: LookSuggestion[]
  ai?: { points: number[]; ring: number[]; images: number; cost: number; done: number; paid: number; cached: number }
  versions: { pipeline: string; recipe: string; tile: string }
}

const lookDir = (id: string) => path.join(sceneDir(id), 'look')
const autoDir = (id: string) => path.join(lookDir(id), 'auto')
const stateFile = (id: string) => path.join(autoDir(id), 'state.json')
const exists = (p: string) => access(p).then(() => true, () => false)
const active = new Map<string, LookState>()

const fresh = (): LookState => ({ stage: 'idle', job: null, step: '', log: [], startedAt: 0, updatedAt: Date.now(), versions: { pipeline: PIPELINE_VERSION, recipe: RECIPE_VERSION, tile: TILE_VERSION } })

async function save(id: string, s: LookState) {
  s.updatedAt = Date.now()
  active.set(id, s)
  await mkdir(autoDir(id), { recursive: true })
  await writeFile(stateFile(id), JSON.stringify(s))
}

/** The state of a scene's look job. A job recorded as running with no process behind it (the server restarted) is "interrupted". */
export async function getLookState(id: string): Promise<LookState> {
  const mem = active.get(id)
  if (mem) return mem
  try {
    const s = JSON.parse(await readFile(stateFile(id), 'utf8')) as LookState
    if (s.stage === 'running') s.stage = 'interrupted'
    return s
  } catch {
    return fresh()
  }
}

/** The Python that runs the pipeline's scripts: ROOMIA_LOOK_PYTHON, else the Python that ships with Blender, else python3. */
async function pythonExe(): Promise<string> {
  if (process.env.ROOMIA_LOOK_PYTHON) return process.env.ROOMIA_LOOK_PYTHON
  const dir = path.dirname(BLENDER)
  for (const p of [
    path.join(dir, '4.5', 'python', 'bin', 'python3.11'),
    path.join(dir, '4.5', 'python', 'bin', 'python.exe'),
    path.join(dir, '4.5', 'python', 'bin', 'python3'),
  ]) {
    if (await exists(p)) return p
  }
  return 'python3'
}

function run(cmd: string, args: string[], onLine: (line: string) => void, opts: { cwd?: string } = {}): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? process.cwd(), env: { ...process.env, ROOMIA_BLENDER: BLENDER }, stdio: ['ignore', 'pipe', 'pipe'] })
    if (child.pid && process.platform === 'linux') writeFile(`/proc/${child.pid}/oom_score_adj`, '900').catch(() => {})
    let buf = ''
    const take = (chunk: Buffer) => {
      buf += chunk.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', () => resolve(1))
    child.on('close', c => resolve(c ?? 1))
  })
}

const SCRIPT = path.join(process.cwd(), 'scripts', 'look_pipeline.py')
const pipeline = async (id: string, args: string[], onLine: (l: string) => void) => run(await pythonExe(), [SCRIPT, ...args.slice(0, 1), id, ...args.slice(1)], onLine)

/** The scene prepared for the look (lights, glass, mirrors, sky), saved once as look/prepared.blend. Same work as scripts/look-prep.mts. */
export async function prepareLook(id: string, onLine: (l: string) => void = () => {}): Promise<void> {
  const out = lookDir(id)
  if (await exists(path.join(out, 'prepared.blend'))) return
  const work = path.join(out, 'work')
  await mkdir(work, { recursive: true })
  const tour = JSON.parse(await readFile(path.join(tourDir(id), 'tour.json'), 'utf8')) as {
    views?: { auto?: boolean; position?: number[]; target?: number[]; panoAi?: boolean; panoAiApproved?: boolean; index: number }[]
  }
  const auto = (tour.views ?? []).filter(v => v.auto && v.position && v.target).sort((a, b) => a.index - b.index)
  const cameras = await readCameras(id)
  const scriptPath = path.join(work, 'tour.py')
  const specPath = path.join(work, 'tour.json')
  await writeFile(scriptPath, TOUR_SCRIPT)
  await writeFile(
    specPath,
    JSON.stringify({
      ...(await tourSceneSpec(id)),
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
  const code = await run(BLENDER, ['--background', '--python', scriptPath, '--', specPath], l => /^(LOOK_|TOUR_TIME|TOUR_INFO)|Error|Traceback/.test(l) && onLine(l))
  if (code !== 0 || !(await exists(path.join(out, 'prepared.blend')))) throw new Error('La scène n’a pas pu être préparée pour la présentation.')
}

const STEPS: [RegExp, string][] = [
  [/^analysis/, 'Analyse de la scène : soleil, lumières, caméras…'],
  [/^rendering (\d+)/, 'Rendu des vues 360° (environ 3 minutes chacune)…'],
  [/^points: (\d+) to render, (\d+) skipped/, 'Vues retenues…'],
  [/^EXPOSURE (\w+)/, 'Exposition et finition des vues…'],
  [/^INSTALLED/, 'Installation dans la visite…'],
  [/^AI tiles/, 'Préparation des vues pour l’IA…'],
  [/^AI_POINT/, 'Contrôle de la finition IA…'],
]

function follow(id: string, s: LookState) {
  return (line: string) => {
    if (!line.trim()) return
    s.log = [...s.log.slice(-39), line.slice(0, 220)]
    for (const [rx, label] of STEPS) if (rx.test(line)) s.step = label
    save(id, s).catch(() => {})
  }
}

export function lookBusy(id: string): boolean {
  return active.get(id)?.stage === 'running'
}

/** Free: analysis, the automatic recipe, every 360 point rendered and installed, then the suggestion of the points for the AI. */
export async function startLookRender(id: string): Promise<LookState> {
  if (lookBusy(id)) return active.get(id)!
  const meta = await readMeta(id)
  if (!meta || meta.status !== 'ready') throw new Error('Scène introuvable ou pas encore prête.')
  const s = fresh()
  Object.assign(s, { stage: 'running', job: 'render', step: 'Préparation de la scène…', startedAt: Date.now() })
  await save(id, s)
  const line = follow(id, s)
  void (async () => {
    try {
      await prepareLook(id, line)
      const code = await pipeline(id, ['render'], line)
      if (code !== 0) throw new Error('Le rendu de la présentation a échoué (voir le journal).')
      const report = JSON.parse(await readFile(path.join(autoDir(id), 'render-report.json'), 'utf8')) as { rendered: string[]; skipped: Record<string, string> }
      s.rendered = report.rendered
      s.skipped = report.skipped
      s.step = 'Choix des points pour la finition IA…'
      await save(id, s)
      let out = ''
      await pipeline(id, ['suggest', '--n', '4'], l => {
        if (l.startsWith('SUGGEST ')) out = l.slice(8)
      })
      s.suggestions = out ? (JSON.parse(out) as LookSuggestion[]) : []
      s.stage = 'ready'
      s.step = 'La visite est prête. Vous pouvez demander la finition IA.'
    } catch (err) {
      s.stage = 'error'
      s.error = err instanceof Error ? err.message : String(err)
    }
    await save(id, s)
  })()
  return s
}

/** Nothing is sent: the number of images and what they cost. A point is 6 tiles, +4 with the higher row. */
export function quoteAi(points: number[], ring: number[]) {
  const images = points.reduce((n, p) => n + 6 + (ring.includes(p) ? 4 : 0), 0)
  return { points, ring, images, cost: images * DA_PER_IMAGE }
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

/** One tile: from the cache if this exact picture was edited before (same render, same model and prompt), else paid. */
async function makeTile(id: string, dir: string, view: string, s: LookState): Promise<void> {
  const out = path.join(dir, `${view}-ai.jpg`)
  if (await exists(out)) return
  const input = await readFile(path.join(dir, `${view}-in.png`))
  const key = sha(Buffer.concat([input, Buffer.from(TILE_VERSION + panoFacePrompt())]))
  const cache = path.join(autoDir(id), 'tile-cache', `${key}.jpg`)
  if (await exists(cache)) {
    await copyFile(cache, out)
    s.ai!.cached += 1
    return
  }
  let buf: Buffer | null = null
  const cloud = cloudMode()
  for (let attempt = 0; !buf; attempt++) {
    const t = Date.now()
    try {
      if (cloud) {
        const r = await cloudPhoto(
          { jobId: key.slice(0, 48), project: path.basename(sceneDir(id)), view, lighting: { time: 'soiree', sun: true, interior: true }, capture: input, ask: true, kind: 'tile' },
          () => {},
        )
        buf = Buffer.from(r.base64, 'base64')
      } else {
        const r = await generatePhotoreal(input, panoFacePrompt(), { size: '1536x1536', maxInput: 2048, ask: true })
        buf = Buffer.from(r.base64, 'base64')
      }
    } catch (err) {
      // asked again only after a fast connection or server failure: not processed, so not charged
      if (attempt > 0 || !isGatewayDown(err) || Date.now() - t > 15_000) throw err
    }
  }
  s.ai!.paid += 1
  await mkdir(path.dirname(cache), { recursive: true })
  await writeFile(cache, buf)
  await writeFile(out, buf)
}

/**
 * Paid: the AI tiles of the chosen points. `maxCost` is what the person confirmed: a job whose cost is higher is refused.
 * Safe to call again after a crash: the tiles already made are kept (and the cache answers the same ones), so nothing is paid twice.
 */
export async function startLookAi(id: string, points: number[], ring: number[], maxCost: number): Promise<LookState> {
  if (lookBusy(id)) return active.get(id)!
  const q = quoteAi(points, ring)
  if (!points.length) throw new Error('Aucun point choisi.')
  if (!(maxCost >= q.cost)) throw new Error(`Cette finition coûte ${q.cost} DA : confirmez ce montant.`)
  const prev = await getLookState(id)
  const s = fresh()
  Object.assign(s, { stage: 'running', job: 'ai', step: 'Préparation des vues pour l’IA…', startedAt: Date.now(), rendered: prev.rendered, skipped: prev.skipped, suggestions: prev.suggestions })
  s.ai = { points, ring, images: q.images, cost: q.cost, done: 0, paid: 0, cached: 0 }
  await save(id, s)
  const line = follow(id, s)
  void (async () => {
    try {
      const args = (stage: string) => [stage, '--points', points.join(','), ...(ring.length ? ['--ring', ring.join(',')] : [])]
      if ((await pipeline(id, args('ai-prepare'), line)) !== 0) throw new Error('La préparation des vues IA a échoué (voir le journal).')
      const manifest = JSON.parse(await readFile(path.join(autoDir(id), 'ai-manifest.json'), 'utf8')) as { points: { dir: string; views: string[] }[] }
      s.step = 'Génération des images par l’IA…'
      await save(id, s)
      const todo = manifest.points.flatMap(p => p.views.map(v => ({ dir: p.dir, view: v })))
      let next = 0
      const worker = async () => {
        while (next < todo.length) {
          const t = todo[next++]
          await makeTile(id, t.dir, t.view, s)
          s.ai!.done += 1
          s.step = `Images IA : ${s.ai!.done} sur ${s.ai!.images}`
          await save(id, s)
        }
      }
      await Promise.all([worker(), worker()])
      s.step = 'Assemblage et contrôle…'
      await save(id, s)
      if ((await pipeline(id, args('ai-finish'), line)) !== 0) throw new Error('L’assemblage a échoué (voir le journal).')
      s.stage = 'done'
      s.step = 'Finition IA terminée.'
    } catch (err) {
      s.stage = 'error'
      s.error = err instanceof Error ? err.message : String(err)
    }
    await save(id, s)
  })()
  return s
}
