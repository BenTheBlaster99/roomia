import { spawn } from 'node:child_process'

/**
 * Roomia Desktop: the server stops by itself when the app is gone. The app stops it on a normal quit, but when the app
 * is killed (Task Manager, a crash) nobody would, and the next launch would start a second server next to it, with
 * the first one's renders still running. ROOMIA_PARENT_PID is the app's process id.
 */
export function watchParent() {
  const parent = Number(process.env.ROOMIA_PARENT_PID)
  if (!Number.isInteger(parent) || parent <= 1) return
  const timer = setInterval(() => {
    try {
      process.kill(parent, 0)
      return
    } catch (err) {
      // EPERM: it exists but is not ours to signal, so it is alive
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return
    }
    clearInterval(timer)
    console.error(`app ${parent} is gone, stopping the server and its renders`)
    stopSelfAndRenders()
  }, 5000)
  timer.unref()
}

function stopSelfAndRenders() {
  if (process.platform === 'win32') {
    // the whole tree: this server and every Blender it started
    spawn('taskkill', ['/pid', String(process.pid), '/T', '/F'], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => process.exit(0), 3000)
    return
  }
  // the app started the server as a process group leader, so the group holds its renders
  try {
    process.kill(-process.pid, 'SIGKILL')
  } catch {}
  process.exit(0)
}
