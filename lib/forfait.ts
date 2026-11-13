/**
 * A client's "forfait" (13 Nov 2026): instead of a number of credits, the account shows what its package contains —
 * photos IA, 360 views with the AI light, the 2D and 3D plans, and updates of the project. Shared by Roomia's server
 * (lib/credits.ts keeps and enforces it) and the app's pages, so nothing here touches the database.
 *
 * Only the paid items are enforced: a photo takes one "photo", an AI-lit 360 view takes one "pano". The plans are
 * Blender renders, free and unlimited in the app; the updates (a new version of the project) are counted, not blocked.
 */

export type ForfaitItemKey = 'photo' | 'pano' | 'plan2d' | 'plan3d' | 'update'

export interface ForfaitItem {
  key: ForfaitItemKey
  label: string
  total: number
  used: number
  /** included in the package, nothing counted (the plans) */
  included?: boolean
}

export interface Forfait {
  label: string
  items: ForfaitItem[]
}

export const FORFAIT_LABELS: Record<ForfaitItemKey, string> = {
  photo: 'Photos IA',
  pano: 'Visite 360° · vues finies par l’IA',
  plan2d: 'Plan 2D',
  plan3d: 'Plan 3D',
  update: 'Mises à jour du projet',
}

/** What is left of one item (never below 0), or null when the account has no forfait or the item isn't in it. */
export function forfaitLeft(forfait: Forfait | null | undefined, key: ForfaitItemKey): number | null {
  const item = forfait?.items.find(i => i.key === key)
  return item ? Math.max(0, item.total - item.used) : null
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
