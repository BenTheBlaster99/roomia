/** A material of the imported scene as Studio shows it in the Matériaux panel. */
export interface SceneMaterialInfo {
  name: string
  /** CSS colour of the material's base colour (its texture, if any, is not averaged). */
  color: string
  textured: boolean
  /** See-through in the file (opacity below 0.9): the capture turns it into glass. */
  seeThrough: boolean
  /** How many surfaces (meshes) use it in the preview. */
  meshes: number
}

interface MaterialAccess {
  list: () => SceneMaterialInfo[]
  /** Makes these materials' surfaces glow in the 3D view; an empty list clears it. */
  highlight: (names: string[]) => void
  /** Shows a new flat colour on the material in the 3D view; null puts the original back. */
  previewColor: (name: string, color: string | null) => void
  /** While set, clicking a surface in the 3D view reports its material instead of doing nothing. */
  setPickHandler: (handler: ((name: string) => void) | null) => void
}

let access: MaterialAccess | null = null

export function registerMaterialAccess(next: MaterialAccess | null) {
  access = next
}

export const listSceneMaterials = (): SceneMaterialInfo[] => access?.list() ?? []
export const highlightSceneMaterials = (names: string[]) => access?.highlight(names)
export const previewMaterialColor = (name: string, color: string | null) => access?.previewColor(name, color)
export const setMaterialPickHandler = (handler: ((name: string) => void) | null) => access?.setPickHandler(handler)
