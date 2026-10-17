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
  /** Makes the material's surfaces glow in the 3D view; null clears it. */
  highlight: (name: string | null) => void
  /** While set, clicking a surface in the 3D view reports its material instead of doing nothing. */
  setPickHandler: (handler: ((name: string) => void) | null) => void
}

let access: MaterialAccess | null = null

export function registerMaterialAccess(next: MaterialAccess | null) {
  access = next
}

export const listSceneMaterials = (): SceneMaterialInfo[] => access?.list() ?? []
export const highlightSceneMaterial = (name: string | null) => access?.highlight(name)
export const setMaterialPickHandler = (handler: ((name: string) => void) | null) => access?.setPickHandler(handler)
