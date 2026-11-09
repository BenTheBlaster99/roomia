import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Keeps Roomia's Blender from outliving its job, and from running a card to a dangerous temperature.
 *
 * - findRoomiaBlenders / killAllRoomiaBlenders: every Blender process whose executable is the one this server uses, whoever
 *   started it (a job of an older server that was cut leaves its Blender behind: nobody tracks it, only its path tells).
 * - the thermal guard is an EMERGENCY stop only (9 Nov): at HOT_C (90) Blender is suspended (it stops asking the card for
 *   work) and resumed at RESUME_C (80). Most PCs never get near it; Sarah's laptop reached 86 °C and its own card slows
 *   itself down around 87. 9 Nov 02:00 test on her laptop: the first design (a rest between points from 80 down to 72 °C) took
 *   52% of a 12 minute golden hour in idle waits and did not even prevent the 84 °C stops, so the soft rest is off by default
 *   (ROOMIA_GPU_WAIT_C=80 turns it on again: the "cool" flag below).
 * - "Pause after this point": the person asks for it; a "pause" flag file is looked at between two points.
 * - the flags are files in ROOMIA_FLAG_DIR (set here, inherited by Blender's Python). A flag counts only while its modification
 *   time is recent (the guard touches it every 2 s), so a server that died can never leave a render waiting for ever.
 * - every 2 s the card's temperature, power, clock and load are logged to gpu-log.csv (ROOMIA_LOG_DIR), and last-run.json
 *   keeps the summary of the last job: what the minutes were (rendering, cooling or paused).
 */
const HOT_C = Number(process.env.ROOMIA_GPU_HOT_C ?? 90)
const RESUME_C = Number(process.env.ROOMIA_GPU_RESUME_C ?? 80)
const WAIT_C = Number(process.env.ROOMIA_GPU_WAIT_C ?? 0) // 0: no rest between points
const COOL_C = Number(process.env.ROOMIA_GPU_COOL_C ?? 72)
const TICK_MS = 2000
const BLENDER_PATH = () => (process.env.ROOMIA_BLENDER ?? 'blender').toLowerCase()

export const FLAG_DIR = process.env.ROOMIA_FLAG_DIR || path.join(os.tmpdir(), 'roomia-flags')
process.env.ROOMIA_FLAG_DIR = FLAG_DIR
const LOG_DIR = process.env.ROOMIA_LOG_DIR || FLAG_DIR
const COOL_FLAG = path.join(FLAG_DIR, 'cool.flag')
const PAUSE_FLAG = path.join(FLAG_DIR, 'pause.flag')

function flag(file: string, on: boolean) {
  try {
    if (on) {
      mkdirSync(FLAG_DIR, { recursive: true })
      writeFileSync(file, String(Date.now()))
    } else rmSync(file, { force: true })
  } catch {
    // the flag is a courtesy to the renderer: failing to write it must not break the job
  }
}
const touch = (file: string) => {
  try {
    const now = new Date()
    utimesSync(file, now, now)
  } catch {
    // not there
  }
}
// a flag left by a server that stopped (a crash, a power cut) is not true any more
flag(COOL_FLAG, false)
flag(PAUSE_FLAG, false)

const run = (cmd: string, args: string[], timeout = 20_000) =>
  new Promise<string>(resolve => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? '' : String(out)))
  })

/** Process ids of the Blender this server runs (compared by executable path, case-insensitive). */
export async function findRoomiaBlenders(): Promise<number[]> {
  const exe = BLENDER_PATH()
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='blender.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`,
    ])
    return out.split(/\r?\n/).flatMap(l => {
      const [pid, p] = l.trim().split('|')
      return pid && p && p.toLowerCase() === exe ? [Number(pid)] : []
    })
  }
  const out = await run('ps', ['-eo', 'pid=,args='])
  return out.split('\n').flatMap(l => {
    const m = /^\s*(\d+)\s+(.*)$/.exec(l)
    return m && m[2].toLowerCase().startsWith(exe + ' ') ? [Number(m[1])] : []
  })
}

/** Ends every Roomia Blender now (the process tree on Windows). Returns how many were found. */
export async function killAllRoomiaBlenders(): Promise<number> {
  const pids = await findRoomiaBlenders()
  for (const pid of pids) {
    if (process.platform === 'win32') await run('taskkill', ['/pid', String(pid), '/T', '/F'], 10_000)
    else {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
  if (pids.length) console.log(`blender-guard: ended ${pids.length} Blender process(es): ${pids.join(' ')}`)
  return pids.length
}

async function setPaused(pids: number[], paused: boolean) {
  if (process.platform === 'win32') {
    const fn = paused ? 'NtSuspendProcess' : 'NtResumeProcess'
    await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$s='[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);'; ` +
        `Add-Type -MemberDefinition $s -Name N -Namespace W; foreach ($id in @(${pids.join(',')})) { try { $p=[System.Diagnostics.Process]::GetProcessById($id); [W.N]::${fn}($p.Handle) | Out-Null } catch {} }`,
    ], 30_000)
  } else {
    for (const pid of pids) {
      try {
        process.kill(pid, paused ? 'SIGSTOP' : 'SIGCONT')
      } catch {
        // already gone
      }
    }
  }
}

/** paused: Blender suspended (emergency). waiting: the card cools, the next point waits. userPaused: the person asked for a pause. */
const state = { paused: false, waiting: false, userPaused: false, temp: 0, power: 0, clock: 0 }
/** What the screens show while the card cools or the person paused. */
export const thermalState = () => ({ paused: state.paused, waiting: state.waiting, userPaused: state.userPaused, temp: state.temp })

/** "Pause after this point" (on) and "Resume" (off). */
export function setUserPause(on: boolean) {
  state.userPaused = on
  flag(PAUSE_FLAG, on)
}

// ---- what the minutes were, for the last job
interface Run {
  startedAt: number
  samples: number
  tempSum: number
  powerSum: number
  clockSum: number
  maxTemp: number
  suspendedMs: number
  waitingMs: number
  userPausedMs: number
  last: number
}
let runInfo: Run | null = null
const newRun = (): Run => ({ startedAt: Date.now(), samples: 0, tempSum: 0, powerSum: 0, clockSum: 0, maxTemp: 0, suspendedMs: 0, waitingMs: 0, userPausedMs: 0, last: Date.now() })

function writeSummary(r: Run) {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    const n = Math.max(1, r.samples)
    writeFileSync(
      path.join(LOG_DIR, 'last-run.json'),
      JSON.stringify(
        {
          startedAt: new Date(r.startedAt).toISOString(),
          seconds: Math.round((Date.now() - r.startedAt) / 1000),
          tempAvg: Math.round((r.tempSum / n) * 10) / 10,
          tempMax: r.maxTemp,
          powerAvgW: Math.round((r.powerSum / n) * 10) / 10,
          clockAvgMHz: Math.round(r.clockSum / n),
          secondsSuspended: Math.round(r.suspendedMs / 1000),
          secondsWaitingToCool: Math.round(r.waitingMs / 1000),
          secondsPausedByUser: Math.round(r.userPausedMs / 1000),
          limits: { waitC: WAIT_C, coolC: COOL_C, hotC: HOT_C, resumeC: RESUME_C },
        },
        null,
        1,
      ),
    )
  } catch {
    // a log is never worth a failed job
  }
}

let users = 0
let timer: ReturnType<typeof setInterval> | null = null
let busy = false

async function tick() {
  if (busy) return
  busy = true
  try {
    const out = await run('nvidia-smi', ['--query-gpu=temperature.gpu,power.draw,clocks.gr,utilization.gpu', '--format=csv,noheader,nounits'], 3000)
    const row = out.split('\n').find(l => l.trim())?.split(',').map(s => Number(s.trim())) ?? []
    const temp = row[0]
    const now = Date.now()
    if (runInfo) {
      const dt = now - runInfo.last
      runInfo.last = now
      if (state.paused) runInfo.suspendedMs += dt
      else if (state.waiting) runInfo.waitingMs += dt
      if (state.userPaused) runInfo.userPausedMs += dt
    }
    if (state.waiting) touch(COOL_FLAG)
    if (state.userPaused) touch(PAUSE_FLAG)
    if (!Number.isFinite(temp) || !temp) return
    state.temp = temp
    state.power = Number.isFinite(row[1]) ? row[1] : 0
    state.clock = Number.isFinite(row[2]) ? row[2] : 0
    if (runInfo) {
      runInfo.samples += 1
      runInfo.tempSum += temp
      runInfo.powerSum += state.power
      runInfo.clockSum += state.clock
      runInfo.maxTemp = Math.max(runInfo.maxTemp, temp)
    }
    try {
      mkdirSync(LOG_DIR, { recursive: true })
      appendFileSync(
        path.join(LOG_DIR, 'gpu-log.csv'),
        `${new Date(now).toISOString()},${temp},${state.power},${state.clock},${row[3] ?? ''},${state.paused ? 'suspended' : state.waiting ? 'waiting' : state.userPaused ? 'user-pause' : 'running'}\n`,
      )
    } catch {
      // not worth failing for
    }
    // step 1: a rest between two points
    if (WAIT_C > 0 && !state.waiting && temp >= WAIT_C) {
      state.waiting = true
      flag(COOL_FLAG, true)
      console.warn(`blender-guard: ${temp} °C, the next point waits until ${COOL_C} °C`)
    } else if (state.waiting && (WAIT_C <= 0 || temp <= COOL_C)) {
      state.waiting = false
      flag(COOL_FLAG, false)
      console.log(`blender-guard: ${temp} °C, points go on`)
    }
    // step 2: emergency
    if (!state.paused && temp >= HOT_C) {
      const pids = await findRoomiaBlenders()
      if (pids.length) {
        console.warn(`blender-guard: ${temp} °C, pausing Blender (${pids.join(' ')}) until ${RESUME_C} °C`)
        await setPaused(pids, true)
        state.paused = true
      }
    } else if (state.paused && temp <= RESUME_C) {
      console.log(`blender-guard: ${temp} °C, resuming Blender`)
      await setPaused(await findRoomiaBlenders(), false)
      state.paused = false
    }
  } finally {
    busy = false
  }
}

/** Called while a Blender job holds the slot; the returned function ends the watch (and wakes Blender if it was paused). */
export function watchTemperature(): () => void {
  users += 1
  if (!runInfo) runInfo = newRun()
  if (!timer) timer = setInterval(() => void tick(), TICK_MS)
  let done = false
  return () => {
    if (done) return
    done = true
    users -= 1
    if (users > 0) return
    if (timer) clearInterval(timer)
    timer = null
    if (runInfo) writeSummary(runInfo)
    runInfo = null
    state.waiting = false
    flag(COOL_FLAG, false)
    // a pause belongs to the job it was asked for
    state.userPaused = false
    flag(PAUSE_FLAG, false)
    if (state.paused) {
      state.paused = false
      void findRoomiaBlenders().then(pids => setPaused(pids, false))
    }
  }
}
