/** What desktop/preload.js exposes to the Studio's pages inside Roomia Desktop (absent in a browser). */
interface RoomiaDesktopBridge {
  desktop: true
  version?: string
  onStatus?: (listener: (status: unknown) => void) => void
  engine?: () => Promise<unknown>
  openProjects?: () => void
  /** Saves logs, engine report and versions into a zip on the Desktop; resolves to its path. */
  report?: () => Promise<string | null>
  /** Opens an address in the system browser. */
  openExternal?: (url: string) => void
  /** Installs (or repairs) the SketchUp extension « Envoyer à Roomia » in every SketchUp of this PC. */
  installSketchup?: () => Promise<void>
  /** The hidden native menu's entries (16 Nov): resolves to the app version for 'version', else nothing. */
  action?: (name: 'check-updates' | 'engine' | 'retest' | 'open-logs' | 'guide' | 'version') => Promise<string | null | undefined>
}

interface Window {
  roomiaDesktop?: RoomiaDesktopBridge
}
