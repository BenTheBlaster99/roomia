/**
 * Summary of every photo render logged by the scene-photo route (.scenes/<id>/runs.jsonl):
 * how many ran, how many failed and why, and median / slowest times.
 *
 *   npm run runs-report
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

interface Run {
  at: string
  view: string
  time: string
  sun: boolean
  quality?: string
  captureSeconds?: number
  photoSeconds?: number
  totalSeconds?: number
  ok: boolean
  error?: string
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function main() {
  const root = process.env.SCENES_DIR ?? path.join(process.cwd(), '.scenes')
  const runs: Run[] = []
  for (const id of await readdir(root).catch(() => [])) {
    const text = await readFile(path.join(root, id, 'runs.jsonl'), 'utf8').catch(() => '')
    for (const line of text.split('\n').filter(Boolean)) runs.push(JSON.parse(line) as Run)
  }
  if (!runs.length) return console.log('No runs logged yet.')

  runs.sort((a, b) => a.at.localeCompare(b.at))
  for (const r of runs) {
    const when = r.at.replace('T', ' ').slice(0, 19)
    const times = r.ok ? `capture ${r.captureSeconds}s · photo ${r.photoSeconds}s · total ${r.totalSeconds}s` : `FAILED after ${r.totalSeconds}s: ${r.error}`
    console.log(`${when}  ${r.view.padEnd(12)} ${r.time.padEnd(10)} sun ${r.sun ? 'on ' : 'off'}  ${times}`)
  }

  const ok = runs.filter(r => r.ok)
  const totals = ok.map(r => r.totalSeconds ?? 0)
  console.log('\n--- summary ---')
  console.log(`runs: ${runs.length} | succeeded: ${ok.length} | failed: ${runs.length - ok.length} (${Math.round(((runs.length - ok.length) / runs.length) * 100)}%)`)
  if (totals.length) {
    console.log(`total time: median ${median(totals).toFixed(1)}s | slowest ${Math.max(...totals).toFixed(1)}s | fastest ${Math.min(...totals).toFixed(1)}s`)
    console.log(`photo step: median ${median(ok.map(r => r.photoSeconds ?? 0)).toFixed(1)}s | capture step: median ${median(ok.map(r => r.captureSeconds ?? 0)).toFixed(1)}s`)
  }
  const reasons = new Map<string, number>()
  for (const r of runs.filter(r => !r.ok)) reasons.set(r.error ?? 'unknown', (reasons.get(r.error ?? 'unknown') ?? 0) + 1)
  for (const [reason, n] of reasons) console.log(`  failure x${n}: ${reason}`)
}

main()
