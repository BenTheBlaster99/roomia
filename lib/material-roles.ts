/**
 * What the designer changed on a material: what it is in real life when its name doesn't say it
 * (Sarah's mirror is called "*33"), and optionally a new colour and finish. 'auto' leaves the
 * role to name and transparency detection.
 */
export const MATERIAL_ROLES = ['auto', 'normal', 'mirror', 'glass', 'light'] as const
export type MaterialRole = (typeof MATERIAL_ROLES)[number]

export const ROLE_LABELS: Record<MaterialRole, string> = {
  auto: 'Auto',
  normal: 'Normal',
  mirror: 'Miroir',
  glass: 'Verre',
  light: 'Lumière',
}

export const FINISHES = ['mat', 'satin', 'brillant'] as const
export type MaterialFinish = (typeof FINISHES)[number]

export const FINISH_LABELS: Record<MaterialFinish, string> = {
  mat: 'Mat',
  satin: 'Satiné',
  brillant: 'Brillant',
}

/** Roughness each finish gives the surface in the capture (0 = mirror-smooth, 1 = chalky). */
export const FINISH_ROUGHNESS: Record<MaterialFinish, number> = { mat: 0.85, satin: 0.4, brillant: 0.08 }

/**
 * What a material is in real life (18 Nov): its family gives it its real finish in the 360° render (gloss, coat, sheen, metal,
 * relief from its own picture; scripts/look_materials.py FAMILIES). Roomia guesses it from the name and the picture; the designer
 * says it when the guess is missing or wrong, and the PC remembers it for the next projects (the material library).
 */
export const MATERIAL_FAMILIES = [
  'stone', 'tile', 'lacquer', 'satin', 'wood', 'leather', 'velvet', 'fabric', 'carpet',
  'chrome', 'metal', 'gold', 'plaster', 'plastic', 'plant', 'paper',
] as const
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number]

export const FAMILY_LABELS: Record<MaterialFamily | 'stone_soft', string> = {
  stone: 'Marbre, pierre',
  stone_soft: 'Pierre (satinée)',
  tile: 'Carrelage, céramique',
  lacquer: 'Laqué brillant',
  satin: 'Satiné (meuble, porte)',
  wood: 'Bois',
  leather: 'Cuir',
  velvet: 'Velours',
  fabric: 'Tissu',
  carpet: 'Tapis, moquette',
  chrome: 'Chrome, inox',
  metal: 'Métal brossé',
  gold: 'Or, laiton',
  plaster: 'Peinture mate, enduit',
  plastic: 'Plastique',
  plant: 'Plante',
  paper: 'Papier, livre',
}

export const isMaterialFamily = (value: unknown): value is MaterialFamily =>
  typeof value === 'string' && (MATERIAL_FAMILIES as readonly string[]).includes(value)

export interface MaterialEdit {
  role?: Exclude<MaterialRole, 'auto'>
  /** what the material is (its finish in the 360° render); remembered in the PC's library too */
  family?: MaterialFamily
  /** New base colour, "#rrggbb"; replaces the material's texture with this flat colour. */
  color?: string
  finish?: MaterialFinish
}

/** Material name → what the designer changed; materials left as they are don't appear. */
export type MaterialRoles = Record<string, MaterialEdit>

const MAX_EDITS = 2000
const MAX_NAME = 200
const HEX = /^#[0-9a-f]{6}$/i

export function isMaterialRole(value: unknown): value is MaterialRole {
  return typeof value === 'string' && (MATERIAL_ROLES as readonly string[]).includes(value)
}

const isFinish = (value: unknown): value is MaterialFinish =>
  typeof value === 'string' && (FINISHES as readonly string[]).includes(value)

/** Keeps only valid entries of an untrusted edits object. Accepts the older { name: role } form. */
export function cleanRoles(value: unknown): MaterialRoles {
  const edits: MaterialRoles = {}
  if (!value || typeof value !== 'object') return edits
  for (const [name, raw] of Object.entries(value).slice(0, MAX_EDITS)) {
    if (!name || name.length > MAX_NAME) continue
    const given = (typeof raw === 'string' ? { role: raw } : raw) as Record<string, unknown> | null
    if (!given || typeof given !== 'object') continue
    const edit: MaterialEdit = {}
    if (isMaterialRole(given.role) && given.role !== 'auto') edit.role = given.role
    if (typeof given.color === 'string' && HEX.test(given.color)) edit.color = given.color.toLowerCase()
    if (isFinish(given.finish)) edit.finish = given.finish
    if (isMaterialFamily(given.family)) edit.family = given.family
    if (Object.keys(edit).length) edits[name] = edit
  }
  return edits
}
