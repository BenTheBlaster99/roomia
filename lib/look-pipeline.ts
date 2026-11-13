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

function run(cmd: string, args: string[], onLine: (line: string) => void, opts: { cwd?: string; scene?: string } = {}): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? process.cwd(), env: { ...process.env, ROOMIA_BLENDER: BLENDER, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
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
const pipeline = async (id: string, args: string[], onLine: (l: string) => void) => run(await pythonExe(), [SCRIPT, ...args.slice(0, 1), id, ...args.slice(1)], onLine, { scene: id })

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
function watchRender(id: string, s: LookState, total: () => number): () => void {
  const timer = setInterval(async () => {
    try {
      const files = (await readdir(autoDir(id))).filter(f => /^t\d+-lin\.npy$/.test(f))
      let fresh = 0
      for (const f of files) if ((await stat(path.join(autoDir(id), f))).mtimeMs >= s.startedAt) fresh += 1
      const n = total()
      if (n) s.step = `Rendu des vues 360° : vue ${Math.min(fresh + 1, n)} sur ${n} (environ 1 à 2 minutes chacune)`
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

/** Free: analysis, the automatic recipe, every 360 point rendered and installed, then the suggestion of the points for the AI. */
export async function startLookRender(id: string): Promise<LookState> {
  if (lookBusy(id)) return active.get(id)!
  const meta = await readMeta(id)
  if (!meta || meta.status !== 'ready') throw new Error('Scène introuvable ou pas encore prête.')
  const s = fresh()
  Object.assign(s, { stage: 'running', job: 'render', step: 'Préparation de la scène…', startedAt: Date.now() })
  await save(id, s)
  const line = follow(id, s)
  stopped.delete(id)
  void (async () => {
    try {
      s.step = 'En attente du processeur graphique…'
      await save(id, s)
      let planned = 0
      const stopWatching = watchRender(id, s, () => planned)
      const code = await withBlenderSlot(async () => {
        if (stopped.has(id)) throw new Error('Arrêtée.')
        s.step = 'Préparation de la scène…'
        await save(id, s)
        await prepareLook(id, line)
        return pipeline(id, ['render'], l => {
          const m = /^points: (\d+) to render/.exec(l)
          if (m) planned = Number(m[1])
          line(l)
        })
      }).finally(stopWatching)
      if (stopped.has(id)) throw new Error('Arrêtée.')
      if (code !== 0) throw new Error('Le rendu de la présentation a échoué (voir le journal).')
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
      s.stage = 'ready'
      s.step = 'La visite est prête. Vous pouvez demander la finition IA.'
    } catch (err) {
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
async function makeLight(id: string, k: number, name: string, reference: Buffer | null, s: LookState): Promise<void> {
  const input = await loadSharp()(await blenderPano(id, k)).resize(PANO_LIGHT_SIZE.width, PANO_LIGHT_SIZE.height, { fit: 'fill' }).jpeg({ quality: 95 }).toBuffer()
  const key = sha(Buffer.concat([input, reference ?? Buffer.alloc(0), Buffer.from(PANO_LIGHT_VERSION + panoLightPrompt(Boolean(reference)))]))
  const dir = path.join(lookDir(id), 'sunburst')
  const out = path.join(dir, `pano-${k}-sunburst-2560.jpg`)
  const cache = path.join(dir, 'cache', `${key}.jpg`)
  await mkdir(path.dirname(cache), { recursive: true })
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
  s.ai!.paid += 1
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
  s.ai = { points, ring, images: q.images, cost: q.cost, done: 0, paid: 0, cached: 0 }
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
      const worker = async () => {
        while (next < points.length) {
          if (stopped.has(id)) throw new Error('Arrêtée.')
          const k = points[next++]
          await makeLight(id, k, names.get(k) ?? `Vue ${k}`, reference, s)
          made.push(k)
          s.ai!.done += 1
          s.step = `Images IA : ${s.ai!.done} sur ${s.ai!.images}`
          await save(id, s)
        }
      }
      await Promise.all([worker(), worker()])
      s.step = 'Lumière de l’IA sur les vues Blender…'
      await save(id, s)
      const finish = await run(await pythonExe(), [path.join(process.cwd(), 'scripts', 'pano_ai_light.py'), '--scene-dir', sceneDir(id), '--views', made.sort((a, b) => a - b).join(','), '--auto', 'auto', '--finish-only'], line, { scene: id })
      if (finish !== 0) throw new Error('L’application de la lumière a échoué (voir le journal).')
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
