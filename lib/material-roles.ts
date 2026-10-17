/**
 * What a material is in real life, set by the designer when its name doesn't say it (Sarah's
 * mirror is called "*33"). 'auto' leaves it to name and transparency detection.
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

/** Material name → role; only roles other than 'auto' are stored. */
export type MaterialRoles = Record<string, Exclude<MaterialRole, 'auto'>>

const MAX_ROLES = 2000
const MAX_NAME = 200

export function isMaterialRole(value: unknown): value is MaterialRole {
  return typeof value === 'string' && (MATERIAL_ROLES as readonly string[]).includes(value)
}

/** Keeps only valid entries of an untrusted roles object. */
export function cleanRoles(value: unknown): MaterialRoles {
  const roles: MaterialRoles = {}
  if (!value || typeof value !== 'object') return roles
  for (const [name, role] of Object.entries(value).slice(0, MAX_ROLES)) {
    if (name && name.length <= MAX_NAME && isMaterialRole(role) && role !== 'auto') roles[name] = role
  }
  return roles
}
