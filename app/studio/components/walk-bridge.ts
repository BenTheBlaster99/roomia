/**
 * The walk's "Point de départ" (18 Nov): WalkControls registers how to go back to where the walk started, the bottom bar
 * (ViewControls) calls it. Nothing happens while no project is on screen.
 */
let home: (() => void) | null = null

export function registerWalkHome(fn: (() => void) | null) {
  home = fn
}

export function walkHome(): boolean {
  if (!home) return false
  home()
  return true
}
