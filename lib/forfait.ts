/**
 * A client's "forfait" (13 Nov 2026): instead of a number of credits, the account shows what its package contains —
 * photos IA, 360 views with the AI light, the 2D and 3D plans, and updates of the project. Shared by Roomia's server
 * (lib/credits.ts keeps and enforces it) and the app's pages, so nothing here touches the database.
 *
 * Only the paid items are enforced: a photo takes one "photo", an AI-lit 360 view takes one "pano". The plans are
 * Blender renders, free and unlimited in the app; the updates (a new version of the project) are counted, not blocked.
 */

export type ForfaitItemKey = 'photo' | 'pano' | 'plan2d' | 'plan3d' | 'update' | 'project'

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
  /** the 13 Nov package (photos, 360 views, updates counted for the whole account); for a projects forfait, one 'project' line */
  items: ForfaitItem[]
  /** 27 Nov: the projects forfait (see PROJECT_SCOPE): the account buys projects, never images */
  projects?: ProjectsForfait
}

/**
 * 27 Nov 2026 (the user's decision, with ChatGPT's review in feedback2.txt): Roomia sells a complete presentation of each
 * unique apartment design, not a quantity of images. 1 project = 1 typology (identical flats count once). Inside a project,
 * per version of the model: the 360 views it needs (standard scope up to 25 points), 20 HD photos, the 2D and 3D plans and
 * the client link; plus 3 updates (a new version of the same apartment). Villas, duplexes and complex projects are quoted:
 * the admin makes such a project count for more than one, or widens its scope. A failed job never counts.
 */
export const PROJECT_SCOPE = { views: 25, photos: 20, updates: 3 } as const

/** The packs on sale (DA), the admin's buttons; the price is written in the ledger for the accounts. */
export const PROJECT_PACKS = [
  { projects: 1, price: 30_000 },
  { projects: 3, price: 80_000 },
  { projects: 5, price: 110_000 },
  { projects: 10, price: 200_000 },
] as const

/** Roomia's own estimate of one AI image (gateway), for the admin's cost column only; never shown to clients. */
export const AI_IMAGE_COST_DA = 16

export interface ProjectUse {
  /** the desktop's scene id of the project */
  id: string
  name: string
  openedAt: number
  /** projects of the pack it takes (1; more for a quoted villa or duplex) */
  credits: number
  /** 1 for the first model, +1 for every update */
  version: number
  updates: { used: number; included: number }
  /** in the current version: different 360 points finished by the AI */
  views: { used: number; included: number }
  /** in the current version */
  photos: { used: number; included: number }
  /** admin only: AI images paid by Roomia for this project (all versions, re-runs included) */
  aiImages?: number
  /** admin only: updates whose model looked very different (maybe another apartment) */
  flags?: string[]
}

export interface ProjectsForfait {
  /** projects bought */
  total: number
  /** projects taken (a quoted project can take more than one) */
  used: number
  projects: ProjectUse[]
}

const ITEM_SCOPE = { pano: 'views', photo: 'photos' } as const

export const FORFAIT_LABELS: Record<ForfaitItemKey, string> = {
  photo: 'Photos IA',
  pano: 'Visite 360° · vues finies par l’IA',
  plan2d: 'Plan 2D',
  plan3d: 'Plan 3D',
  update: 'Mises à jour du projet',
  project: 'Projets',
}

/**
 * What is left of one item (never below 0), or null when the account has no forfait or the item isn't in it. With a projects
 * forfait, photos and 360 views are what is left in that project's current version (a project not started yet: a full
 * project if the pack still has one, else 0).
 */
export function forfaitLeft(forfait: Forfait | null | undefined, key: ForfaitItemKey, projectId?: string | null): number | null {
  if (forfait?.projects) {
    if (key !== 'pano' && key !== 'photo') return null
    const scope = ITEM_SCOPE[key]
    const p = projectId ? forfait.projects.projects.find(x => x.id === projectId) : undefined
    if (p) return p.updates.used > p.updates.included ? 0 : Math.max(0, p[scope].included - p[scope].used)
    return forfait.projects.used < forfait.projects.total ? PROJECT_SCOPE[scope] : 0
  }
  const item = forfait?.items.find(i => i.key === key)
  return item ? Math.max(0, item.total - item.used) : null
}

/**
 * With a projects forfait: the sentence shown before the first AI image of a project ("this will use one of your projects"),
 * or when nothing is left; null when there is nothing to say (no projects forfait, or the project is already started).
 */
export function projectNotice(forfait: Forfait | null | undefined, projectId: string | null | undefined): { tone: 'info' | 'warn'; text: string } | null {
  const f = forfait?.projects
  if (!f) return null
  const p = projectId ? f.projects.find(x => x.id === projectId) : undefined
  if (p) {
    if (p.updates.used > p.updates.included) return { tone: 'warn', text: `Les ${p.updates.included} mises à jour incluses dans ce projet sont utilisées. Contactez Roomia pour en ajouter une.` }
    return null
  }
  const left = f.total - f.used
  if (left <= 0) return { tone: 'warn', text: `Les ${plural(f.total, 'projet', 'projets')} de votre forfait sont utilisés. Contactez Roomia pour en ajouter.` }
  return {
    tone: 'info',
    text: `La première image IA de ce projet utilisera 1 projet de votre forfait (il vous en restera ${left - 1}). Il comprend toutes ses vues 360°, ${PROJECT_SCOPE.photos} photos HD, les plans, le lien client et ${PROJECT_SCOPE.updates} mises à jour.`,
  }
}

/** "30 000 DA" */
export const da = (n: number) => `${n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} DA`

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
