/**
 * Runs once when the server starts. Only Roomia Desktop does something here: it picks up the imports and the free tour
 * builds that were cut by a crash or by closing the app (lib/desktop-resume.ts). The Node-only code sits behind
 * NEXT_RUNTIME === 'nodejs', the form Next.js leaves out of its edge build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.ROOMIA_DESKTOP === '1') {
      const { watchParent } = await import('./lib/desktop-watchdog')
      watchParent()
      const { resumeInterruptedWork } = await import('./lib/desktop-resume')
      // after the server is up, so the app's window opens without waiting
      setTimeout(() => {
        resumeInterruptedWork().catch(err => console.error('resume failed', err))
      }, 5000)
    }
  }
}
