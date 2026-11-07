/**
 * Splat training (experiment, 6 Nov): the capture of lib/splat-capture.ts → a Gaussian splat (Brush, on the graphics
 * card through Vulkan) → SPZ for the walk (Spark's encoder, ~14x smaller than PLY) → tour/splat.spz + splat.json,
 * which the Visite libre draws instead of the model (app/studio/explore/[id]/splatLayer.ts).
 */
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { splatDir } from './splat-capture'
import { tourDir } from './scene-tour'

const BRUSH = process.env.ROOMIA_BRUSH ?? '/media/jackhammer/DATA/Linux-Work/roomia-splat/brush/brush-app-x86_64-unknown-linux-gnu/brush_app'
/** v2 trainer (scripts/splat_train.py): Python 3.10 with torch 2.4 cu124 and gsplat 1.5.3 */
const SPLAT_PYTHON = process.env.ROOMIA_SPLAT_PYTHON ?? '/media/jackhammer/DATA/Linux-Work/roomia-splat/venv/bin/python'

export interface SplatTrainOptions {
  steps?: number
  maxResolution?: number
  /** spherical harmonics: 3 keeps view-dependent light (reflections on the floor, glossy wood) */
  sh?: number
  maxSplats?: number
  /** every nth view kept out of training, to measure novel views */
  evalEvery?: number
  /** extra Brush flags */
  extra?: string[]
  /** v2 (scripts/splat_train.py, for 'panos' captures): options passed through as JSON */
  v2?: Record<string, unknown>
  /** the walk's file name (tour/<name>.spz, .json, -model.glb) */
  name?: string
}

export async function trainSplat(sceneId: string, options: SplatTrainOptions = {}, onLine: (line: string) => void = () => {}) {
  const base = splatDir(sceneId)
  const capture = path.join(base, 'capture')
  const out = path.join(base, 'train')
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  const steps = options.steps ?? 30000
  const v2 = Boolean(await stat(path.join(capture, 'panos.json')).catch(() => null))
  const args = v2 ? [path.join(process.cwd(), 'scripts', 'splat_train.py'), capture, out, JSON.stringify({ steps, sh: options.sh ?? 3, ...options.v2 })] : [
    capture,
    '--total-steps', String(steps),
    '--export-every', String(steps),
    '--export-path', out,
    '--export-name', 'splat.ply',
    '--max-resolution', String(options.maxResolution ?? 1024),
    '--sh-degree', String(options.sh ?? 3),
    '--max-splats', String(options.maxSplats ?? 3_000_000),
    ...(options.evalEvery ? ['--eval-split-every', String(options.evalEvery), '--eval-every', String(steps), '--eval-save-to-disk'] : []),
    ...(options.extra ?? []),
  ]
  const t0 = Date.now()
  const lines: string[] = []
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(v2 ? SPLAT_PYTHON : BRUSH, args, { cwd: out, stdio: ['ignore', 'pipe', 'pipe'] })
    const take = (b: Buffer) => {
      for (const line of b.toString().split('\n')) {
        if (!line.trim()) continue
        lines.push(line)
        onLine(line)
      }
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', reject)
    child.on('close', c => resolve(c ?? 1))
  })
  const trainSeconds = (Date.now() - t0) / 1000
  await writeFile(path.join(base, 'train-log.txt'), lines.join('\n') + '\n')
  const ply = path.join(out, 'splat.ply')
  if (code !== 0 || !(await stat(ply).catch(() => null))) throw new Error(`splat training failed (exit ${code}): ${lines.slice(-3).join(' | ')}`)

  return installSplat(sceneId, { capture, out, sh: options.sh ?? 3, trainSeconds, steps, name: options.name })
}

/**
 * A trained splat (<out>/splat.ply) into the walk: SPZ + splat.json in the tour folder (or `dest`), with the capture's
 * mirrors and the trainer's light curve.
 */
export async function installSplat(
  sceneId: string,
  o: { capture?: string; out?: string; sh?: number; trainSeconds?: number; steps?: number; dest?: string; name?: string } = {},
) {
  const base = splatDir(sceneId)
  const capture = o.capture ?? path.join(base, 'capture')
  const out = o.out ?? path.join(base, 'train')
  const v2 = Boolean(await stat(path.join(capture, 'panos.json')).catch(() => null))
  const ply = path.join(out, 'splat.ply')
  const { transcodeSpz } = await import('@sparkjsdev/spark')
  const bytes = new Uint8Array(await readFile(ply))
  const spz = await transcodeSpz({ inputs: [{ fileBytes: bytes, pathOrUrl: ply }], maxSh: o.sh ?? 3, version: 3 })
  const tour = o.dest ?? tourDir(sceneId)
  await mkdir(tour, { recursive: true })
  const name = o.name ?? 'splat'
  await writeFile(path.join(tour, `${name}.spz`), spz.fileBytes)
  // v3: the colour model from the capture's own scene
  const model = (await stat(path.join(capture, 'model-packed.glb')).catch(() => null)) ? `${name}-model.glb` : null
  if (model) await copyFile(path.join(capture, 'model-packed.glb'), path.join(tour, model))
  // investigation 3: reflection probes (small Cycles 360s) for the walk's own gloss
  const capMeta = v2 ? (JSON.parse(await readFile(path.join(capture, 'panos.json'), 'utf8')) as { probes?: { file: string; eye: number[] }[] }) : {}
  const probes: { file: string; eye: number[] }[] = []
  for (const [i, p] of (capMeta.probes ?? []).entries()) {
    const file = `${name}-probe-${String(i).padStart(2, '0')}.hdr`
    await copyFile(path.join(capture, p.file), path.join(tour, file))
    probes.push({ file, eye: p.eye })
  }
  // prefiltered for roughness (GGX, six levels in one image): the walk reflects these
  if (probes.length) {
    const ok = await new Promise<boolean>(resolve => {
      const child = spawn(SPLAT_PYTHON, [path.join(process.cwd(), 'scripts', 'splat_probes.py'), tour, ...probes.map(p => path.join(tour, p.file))], { stdio: 'ignore' })
      child.on('close', c => resolve(c === 0))
      child.on('error', () => resolve(false))
    })
    if (ok) for (const p of probes) p.file = p.file.replace(/\.hdr$/, '-ggx.hdr')
  }
  const enc = JSON.parse(await readFile(path.join(capture, 'encoding.json'), 'utf8')) as { lo: number; hi: number }
  const cap = v2
    ? (({ panos, seconds }) => ({ views: panos.length, seconds }))(JSON.parse(await readFile(path.join(capture, 'panos.json'), 'utf8')) as { panos: unknown[]; seconds: number })
    : (JSON.parse(await readFile(path.join(capture, 'capture.json'), 'utf8')) as { views: number; seconds: number })
  // the PLY header says how many splats
  const header = Buffer.from(bytes.subarray(0, 2000)).toString('latin1')
  const splats = Number(/element vertex (\d+)/.exec(header)?.[1] ?? 0)
  // v2: the mirrors, drawn by the walk with a live reflection (the capture saw through them)
  const see = v2 ? ((await readFile(path.join(capture, 'see-through.json'), 'utf8').then(JSON.parse).catch(() => null)) as { mirror?: number[][]; materials?: string[] } | null) : null
  // v3: the trainer's own curve (light only, to multiply by the model's colours)
  const trained = v2 ? ((await readFile(path.join(out, 'train.json'), 'utf8').then(JSON.parse).catch(() => null)) as { lo: number; hi: number; light?: boolean; albedoFloor?: number; trainSeconds?: number; steps?: number } | null) : null
  if (trained) Object.assign(enc, { lo: trained.lo, hi: trained.hi })
  const info = {
    file: `${name}.spz`,
    ...(model ? { model } : {}),
    ...(probes.length ? { probes } : {}),
    ...(see?.mirror?.length ? { mirrors: see.mirror } : {}),
    ...(see?.materials?.length ? { seeThrough: see.materials } : {}),
    ...(trained?.light ? { light: true, albedoFloor: trained.albedoFloor } : {}),
    lo: enc.lo,
    hi: enc.hi,
    splats,
    views: cap.views,
    captureSeconds: Math.round(cap.seconds),
    trainSeconds: Math.round(o.trainSeconds ?? trained?.trainSeconds ?? 0),
    steps: o.steps ?? trained?.steps,
    bytes: spz.fileBytes.length,
    builtAt: new Date().toISOString(),
  }
  // Blender's material values and the rooms (reflection zones) for the walk's gloss
  if (await stat(path.join(capture, 'materials.json')).catch(() => null)) {
    await copyFile(path.join(capture, 'materials.json'), path.join(tour, `${name}-materials.json`))
    Object.assign(info, { materials: `${name}-materials.json` })
  }
  await writeFile(path.join(tour, `${name}.json`), JSON.stringify(info, null, 1))
  const nav = path.join(tourDir(sceneId), 'nav.json')
  if (probes.length && (await stat(nav).catch(() => null))) {
    const ok = await new Promise<boolean>(resolve => {
      const child = spawn(SPLAT_PYTHON, [path.join(process.cwd(), 'scripts', 'splat_rooms.py'), nav, path.join(tour, `${name}.json`), path.join(tour, `${name}-rooms.json`), '60'], { stdio: 'ignore' })
      child.on('close', c => resolve(c === 0))
      child.on('error', () => resolve(false))
    })
    if (ok) {
      await nameRooms(path.join(tour, `${name}-rooms.json`), path.join(capture, 'model.glb')).catch(() => {})
      Object.assign(info, { rooms: `${name}-rooms.json` })
      await writeFile(path.join(tour, `${name}.json`), JSON.stringify(info, null, 1))
    }
  }
  return info
}

/**
 * Room names (7 Nov, step 8): what each room holds, by the model's object names (a bed makes a bedroom, a shower or a
 * toilet a bathroom...), written into rooms.json for the walk's room label.
 */
const ROOM_KINDS: [string, RegExp][] = [
  ['Salle de bain', /toilet|\bwc\b|shower|douche|bath|baignoire|vasque|lavabo|basin|bidet|sink/i],
  ['Cuisine', /kitchen|cuisine|oven|\bfour\b|fridge|frigo|refrigerat|\bhob\b|stove|cooktop|hotte|dishwasher/i],
  ['Chambre', /\bbed\b|\blit\b|mattress|matelas|headboard|nightstand|chevet|bedside/i],
  ['Séjour', /sofa|canap|couch|\btv\b|television|armchair|fauteuil|coffee.?table|table.?basse/i],
]
export async function nameRooms(roomsPath: string, modelPath: string) {
  const rooms = JSON.parse(await readFile(roomsPath, 'utf8')) as {
    x0: number; y0: number; step: number; nx: number; ny: number; labels: string; rooms: { id: number; area: number; name?: string; votes?: Record<string, number> }[]
  }
  const labels = Buffer.from(rooms.labels, 'base64')
  const { NodeIO } = await import('@gltf-transform/core')
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions')
  const { getBounds } = await import('@gltf-transform/core')
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(modelPath)
  const votes = new Map<number, Record<string, number>>()
  for (const node of doc.getRoot().listNodes()) {
    let label = ''
    for (let n: typeof node | null = node; n && !label; n = (n.getParentNode?.() ?? null) as typeof node | null) {
      const kind = ROOM_KINDS.find(([, re]) => re.test(n!.getName()))
      if (kind) label = kind[0]
    }
    if (!label || !node.getMesh()) continue
    const b = getBounds(node)
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2
    const i = Math.floor((cx - rooms.x0) / rooms.step), j = Math.floor((rooms.y0 + cz) / rooms.step)
    if (i < 0 || j < 0 || i >= rooms.nx || j >= rooms.ny) continue
    const r = labels[j * rooms.nx + i]
    if (!r) continue
    const v = votes.get(r) ?? {}
    v[label] = (v[label] ?? 0) + 1
    votes.set(r, v)
  }
  for (const room of rooms.rooms) {
    const v = votes.get(room.id) ?? {}
    // a bathroom's fittings outrank a sofa seen through its door; a kitchen beside a living room stays "Séjour"
    const order = ROOM_KINDS.map(([k]) => k)
    const best = Object.entries(v).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]
    room.name = best ? best[0] : room.area < 6 ? 'Couloir' : 'Pièce'
    room.votes = v
  }
  await writeFile(roomsPath, JSON.stringify(rooms))
  return rooms.rooms.map(r => `${r.name} ${r.area} m²`)
}
