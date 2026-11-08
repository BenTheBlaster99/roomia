import { execFile } from 'node:child_process'

/**
 * Keeps Roomia's Blender from cooking a laptop, and from outliving its job (8 Nov: a render on Sarah's RTX laptop ran for
 * half an hour, the Stop button did not reach it, and the PC shut itself down).
 *
 * - findRoomiaBlenders / killAllRoomiaBlenders: every Blender process whose executable is the one this server uses, whoever
 *   started it (a job of an older server that was cut leaves its Blender behind: nobody tracks it, only its path tells).
 * - the thermal guard: while a Blender job holds the graphics slot, the card's temperature is read through nvidia-smi every
 *   5 s. At HOT_C the Blender processes are suspended (they stop asking the card for work, it cools), and resumed at COOL_C.
 *   The job only takes longer. Without nvidia-smi (no NVIDIA card) the guard does nothing.
 */
const HOT_C = Number(process.env.ROOMIA_GPU_HOT_C ?? 83)
const COOL_C = Number(process.env.ROOMIA_GPU_COOL_C ?? 74)
const BLENDER_PATH = () => (process.env.ROOMIA_BLENDER ?? 'blender').toLowerCase()

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

const state = { paused: false, temp: 0 }
/** What the screens show while the card cools. */
export const thermalState = () => ({ paused: state.paused, temp: state.temp })

let users = 0
let timer: ReturnType<typeof setInterval> | null = null
let busy = false

async function tick() {
  if (busy) return
  busy = true
  try {
    const out = await run('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'], 3000)
    const temp = Math.max(0, ...out.split('\n').map(Number).filter(Number.isFinite))
    if (!temp) return
    state.temp = temp
    if (!state.paused && temp >= HOT_C) {
      const pids = await findRoomiaBlenders()
      if (pids.length) {
        console.warn(`blender-guard: ${temp} °C, pausing Blender (${pids.join(' ')}) until ${COOL_C} °C`)
        await setPaused(pids, true)
        state.paused = true
      }
    } else if (state.paused && temp <= COOL_C) {
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
  if (!timer) timer = setInterval(() => void tick(), 5000)
  let done = false
  return () => {
    if (done) return
    done = true
    users -= 1
    if (users > 0) return
    if (timer) clearInterval(timer)
    timer = null
    if (state.paused) {
      state.paused = false
      void findRoomiaBlenders().then(pids => setPaused(pids, false))
    }
  }
}
