import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { killAllRoomiaBlenders, thermalState } from './blender-guard'
import { BLENDER, withBlenderSlot } from './blender-render'
import { loadSharp } from './load-sharp'
import { editPanoLight, PANO_LIGHT_SIZE, PANO_LIGHT_VERSION, panoLightInput, panoLightPrompt, panoLightReference } from './pano-light'
import { isGatewayDown } from './photoreal'
import { cloudMode, cloudPhoto } from './roomia-cloud'
import { recordTiming } from './render-timing'
import { readCameras, readMeta, sceneDir } from './scene-store'
import { killTree, TOUR_SCRIPT, tourDir, tourSceneSpec } from './scene-tour'

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
export const TILE_VERSION = PANO_LIGHT_VERSION
export const DA_PER_IMAGE = 16

export interface LookSuggestion {
  index: number
  name: string
  score: number
}

export interface LookState {
  stage: 'idle' | 'running' | 'ready' | 'done' | 'error' | 'interrupted'
  job: 'render' | 'ai' | null
  step: string
  /** the latest word from Blender (which view, which sample), so the person can see it moving */
  detail?: string
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

/** The processes of each scene's look job, and the scenes whose job the person stopped ("Arrêter"). */
const kids = new Map<string, Set<ChildProcess>>()
const stopped = new Set<string>()

function killJob(child: ChildProcess) {
  // Linux: the job runs in its own process group (Python and the Blender it started); Windows: taskkill /T
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch {
      // not a group leader: fall through
    }
  }
  killTree(child)
}

function run(cmd: string, args: string[], onLine: (line: string) => void, opts: { cwd?: string; scene?: string; env?: Record<string, string>; nice?: boolean } = {}): Promise<number> {
  return new Promise(resolve => {
    // `nice`: the light transfers that run beside the render (21 Nov) yield to Blender's own processor work (Linux; Windows has no nice)
    const [exe, argv] = opts.nice && process.platform === 'linux' ? ['nice', ['-n', '10', cmd, ...args]] : [cmd, args]
    const child = spawn(exe, argv, { cwd: opts.cwd ?? process.cwd(), env: { ...process.env, ROOMIA_BLENDER: BLENDER, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
    if (opts.scene) {
      const set = kids.get(opts.scene) ?? new Set<ChildProcess>()
      set.add(child)
      kids.set(opts.scene, set)
      child.on('close', () => set.delete(child))
    }
    if (child.pid && process.platform === 'linux') writeFile(`/proc/${child.pid}/oom_score_adj`, '900').catch(() => {})
    let buf = ''
    const take = (chunk: Buffer) => {
      buf += chunk.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i).replace(/\r$/, ''))
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
const pipeline = async (id: string, args: string[], onLine: (l: string) => void, env?: Record<string, string>) => run(await pythonExe(), [SCRIPT, ...args.slice(0, 1), id, ...args.slice(1)], onLine, { scene: id, env })

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
  const code = await run(BLENDER, ['--background', '--python', scriptPath, '--', specPath], l => /^(LOOK_|TOUR_TIME|TOUR_INFO)|Error|Traceback/.test(l) && onLine(l), { scene: id })
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
    s.log = [...s.log.slice(-39), line.replace(/\r$/, '').slice(0, 220)]
    for (const [rx, label] of STEPS) if (rx.test(line)) s.step = label
    save(id, s).catch(() => {})
  }
}

export function lookBusy(id: string): boolean {
  return active.get(id)?.stage === 'running'
}

/** "Arrêter": kills the job's processes now (Blender included). It does not restart by itself; the tiles already made are kept. */
export async function stopLook(id: string): Promise<LookState> {
  const s = active.get(id) ?? (await getLookState(id))
  if (s.stage !== 'running') return s
  stopped.add(id)
  for (const child of kids.get(id) ?? []) killJob(child)
  // a stopped free render starts clean; a stopped AI job keeps its tiles and offers to continue
  s.stage = s.job === 'ai' ? 'interrupted' : 'idle'
  s.step = 'Arrêtée. Vous pouvez la relancer.'
  s.detail = undefined
  await save(id, s)
  return s
}

/** While Blender renders the points: which view it is on, from the finished files and Blender's own progress line. */
function watchRender(id: string, s: LookState, total: () => number, note: () => string = () => ''): () => void {
  const timer = setInterval(async () => {
    try {
      const files = (await readdir(autoDir(id))).filter(f => /^t\d+-lin\.npy$/.test(f))
      let fresh = 0
      for (const f of files) if ((await stat(path.join(autoDir(id), f))).mtimeMs >= s.startedAt) fresh += 1
      const n = total()
      if (n) s.step = `Rendu des vues 360° : vue ${Math.min(fresh + 1, n)} sur ${n} (environ 1 à 2 minutes chacune)${note()}`
      const tail = (await readFile(path.join(autoDir(id), 'render.log'), 'utf8').catch(() => '')).split('\n').slice(-40).reverse().find(l => /Sample \d+\/\d+/.test(l))
      const m = tail && /Sample (\d+\/\d+)/.exec(tail)
      const th = thermalState()
      s.detail = th.userPaused
        ? 'En pause : le travail reprend quand vous le décidez'
        : th.paused
          ? `Pause : la carte graphique refroidit (${th.temp} °C)`
          : th.waiting
            ? `La carte graphique refroidit entre deux vues (${th.temp} °C) : la vue suivante démarre dans un instant`
            : m
              ? `Échantillon ${m[1]}`
              : undefined
      await save(id, s)
    } catch {
      // the next tick tries again
    }
  }, 5000)
  return () => clearInterval(timer)
}

/**
 * The time a whole visit took on this PC (21 Nov), kept for the estimate beside "Lancer" in the points editor (lib/render-timing.ts):
 * the tour build's own time plus everything since the quality render started. Only a visit made from scratch is kept.
 */
const visitStarted = new Map<string, { at: number; whole: boolean }>()
async function noteVisitTime(id: string, points: number): Promise<void> {
  const st = visitStarted.get(id)
  visitStarted.delete(id)
  // a start left over from an earlier visit (the AI finish never followed) is not this visit
  if (!st?.whole || Date.now() - st.at > 6 * 3600_000) return
  const tour = JSON.parse(await readFile(path.join(tourDir(id), 'tour.json'), 'utf8').catch(() => 'null')) as { timings?: Record<string, number> } | null
  await recordTiming({ points, buildSeconds: tour?.timings?.total ?? 0, lookSeconds: (Date.now() - st.at) / 1000 }).catch(() => undefined)
}

// ── 21 Nov: the AI finish streams while the render goes on (docs/PROMPT-speed-steps1-4.md, step 2) ──
//
// The renderer is the slow side (about 2.2 minutes a view); the AI image (about 75 s, the gateway) and the light transfer (a few seconds
// after step 3) do not need the GPU. As soon as the render has finished a view, its AI image and its transfer run beside the render of the
// next ones. The group step at the end of the render (one exposure for the visit, then install) is unchanged. A streamed view whose
// Blender picture ends up the very same bytes as the one it was streamed from keeps its finished picture ("promoted", scripts/pano_ai_light.py
// --promote); any other view (a view the group exposure moved) goes through the normal AI step afterwards, which makes the same request
// to the gateway (same picture, same cache key) or reuses the cached image, so nothing is paid twice and the credit ledger is untouched.

/** What the streamed AI finish did for a scene's current render. */
interface StreamResult {
  /** views whose finished 360 is already in the tour */
  promoted: Set<number>
  paid: number
  cached: number
  /** views with a finished picture waiting for the group step */
  transferred: Set<number>
  /** views whose AI image was made from the draft picture (kept: a view the group exposure moved reuses it, it is never paid twice) */
  made: Set<number>
  generated: number
}
const streamed = new Map<string, StreamResult>()
const streamDir = (id: string) => path.join(autoDir(id), 'stream')
const GEN_CONCURRENCY = Math.max(1, Number(process.env.ROOMIA_LOOK_GEN_WORKERS ?? 3))
const XFER_CONCURRENCY = Math.max(1, Number(process.env.ROOMIA_LOOK_XFER_WORKERS ?? 1))

function limiter(n: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>(resolve => waiting.push(resolve))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

/** The AI finish asked for with the points, when it covers every view this render makes (then nothing needs the images' scores first). */
async function streamPlan(id: string, only: number[] | null): Promise<{ wants: (k: number, name: string) => boolean; names: Map<number, string> } | null> {
  if (process.env.ROOMIA_LOOK_STREAM === '0') return null
  const plan = JSON.parse(await readFile(autoAiFile(id), 'utf8').catch(() => 'null')) as AutoAiPlan | null
  if (!plan || plan.max < 1) return null
  const tour = JSON.parse(await readFile(path.join(tourDir(id), 'tour.json'), 'utf8').catch(() => '{}')) as { views?: { index: number; name?: string; outside?: boolean; hidden?: boolean }[] }
  const candidates = (tour.views ?? []).filter(v => !v.outside && !v.hidden && (!only || only.includes(v.index)))
  // the render keeps the points the camera check accepts: at most these. Fewer images than `max` are asked for, so `max` is enough.
  if (!candidates.length || plan.max < candidates.length) return null
  const names = new Map(candidates.map(v => [v.index, v.name ?? `Vue ${v.index}`]))
  const wants = (k: number, name: string) => !plan.views || plan.views.some(v => v.index === k || v.name === name)
  return { wants, names }
}

/**
 * Called with each "VIEW_READY <index>" line of the render. Never throws: a view that fails here is left to the normal AI step after
 * the render, which reports the error as it always did.
 */
function startStreamer(id: string, plan: { wants: (k: number, name: string) => boolean; names: Map<number, string> }, line: (l: string) => void) {
  const res: StreamResult = { promoted: new Set(), paid: 0, cached: 0, transferred: new Set(), made: new Set(), generated: 0 }
  streamed.set(id, res)
  const gen = limiter(GEN_CONCURRENCY)
  const xfer = limiter(XFER_CONCURRENCY)
  const reference = houseReference(id).catch(() => null)
  const work: Promise<void>[] = []
  const handle = async (k: number, name: string) => {
    if (stopped.has(id)) return
    const ref = await reference
    await gen(() => makeLight(id, k, name, ref, res, path.join(streamDir(id), `pano-${k}.jpg`)))
    res.generated += 1
    res.made.add(k)
    if (stopped.has(id)) return
    const code = await xfer(async () =>
      stopped.has(id)
        ? 1
        : run(await pythonExe(), [path.join(process.cwd(), 'scripts', 'pano_ai_light.py'), '--scene-dir', sceneDir(id), '--views', String(k), '--auto', 'auto', '--finish-only', '--transfer', '--stream'], line, { scene: id, nice: true }),
    )
    if (code === 0 && (await exists(path.join(streamDir(id), `final-${k}.jpg`)))) res.transferred.add(k)
  }
  return {
    ready(k: number) {
      const name = plan.names.get(k)
      if (name === undefined || !plan.wants(k, name)) return
      work.push(handle(k, name).catch(err => console.error('streamed AI finish of view', k, 'left to the normal step:', err instanceof Error ? err.message : err)))
    },
    /** After the render: waits for the views still in the queues, then keeps the finished pictures that are still right. */
    async finish() {
      let n = -1
      while (n !== work.length) {
        n = work.length
        await Promise.all(work)
      }
      if (stopped.has(id) || !res.transferred.size) return
      await run(await pythonExe(), [path.join(process.cwd(), 'scripts', 'pano_ai_light.py'), '--scene-dir', sceneDir(id), '--views', [...res.transferred].sort((a, b) => a - b).join(','), '--auto', 'auto', '--promote'], l => {
        const m = /^PROMOTED (\d+)/.exec(l)
        if (m) res.promoted.add(Number(m[1]))
        line(l)
      }, { scene: id })
    },
    note: () => (res.generated ? ` · IA : ${res.generated} images faites` : ''),
  }
}

/** Free: analysis, the automatic recipe, every 360 point rendered and installed, then the suggestion of the points for the AI. */
export async function startLookRender(id: string, only?: number[]): Promise<LookState> {
  if (lookBusy(id)) return active.get(id)!
  const meta = await readMeta(id)
  if (!meta || meta.status !== 'ready') throw new Error('Scène introuvable ou pas encore prête.')
  // 18 Nov: only the points made again (the others kept their finished 360°); kept on disk so a resume does the same
  // (an empty list: every point, a whole new visit)
  if (only?.length) {
    await mkdir(lookDir(id), { recursive: true })
    await writeFile(onlyFile(id), JSON.stringify(only))
  } else if (only) await rm(onlyFile(id), { force: true })
  const points = only?.length ? only : only ? null : (JSON.parse(await readFile(onlyFile(id), 'utf8').catch(() => 'null')) as number[] | null)
  // 21 Nov: when the AI finish was asked for with the points, it runs per view beside the render (see "streams while the render goes on")
  const plan = await streamPlan(id, points ?? null).catch(() => null)
  const s = fresh()
  Object.assign(s, { stage: 'running', job: 'render', step: 'Préparation de la scène…', startedAt: Date.now() })
  visitStarted.set(id, { at: s.startedAt, whole: !points?.length })
  await save(id, s)
  const line = follow(id, s)
  stopped.delete(id)
  void (async () => {
    try {
      s.step = 'En attente du processeur graphique…'
      await save(id, s)
      let planned = 0
      // a render starts clean: nothing streamed by an earlier one is kept
      streamed.delete(id)
      await rm(streamDir(id), { recursive: true, force: true }).catch(() => undefined)
      const streamer = plan ? startStreamer(id, plan, line) : null
      const stopWatching = watchRender(id, s, () => planned, () => streamer?.note() ?? '')
      const code = await withBlenderSlot(async () => {
        if (stopped.has(id)) throw new Error('Arrêtée.')
        s.step = 'Préparation de la scène…'
        await save(id, s)
        await prepareLook(id, line)
        return pipeline(
          id,
          ['render', ...(points?.length ? ['--points', points.join(',')] : [])],
          l => {
            const m = /^points: (\d+) to render/.exec(l)
            if (m) planned = Number(m[1])
            const v = /^VIEW_READY (\d+)/.exec(l)
            if (v) streamer?.ready(Number(v[1]))
            line(l)
          },
          streamer ? { ROOMIA_LOOK_STREAM: '1' } : undefined,
        )
      }).finally(stopWatching)
      if (stopped.has(id)) throw new Error('Arrêtée.')
      if (code !== 0) throw new Error('Le rendu de la présentation a échoué (voir le journal).')
      if (streamer) {
        s.step = 'Finition IA des dernières vues…'
        await save(id, s)
        await streamer.finish()
        if (stopped.has(id)) throw new Error('Arrêtée.')
      }
      const report = JSON.parse(await readFile(path.join(autoDir(id), 'render-report.json'), 'utf8')) as { rendered: string[]; skipped: Record<string, string> }
      s.rendered = report.rendered
      s.skipped = report.skipped
      s.step = 'Choix des points pour la finition IA…'
      await save(id, s)
      let out = ''
      await pipeline(id, ['suggest', '--all'], l => {
        if (l.startsWith('SUGGEST ')) out = l.slice(8)
      })
      s.suggestions = out ? (JSON.parse(out) as LookSuggestion[]) : []
      await rm(onlyFile(id), { force: true }).catch(() => undefined)
      s.stage = 'ready'
      s.step = 'La visite est prête. Vous pouvez demander la finition IA.'
      // no AI finish follows (none was asked for): the visit is complete now
      if (!(await autoAiPlanned(id))) await noteVisitTime(id, report.rendered.length)
    } catch (err) {
      streamed.delete(id)
      visitStarted.delete(id)
      if (stopped.delete(id)) {
        s.stage = 'idle'
        s.step = 'Arrêtée. Vous pouvez la relancer.'
        s.detail = undefined
      } else {
        s.stage = 'error'
        s.error = err instanceof Error ? err.message : String(err)
      }
    }
    await save(id, s)
    // the person asked for the AI finish when starting the 360 (planAutoAi): it follows now, without a click
    if (s.stage === 'ready') await runAutoAi(id, s.suggestions ?? []).catch(err => console.error('automatic AI finish did not start', id, err))
  })()
  return s
}

// ── One click (13 Nov, the user's ask): "Préparer la visite 360°" with the AI finish chosen goes Blender → AI light by itself ──

const autoAiFile = (id: string) => path.join(lookDir(id), 'auto-ai.json')
const onlyFile = (id: string) => path.join(lookDir(id), 'render-only.json')

/** The AI finish asked for with the points (planAutoAi), kept to the points made again (18 Nov: the others are finished). */
export async function restrictAutoAi(id: string, views: { index: number; name: string }[]): Promise<void> {
  const plan = JSON.parse(await readFile(autoAiFile(id), 'utf8').catch(() => 'null')) as AutoAiPlan | null
  if (!plan) return
  await writeFile(autoAiFile(id), JSON.stringify({ ...plan, views }))
}

/** The views the AI finish will take when the Présentation is ready (by name first: the build may renumber them), at most `max`. */
export interface AutoAiPlan {
  views?: { index: number; name: string }[]
  max: number
}

/** Remembers the AI finish asked for with the 360 build; it starts when the golden-hour Présentation is ready. */
export async function planAutoAi(id: string, plan: AutoAiPlan | null): Promise<void> {
  if (!plan || plan.max < 1) {
    await rm(autoAiFile(id), { force: true })
    return
  }
  await mkdir(lookDir(id), { recursive: true })
  await writeFile(autoAiFile(id), JSON.stringify({ ...plan, at: Date.now() }))
}

/** Is an AI finish waiting for the Présentation? (the tour page says it will follow by itself) */
export async function autoAiPlanned(id: string): Promise<number> {
  const plan = JSON.parse(await readFile(autoAiFile(id), 'utf8').catch(() => 'null')) as AutoAiPlan | null
  return plan ? Math.min(plan.max, plan.views?.length ?? plan.max) : 0
}

/** Once only: the planned views among those the Présentation rendered, then the paid AI light (startLookAi). */
async function runAutoAi(id: string, suggestions: LookSuggestion[]): Promise<void> {
  const plan = JSON.parse(await readFile(autoAiFile(id), 'utf8').catch(() => 'null')) as AutoAiPlan | null
  if (!plan) return
  await rm(autoAiFile(id), { force: true })
  const wanted = plan.views
    ? plan.views.map(v => suggestions.find(x => x.name === v.name)?.index ?? (suggestions.some(x => x.index === v.index) ? v.index : null))
    : suggestions.map(x => x.index)
  const points = [...new Set(wanted.filter((k): k is number => k !== null))].slice(0, Math.max(0, plan.max))
  if (!points.length) return
  await startLookAi(id, points, [], points.length * DA_PER_IMAGE)
}

/** Nothing is sent: the number of images and what they cost. "Blender + AI light": one AI image per view (1 credit). */
export function quoteAi(points: number[], ring: number[]) {
  const images = points.length
  return { points, ring, images, cost: images * DA_PER_IMAGE }
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

/** The project's AI photo used as house style for every view (12 Nov, F5: a bedroom photo for the bedrooms made the AI redesign
 * the beds; the living-room photo for all views worked everywhere): the séjour if there is one, else the latest photo. */
async function houseReference(id: string): Promise<Buffer | null> {
  const dir = path.join(sceneDir(id), 'photos')
  const files = (await readdir(dir).catch(() => [] as string[])).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()
  if (!files.length) return null
  const pick = files.find(f => /s[eé]jour|salon|living|salle_a_manger|sejour/i.test(f)) ?? files[files.length - 1]
  const buf = await readFile(path.join(dir, pick)).catch(() => null)
  return buf ? loadSharp()(buf).resize(1536, 1536, { fit: 'inside' }).jpeg({ quality: 92 }).toBuffer() : null
}

/** The Blender 360 of a view: pano-k.jpg, unless it is already our AI-light result (then the copy kept before it). */
async function blenderPano(id: string, k: number): Promise<Buffer> {
  const t = tourDir(id)
  const cur = await readFile(path.join(t, `pano-${k}.jpg`))
  const light = await readFile(path.join(t, `pano-${k}-ai-light.jpg`)).catch(() => null)
  if (light && light.equals(cur)) return readFile(path.join(t, `pano-${k}-before-sunburst.jpg`)).catch(() => cur)
  return cur
}

/** One view's AI image: from the cache if this exact panorama and reference were edited before, else paid (1 credit). */
async function makeLight(id: string, k: number, name: string, reference: Buffer | null, counts: { paid: number; cached: number }, inputFile?: string): Promise<void> {
  // `inputFile`: the view's picture while the render is still going (streamed AI, 21 Nov): the same picture the normal step would send
  const input = await loadSharp()(inputFile ? await readFile(inputFile) : await blenderPano(id, k)).resize(PANO_LIGHT_SIZE.width, PANO_LIGHT_SIZE.height, { fit: 'fill' }).jpeg({ quality: 95 }).toBuffer()
  const key = sha(Buffer.concat([input, reference ?? Buffer.alloc(0), Buffer.from(PANO_LIGHT_VERSION + panoLightPrompt(Boolean(reference)))]))
  const dir = path.join(lookDir(id), 'sunburst')
  const out = path.join(dir, `pano-${k}-sunburst-2560.jpg`)
  const cache = path.join(dir, 'cache', `${key}.jpg`)
  await mkdir(path.dirname(cache), { recursive: true })
  // Benchmarks and tests only, never set by the app (ROOMIA_FAKE_GATEWAY_DELAY=<seconds>): waits as long as the gateway would, then uses
  // the cached image or the one already on disk. It never calls the gateway and never pays.
  const fakeDelay = process.env.ROOMIA_FAKE_GATEWAY_DELAY
  if (fakeDelay !== undefined) {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(fakeDelay) || 0) * 1000))
    if (await exists(cache)) await copyFile(cache, out)
    else if (!(await exists(out))) throw new Error(`fake gateway: no image on disk for view ${k}`)
    counts.cached += 1
    return
  }
  if (await exists(cache)) {
    await copyFile(cache, out)
    counts.cached += 1
    return
  }
  let buf: Buffer | null = null
  const cloud = cloudMode()
  for (let attempt = 0; !buf; attempt++) {
    const t = Date.now()
    try {
      if (cloud) {
        const r = await cloudPhoto(
          { jobId: key.slice(0, 48), project: path.basename(sceneDir(id)), view: name, lighting: { time: 'apres-midi', sun: true, interior: true }, capture: input, ask: false, kind: 'pano-light', reference },
          () => {},
        )
        buf = Buffer.from(r.base64, 'base64')
      } else {
        buf = await editPanoLight(await panoLightInput(input), reference ? await panoLightReference(reference) : null)
      }
    } catch (err) {
      // asked again only after a fast connection or server failure: not processed, so not charged
      if (attempt > 0 || !isGatewayDown(err) || Date.now() - t > 15_000) throw err
    }
  }
  counts.paid += 1
  await writeFile(cache, buf)
  await writeFile(out, buf)
}

/**
 * Paid: "Blender + AI light" on the chosen views (12 Nov): one AI image per view (lib/pano-light.ts, through Roomia's server on the
 * desktop), then scripts/pano_ai_light.py --finish-only puts its light on Blender's own pixels and installs the view. `maxCost` is
 * what the person confirmed: a job whose cost is higher is refused. Safe to call again after a crash: the images already made are in
 * the cache (same panorama + reference = same key, and the server answers a delivered job id again for free), so nothing is paid twice.
 */
export async function startLookAi(id: string, points: number[], ring: number[], maxCost: number): Promise<LookState> {
  if (lookBusy(id)) return active.get(id)!
  const q = quoteAi(points, ring)
  if (!points.length) throw new Error('Aucun point choisi.')
  if (!(maxCost >= q.cost)) throw new Error(`Cette finition coûte ${q.cost} DA : confirmez ce montant.`)
  const prev = await getLookState(id)
  const s = fresh()
  Object.assign(s, { stage: 'running', job: 'ai', step: 'Préparation des vues pour l’IA…', startedAt: Date.now(), rendered: prev.rendered, skipped: prev.skipped, suggestions: prev.suggestions })
  // 21 Nov: the views the streamed AI finish already finished during the render are not made again
  const early = streamed.get(id)
  const todo = points.filter(k => !early?.promoted.has(k))
  // a view the group exposure moved (a very dark or very bright room, more than 3 stops from the visit's median) keeps the AI image made
  // from its draft: asking again would be a second paid image for the same view. Only the cheap transfer is redone, on the final picture.
  // The AI image does not depend on the exposure of the picture it is given (measured on the F5's 15 real AI images: the input medians
  // spread over 1.77 stops, the AI medians over 0.63, slope 0.02, correlation 0.04; the darkest input, 0.08, gave an ordinary 0.45).
  const reused = todo.filter(k => early?.made.has(k) && !early.promoted.has(k))
  s.ai = { points, ring, images: q.images, cost: q.cost, done: points.length - todo.length + reused.length, paid: early?.paid ?? 0, cached: early?.cached ?? 0 }
  await save(id, s)
  const line = follow(id, s)
  stopped.delete(id)
  void (async () => {
    try {
      const names = new Map((prev.suggestions ?? []).map(p => [p.index, p.name]))
      const reference = await houseReference(id)
      s.step = 'Génération des images par l’IA…'
      await save(id, s)
      const made: number[] = []
      let next = 0
      const toMake = todo.filter(k => !reused.includes(k))
      const worker = async () => {
        while (next < toMake.length) {
          if (stopped.has(id)) throw new Error('Arrêtée.')
          const k = toMake[next++]
          await makeLight(id, k, names.get(k) ?? `Vue ${k}`, reference, s.ai!)
          made.push(k)
          s.ai!.done += 1
          s.step = `Images IA : ${s.ai!.done} sur ${s.ai!.images}`
          await save(id, s)
        }
      }
      await Promise.all([worker(), worker()])
      made.push(...reused)
      if (made.length) {
        s.step = 'Lumière de l’IA sur les vues Blender…'
        await save(id, s)
        const finish = await run(await pythonExe(), [path.join(process.cwd(), 'scripts', 'pano_ai_light.py'), '--scene-dir', sceneDir(id), '--views', made.sort((a, b) => a - b).join(','), '--auto', 'auto', '--finish-only', '--transfer'], line, { scene: id })
        if (finish !== 0) throw new Error('L’application de la lumière a échoué (voir le journal).')
      }
      streamed.delete(id)
      await noteVisitTime(id, points.length)
      s.stage = 'done'
      s.step = 'Finition IA terminée.'
    } catch (err) {
      if (stopped.delete(id)) {
        s.stage = 'interrupted'
        s.step = 'Arrêtée. Les images déjà faites sont gardées.'
      } else {
        s.stage = 'error'
        s.error = err instanceof Error ? err.message : String(err)
      }
    }
    await save(id, s)
  })()
  return s
}
