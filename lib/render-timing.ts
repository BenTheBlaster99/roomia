import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SCENES_DIR } from './scene-store'

/**
 * What a whole visit took on this PC (21 Nov), kept beside the projects folder so the points editor can say, before "Lancer", how
 * long the number of points the person chose will take: « 15 points · environ 35 min sur ce PC ». One record per finished visit:
 * the tour build (placement, plans) and the quality render with the AI finish, for that many points.
 */
export interface TimingRecord {
  at: string
  points: number
  buildSeconds: number
  lookSeconds: number
}

/** What the estimate is built from: the fixed part (opening the file, placing, plans, preparing the scene) and the part per point. */
export interface TimingModel {
  fixedSeconds: number
  perPointSeconds: number
  samples: number
}

const timingsPath = () => path.join(path.dirname(path.resolve(SCENES_DIR)), 'render-timings.json')
const KEEP = 20

export async function readTimings(): Promise<TimingRecord[]> {
  try {
    const raw = JSON.parse(await readFile(timingsPath(), 'utf8')) as { records?: unknown }
    return (Array.isArray(raw.records) ? raw.records : []).filter(
      (r): r is TimingRecord => !!r && typeof r === 'object' && Number.isFinite((r as TimingRecord).points) && Number.isFinite((r as TimingRecord).buildSeconds) && Number.isFinite((r as TimingRecord).lookSeconds),
    )
  } catch {
    return []
  }
}

/** A record is kept only for a whole visit made from scratch: a few points redone say nothing about the cost of a visit. */
export async function recordTiming(rec: Omit<TimingRecord, 'at'>): Promise<void> {
  if (!(rec.points >= 3) || !(rec.buildSeconds > 0) || !(rec.lookSeconds > 0)) return
  const records = [...(await readTimings()), { at: new Date().toISOString(), ...rec }].slice(-KEEP)
  await mkdir(path.dirname(timingsPath()), { recursive: true })
  await writeFile(timingsPath(), JSON.stringify({ records }, null, 1))
}

/**
 * The model of this PC: with visits of different sizes, the straight line through them (least squares, over the latest ones);
 * with one size only, 20 % of the visit is fixed and 80 % is per point. Null before any visit.
 */
export function timingModel(records: TimingRecord[]): TimingModel | null {
  const rs = records.slice(-8)
  if (!rs.length) return null
  const total = (r: TimingRecord) => r.buildSeconds + r.lookSeconds
  const sizes = new Set(rs.map(r => r.points))
  if (sizes.size >= 2) {
    const n = rs.length
    const mx = rs.reduce((s, r) => s + r.points, 0) / n
    const my = rs.reduce((s, r) => s + total(r), 0) / n
    const sxx = rs.reduce((s, r) => s + (r.points - mx) ** 2, 0)
    const sxy = rs.reduce((s, r) => s + (r.points - mx) * (total(r) - my), 0)
    const slope = sxx > 0 ? sxy / sxx : 0
    // a sensible line: at least 30 s a point, and a fixed part that is not negative
    if (slope >= 30 && my - slope * mx >= 0) return { fixedSeconds: my - slope * mx, perPointSeconds: slope, samples: n }
  }
  const last = rs[rs.length - 1]
  return { fixedSeconds: 0.2 * total(last), perPointSeconds: (0.8 * total(last)) / last.points, samples: rs.length }
}
