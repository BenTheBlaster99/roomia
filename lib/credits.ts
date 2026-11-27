import { getDb, transaction } from './db'
import { FORFAIT_LABELS, plural, PROJECT_SCOPE, da, type Forfait, type ForfaitItemKey, type ProjectUse } from './forfait'

/**
 * Render credits. 1 credit = 1 final photo. The rules:
 * - A credit is reserved just before the paid image step and consumed only when the photo has
 *   been decoded, is not blank, and is saved on the Studio PC.
 * - Any failure (provider down or slow, refused, the server restarting) releases it.
 * - A job id is charged at most once: a repeated request with the same id is refused.
 * - The free "Vérifier la vue" capture never uses credits.
 * - A photo that doesn't respect the design can be reported once; an admin decides on a refund.
 * Every movement is written to the ledger with the balance after it.
 */

export type JobStatus = 'reserved' | 'consumed' | 'released'

export class CreditError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const JOB_ID = /^[A-Za-z0-9_-]{8,64}$/
export const isJobId = (id: unknown): id is string => typeof id === 'string' && JOB_ID.test(id)

function balance(userId: number): number {
  return Number(getDb().prepare('SELECT credits FROM users WHERE id = ?').get(userId)?.credits ?? 0)
}

function writeLedger(entry: { userId: number; jobId?: string | null; kind: string; delta: number; outcome?: string; detail?: string; actorId?: number }) {
  getDb()
    .prepare('INSERT INTO ledger (at, user_id, job_id, kind, delta, balance_after, outcome, detail, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(Date.now(), entry.userId, entry.jobId ?? null, entry.kind, entry.delta, balance(entry.userId), entry.outcome ?? null, entry.detail?.slice(0, 500) ?? null, entry.actorId ?? null)
}

/**
 * Takes 1 credit for a new photo job. Throws CreditError when the balance is 0 or the job id was
 * already used (a retry must not be charged twice).
 */
export function reserveCredit(
  userId: number,
  jobId: string,
  sceneId: string,
  view: string,
  item: 'photo' | 'pano' = 'photo',
  /** the project the image belongs to (the desktop's scene id and name); needed by a projects forfait */
  project?: { id: string; name: string } | null,
) {
  const db = getDb()
  transaction(db, () => {
    const projects = projectsTotal(userId)
    const forfait = projects === null ? forfaitOf(userId) : null
    if (projects !== null) {
      if (!project) {
        throw new CreditError(
          'Votre version de Roomia est trop ancienne pour votre forfait. Mettez à jour (menu Aide → Rechercher une mise à jour), relancez Roomia, puis recommencez. Rien n’a été décompté.',
          426,
        )
      }
      takeProjectRoom(userId, projects, project, item, item === 'pano' ? view : null)
    } else if (forfait) {
      const entry = forfait.items.find(i => i.key === item)
      if (!entry || entry.used >= entry.total) {
        throw new CreditError(
          item === 'pano'
            ? 'Plus de vues 360° dans votre forfait. Contactez Roomia pour l’étendre.'
            : 'Plus de photos IA dans votre forfait. Contactez Roomia pour l’étendre.',
          402,
        )
      }
    }
    const existing = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId)
    // 15 Nov (Sarah: "Reprendre" on the Qualité finale answered "Cette demande a déjà été traitée"): a 360 view's job id is made from
    // its picture, so resuming asks the same id again. A job that failed was given back and charged nothing: it may be asked again.
    if (existing?.status === 'released') {
      db.prepare('DELETE FROM jobs WHERE id = ? AND status = ?').run(jobId, 'released')
    } else if (existing) {
      throw new CreditError(
        existing.status === 'consumed'
          ? 'Cette photo a déjà été produite : elle est dans « Mes photos ».'
          : existing.status === 'reserved'
            ? 'Cette photo est déjà en cours.'
            : 'Cette demande a déjà été traitée. Relancez la photo.',
        409,
      )
    }
    if (projects !== null) {
      // a projects forfait counts projects, never credits
      if (!db.prepare(`SELECT 1 FROM users WHERE id = ? AND status = 'active'`).get(userId)) throw new CreditError('Ce compte est suspendu. Contactez Roomia.', 403)
      db.prepare('INSERT OR REPLACE INTO project_jobs (job_id, user_id, project) VALUES (?, ?, ?)').run(jobId, userId, project!.id)
    } else {
      const taken = db.prepare(`UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1 AND status = 'active'`).run(userId)
      if (Number(taken.changes) !== 1) {
        throw new CreditError('Plus de crédits sur ce compte. Contactez Roomia pour recharger.', 402)
      }
    }
    db.prepare(`INSERT INTO jobs (id, user_id, scene_id, view, status, pid, created_at) VALUES (?, ?, ?, ?, 'reserved', ?, ?)`).run(
      jobId,
      userId,
      sceneId,
      view.slice(0, 80),
      process.pid,
      Date.now(),
    )
    writeLedger({ userId, jobId, kind: 'reserve', delta: projects !== null ? 0 : -1, outcome: 'reserved', detail: `${project?.name || sceneId} · ${view}` })
  })
}

/** The photo exists and is saved: the reserved credit is spent for good. */
export function consumeCredit(jobId: string, photoFile: string) {
  const db = getDb()
  transaction(db, () => {
    const job = db.prepare(`SELECT user_id FROM jobs WHERE id = ? AND status = 'reserved'`).get(jobId)
    if (!job) return
    db.prepare(`UPDATE jobs SET status = 'consumed', photo_file = ?, finished_at = ? WHERE id = ?`).run(photoFile, Date.now(), jobId)
    writeLedger({ userId: Number(job.user_id), jobId, kind: 'consume', delta: 0, outcome: 'delivered', detail: photoFile })
  })
}

/** The job ended without a photo: the credit goes back. Safe to call more than once. */
export function releaseCredit(jobId: string, failure: string) {
  const db = getDb()
  transaction(db, () => {
    const done = db
      .prepare(`UPDATE jobs SET status = 'released', failure = ?, finished_at = ? WHERE id = ? AND status = 'reserved'`)
      .run(failure.slice(0, 300), Date.now(), jobId)
    if (Number(done.changes) !== 1) return
    const job = db.prepare('SELECT user_id, created_at FROM jobs WHERE id = ?').get(jobId)
    const userId = Number(job?.user_id)
    const projectJob = db.prepare('SELECT project FROM project_jobs WHERE job_id = ?').get(jobId)
    if (projectJob) {
      writeLedger({ userId, jobId, kind: 'release', delta: 0, outcome: 'failed', detail: failure })
      undoEmptyProject(userId, String(projectJob.project), Number(job?.created_at ?? 0))
      return
    }
    db.prepare('UPDATE users SET credits = credits + 1 WHERE id = ?').run(userId)
    writeLedger({ userId, jobId, kind: 'release', delta: 1, outcome: 'failed', detail: failure })
  })
}

/** Admin: add (positive) or remove (negative) credits, with the reason kept in the ledger. */
export function adjustCredits(userId: number, delta: number, reason: string, actorId: number): number {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10_000) throw new CreditError('Nombre de crédits invalide.', 400)
  if (!reason.trim()) throw new CreditError('Indiquez la raison (paiement, geste commercial, correction…).', 400)
  const db = getDb()
  return transaction(db, () => {
    const current = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId)
    if (!current) throw new CreditError('Compte introuvable.', 404)
    if (Number(current.credits) + delta < 0) throw new CreditError(`Le solde ne peut pas devenir négatif (solde : ${current.credits}).`, 400)
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(delta, userId)
    writeLedger({ userId, kind: delta > 0 ? 'grant' : 'adjust', delta, outcome: 'admin', detail: reason.trim(), actorId })
    return balance(userId)
  })
}

const CLAIM_DAYS = 7

/**
 * "This photo doesn't respect my design": one report per delivered photo, within 7 days. Nothing is
 * refunded automatically; an admin looks at it and decides.
 */
export function fileClaim(userId: number, sceneId: string, photoFile: string, reason: string) {
  const text = reason.trim()
  if (text.length < 5) throw new CreditError('Décrivez en quelques mots ce qui ne respecte pas le design.', 400)
  const db = getDb()
  return transaction(db, () => {
    const job = db
      .prepare(`SELECT id, finished_at FROM jobs WHERE user_id = ? AND scene_id = ? AND photo_file = ? AND status = 'consumed'`)
      .get(userId, sceneId, photoFile)
    if (!job) throw new CreditError('Cette photo n’a pas été payée avec ce compte.', 404)
    if (Date.now() - Number(job.finished_at) > CLAIM_DAYS * 86_400_000) throw new CreditError(`Le signalement est possible pendant ${CLAIM_DAYS} jours.`, 400)
    if (db.prepare('SELECT 1 FROM claims WHERE job_id = ?').get(job.id)) throw new CreditError('Cette photo a déjà été signalée.', 409)
    db.prepare(`INSERT INTO claims (user_id, job_id, scene_id, photo_file, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      userId,
      job.id,
      sceneId,
      photoFile,
      text.slice(0, 1000),
      Date.now(),
    )
    writeLedger({ userId, jobId: String(job.id), kind: 'claim', delta: 0, outcome: 'reported', detail: text })
  })
}

/** Admin decision on a report: refund gives the credit back, deny keeps it spent. */
export function decideClaim(claimId: number, decision: 'refund' | 'deny', note: string, actorId: number) {
  const db = getDb()
  transaction(db, () => {
    const claim = db.prepare(`SELECT * FROM claims WHERE id = ? AND status = 'pending'`).get(claimId)
    if (!claim) throw new CreditError('Signalement introuvable ou déjà traité.', 404)
    const userId = Number(claim.user_id)
    db.prepare('UPDATE claims SET status = ?, decided_at = ?, decided_by = ?, note = ? WHERE id = ?').run(
      decision === 'refund' ? 'refunded' : 'denied',
      Date.now(),
      actorId,
      note.slice(0, 500),
      claimId,
    )
    // a projects forfait's photo took no credit: a refunded one simply stops counting in its project
    const projectJob = db.prepare('SELECT 1 FROM project_jobs WHERE job_id = ?').get(claim.job_id)
    if (decision === 'refund' && !projectJob) db.prepare('UPDATE users SET credits = credits + 1 WHERE id = ?').run(userId)
    writeLedger({
      userId,
      jobId: String(claim.job_id),
      kind: decision === 'refund' ? 'refund' : 'claim-denied',
      delta: decision === 'refund' && !projectJob ? 1 : 0,
      outcome: decision === 'refund' ? 'refunded' : 'denied',
      detail: note || undefined,
      actorId,
    })
  })
}

// ── Forfait (lib/forfait.ts): the package a client account shows instead of credits ──

/** A 360 view's job (app/api/desktop/photo): its view label starts like this. */
const PANO_JOB = `(view LIKE '360 lumière · %' OR view LIKE '360 tuile · %')`

/**
 * The account's forfait with what was used, or null (then it shows plain credits). Photos and 360 views are counted from
 * the paid jobs since the forfait started (a job given back after a failure, or refunded after a report, doesn't count);
 * updates from forfait_usage.
 */
export function forfaitOf(userId: number, opts: { admin?: boolean } = {}): Forfait | null {
  const db = getDb()
  const row = db.prepare('SELECT label, items, since FROM forfaits WHERE user_id = ?').get(userId)
  if (!row) return null
  const totals = JSON.parse(String(row.items)) as Partial<Record<ForfaitItemKey, number>>
  if (totals.project !== undefined) {
    const total = Number(totals.project)
    const projects = (db.prepare('SELECT * FROM forfait_projects WHERE user_id = ? ORDER BY opened_at').all(userId) as unknown as ProjectRow[]).map(r => projectUse(userId, r, opts.admin === true))
    const used = projects.reduce((n, p) => n + p.credits, 0)
    return { label: String(row.label), items: [{ key: 'project', label: FORFAIT_LABELS.project, total, used }], projects: { total, used, projects } }
  }
  const since = Number(row.since)
  const jobs = (pano: boolean) =>
    Number(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM jobs j WHERE j.user_id = ? AND j.created_at >= ? AND j.status IN ('reserved', 'consumed')
             AND ${pano ? '' : 'NOT '}${PANO_JOB}
             AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.job_id = j.id AND c.status = 'refunded')`,
        )
        .get(userId, since)?.n ?? 0,
    )
  const usage = (item: string) => Number(db.prepare('SELECT COUNT(*) AS n FROM forfait_usage WHERE user_id = ? AND item = ? AND at >= ?').get(userId, item, since)?.n ?? 0)
  const used: Record<ForfaitItemKey, number> = { photo: jobs(false), pano: jobs(true), plan2d: 0, plan3d: 0, update: usage('update'), project: 0 }
  const order: ForfaitItemKey[] = ['photo', 'pano', 'plan2d', 'plan3d', 'update']
  return {
    label: String(row.label),
    items: order
      .filter(key => Number(totals[key] ?? 0) > 0)
      .map(key => ({ key, label: FORFAIT_LABELS[key], total: Number(totals[key]), used: used[key], ...(key === 'plan2d' || key === 'plan3d' ? { included: true } : {}) })),
  }
}

/**
 * Admin: gives an account a new forfait (replacing any previous one, its counters start at 0). The credit balance is set to
 * the paid items it contains (photos + 360 views), so the credit rules (reserve, give back, ledger) keep working as before.
 */
export function setForfait(userId: number, label: string, totals: Partial<Record<ForfaitItemKey, number>>, actorId: number): Forfait {
  for (const [key, n] of Object.entries(totals)) {
    if (!(key in FORFAIT_LABELS) || !Number.isInteger(n) || n! < 0 || n! > 1000) throw new CreditError(`Forfait invalide : ${key}=${n}.`, 400)
  }
  const paid = (totals.photo ?? 0) + (totals.pano ?? 0)
  const db = getDb()
  transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new CreditError('Compte introuvable.', 404)
    if (db.prepare(`SELECT 1 FROM jobs WHERE user_id = ? AND status = 'reserved'`).get(userId)) throw new CreditError('Une photo est en cours sur ce compte : réessayez quand elle est finie.', 409)
    db.prepare('INSERT OR REPLACE INTO forfaits (user_id, label, items, since) VALUES (?, ?, ?, ?)').run(userId, label, JSON.stringify(totals), Date.now())
    const before = balance(userId)
    db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(paid, userId)
    const parts = [
      totals.photo ? plural(totals.photo, 'photo IA', 'photos IA') : '',
      totals.pano ? plural(totals.pano, 'vue 360°', 'vues 360°') : '',
      totals.plan2d ? 'plan 2D' : '',
      totals.plan3d ? 'plan 3D' : '',
      totals.update ? plural(totals.update, 'mise à jour', 'mises à jour') : '',
    ].filter(Boolean)
    writeLedger({ userId, kind: 'forfait', delta: paid - before, outcome: 'admin', detail: `${label} : ${parts.join(', ')}`, actorId })
  })
  return forfaitOf(userId)!
}

/** Admin: the account goes back to plain credits (the balance stays as it is). */
export function removeForfait(userId: number) {
  getDb().prepare('DELETE FROM forfaits WHERE user_id = ?').run(userId)
}

/** The app reports a free use that the forfait counts (a new version of a project). Never blocks anything. */
export function recordForfaitUse(userId: number, item: 'update', detail: string) {
  if (!getDb().prepare('SELECT 1 FROM forfaits WHERE user_id = ?').get(userId)) return
  getDb().prepare('INSERT INTO forfait_usage (user_id, item, detail, at) VALUES (?, ?, ?, ?)').run(userId, item, detail.slice(0, 200), Date.now())
}

// ── Projects forfait (27 Nov, lib/forfait.ts PROJECT_SCOPE): the account buys projects; inside a project, a disclosed scope ──

interface ProjectRow {
  project: string
  name: string
  opened_at: number
  credits: number
  extra_updates: number
  extra_views: number
  extra_photos: number
}

/** Projects bought, or null when the account has no projects forfait. */
export function projectsTotal(userId: number): number | null {
  const row = getDb().prepare('SELECT items FROM forfaits WHERE user_id = ?').get(userId)
  if (!row) return null
  const n = (JSON.parse(String(row.items)) as { project?: number }).project
  return n === undefined ? null : Number(n)
}

const PANO_J = `(j.view LIKE '360 lumière · %' OR j.view LIKE '360 tuile · %')`

/** What one project used in its current version (since its last update). Refunded and failed jobs never count. */
function projectCounts(userId: number, project: string, since: number) {
  const q = (what: string, pano: boolean) =>
    Number(
      getDb()
        .prepare(
          `SELECT ${what} AS n FROM jobs j JOIN project_jobs p ON p.job_id = j.id
           WHERE p.user_id = ? AND p.project = ? AND j.created_at >= ? AND j.status IN ('reserved', 'consumed') AND ${pano ? '' : 'NOT '}${PANO_J}
             AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.job_id = j.id AND c.status = 'refunded')`,
        )
        .get(userId, project, since)?.n ?? 0,
    )
  return { views: q('COUNT(DISTINCT j.view)', true), viewJobs: q('COUNT(*)', true), photos: q('COUNT(*)', false) }
}

function versionsOf(userId: number, project: string) {
  return getDb().prepare('SELECT at, file, note FROM project_versions WHERE user_id = ? AND project = ? ORDER BY at').all(userId, project) as {
    at: number
    file: string | null
    note: string | null
  }[]
}

function projectUse(userId: number, r: ProjectRow, admin: boolean): ProjectUse {
  const versions = versionsOf(userId, r.project)
  const counts = projectCounts(userId, r.project, Number(versions.at(-1)?.at ?? 0))
  const use: ProjectUse = {
    id: r.project,
    name: r.name,
    openedAt: Number(r.opened_at),
    credits: Number(r.credits),
    version: versions.length + 1,
    updates: { used: versions.length, included: PROJECT_SCOPE.updates + Number(r.extra_updates) },
    views: { used: counts.views, included: PROJECT_SCOPE.views + Number(r.extra_views) },
    photos: { used: counts.photos, included: PROJECT_SCOPE.photos + Number(r.extra_photos) },
  }
  if (admin) {
    use.aiImages = Number(
      getDb()
        .prepare(`SELECT COUNT(*) AS n FROM jobs j JOIN project_jobs p ON p.job_id = j.id WHERE p.user_id = ? AND p.project = ? AND j.status = 'consumed'`)
        .get(userId, r.project)?.n ?? 0,
    )
    use.flags = versions.filter(v => v.note).map(v => `${v.file ?? 'nouvelle version'} : ${v.note}`)
  }
  return use
}

/**
 * Inside reserveCredit's transaction: opens the project with its first AI image (one project of the pack), or checks the
 * image fits the project's scope. Throws CreditError with the sentence the person sees.
 */
function takeProjectRoom(userId: number, total: number, project: { id: string; name: string }, item: 'photo' | 'pano', viewLabel: string | null) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM forfait_projects WHERE user_id = ? AND project = ?').get(userId, project.id) as unknown as ProjectRow | undefined
  if (!row) {
    const used = Number(db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM forfait_projects WHERE user_id = ?').get(userId)?.n ?? 0)
    if (used + 1 > total) throw new CreditError(`Les ${plural(total, 'projet', 'projets')} de votre forfait sont utilisés. Contactez Roomia pour en ajouter.`, 402)
    db.prepare('INSERT INTO forfait_projects (user_id, project, name, opened_at) VALUES (?, ?, ?, ?)').run(userId, project.id, project.name || project.id, Date.now())
    writeLedger({ userId, kind: 'project', delta: 0, outcome: 'opened', detail: `Projet commencé : ${project.name || project.id}` })
    return
  }
  if (project.name && project.name !== row.name) db.prepare('UPDATE forfait_projects SET name = ? WHERE user_id = ? AND project = ?').run(project.name, userId, project.id)
  const use = projectUse(userId, row, false)
  if (use.updates.used > use.updates.included) {
    throw new CreditError(`Les ${use.updates.included} mises à jour incluses dans ce projet sont utilisées. Contactez Roomia pour en ajouter une. Rien n’a été décompté.`, 402)
  }
  const counts = projectCounts(userId, project.id, Number(versionsOf(userId, project.id).at(-1)?.at ?? 0))
  if (item === 'photo' && counts.photos >= use.photos.included) {
    throw new CreditError(`Les ${use.photos.included} photos HD incluses dans ce projet sont faites. Pour des photos en plus, contactez Roomia.`, 402)
  }
  if (item === 'pano' && viewLabel) {
    const known = db
      .prepare(
        `SELECT 1 FROM jobs j JOIN project_jobs p ON p.job_id = j.id WHERE p.user_id = ? AND p.project = ? AND j.view = ? AND j.created_at >= ? AND j.status IN ('reserved', 'consumed')`,
      )
      .get(userId, project.id, viewLabel.slice(0, 80), Number(versionsOf(userId, project.id).at(-1)?.at ?? 0))
    if (!known && counts.views >= use.views.included) {
      throw new CreditError(`Ce projet a ses ${use.views.included} points de vue 360° inclus. Pour un appartement plus grand (villa, duplex), contactez Roomia : c’est sur devis.`, 402)
    }
    // the same point finished again and again: a safety net far above normal use (2 tries per included point)
    if (counts.viewJobs >= use.views.included * 2) {
      throw new CreditError('Ce projet a été refait de nombreuses fois dans cette version. Contactez Roomia pour continuer.', 402)
    }
  }
}

/** A job failed: if it was the only image of a project it had just opened, the project goes back to the pack. */
function undoEmptyProject(userId: number, project: string, jobCreated: number) {
  const db = getDb()
  const row = db.prepare('SELECT name, opened_at FROM forfait_projects WHERE user_id = ? AND project = ?').get(userId, project)
  if (!row || Number(row.opened_at) < jobCreated - 5000) return
  const alive = db
    .prepare(`SELECT 1 FROM jobs j JOIN project_jobs p ON p.job_id = j.id WHERE p.user_id = ? AND p.project = ? AND j.status IN ('reserved', 'consumed')`)
    .get(userId, project)
  if (alive) return
  db.prepare('DELETE FROM forfait_projects WHERE user_id = ? AND project = ?').run(userId, project)
  writeLedger({ userId, kind: 'project-undo', delta: 0, outcome: 'failed', detail: `Projet rendu au forfait (première image en échec) : ${row.name}` })
}

/**
 * Admin: a pack was paid (or a correction, negative). The first pack turns the account into a projects forfait: an older
 * forfait (photos / 360 views) is replaced, and the projects it already finished with the AI are counted as started, so
 * nothing promised is lost and nothing is counted twice.
 */
export function addProjects(userId: number, n: number, reason: string, actorId: number, price?: number | null): Forfait {
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 1000) throw new CreditError('Nombre de projets invalide.', 400)
  const db = getDb()
  transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new CreditError('Compte introuvable.', 404)
    const total = projectsTotal(userId)
    if (total === null) {
      if (n < 0) throw new CreditError('Ce compte n’a pas encore de forfait projets.', 400)
      if (db.prepare(`SELECT 1 FROM jobs WHERE user_id = ? AND status = 'reserved'`).get(userId)) throw new CreditError('Une image est en cours sur ce compte : réessayez quand elle est finie.', 409)
      const old = db.prepare('SELECT since FROM forfaits WHERE user_id = ?').get(userId)
      if (old) {
        // the 360 jobs carry the project's scene id ("desktop:<id>"); each project the old forfait finished counts as started
        const done = db
          .prepare(
            `SELECT scene_id, MIN(created_at) AS first FROM jobs WHERE user_id = ? AND status = 'consumed' AND created_at >= ? AND scene_id LIKE 'desktop:%'
               AND (view LIKE '360 lumière · %' OR view LIKE '360 tuile · %') GROUP BY scene_id`,
          )
          .all(userId, Number(old.since))
        for (const d of done) {
          const id = String(d.scene_id).replace(/^desktop:/, '')
          db.prepare('INSERT OR IGNORE INTO forfait_projects (user_id, project, name, opened_at) VALUES (?, ?, ?, ?)').run(userId, id, id, Number(d.first))
        }
      }
      db.prepare('INSERT OR REPLACE INTO forfaits (user_id, label, items, since) VALUES (?, ?, ?, ?)').run(userId, 'Forfait projets', JSON.stringify({ project: n }), Date.now())
    } else {
      const used = Number(db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM forfait_projects WHERE user_id = ?').get(userId)?.n ?? 0)
      if (total + n < used) throw new CreditError(`Impossible : ${plural(used, 'projet est déjà commencé', 'projets sont déjà commencés')}.`, 400)
      db.prepare('UPDATE forfaits SET items = ? WHERE user_id = ?').run(JSON.stringify({ project: total + n }), userId)
    }
    const what = n > 0 ? `+${plural(n, 'projet', 'projets')}` : `${n} projet${n < -1 ? 's' : ''}`
    writeLedger({ userId, kind: n > 0 ? 'pack' : 'pack-adjust', delta: n, outcome: 'admin', detail: [what, price ? da(price) : '', reason.trim()].filter(Boolean).join(' · '), actorId })
  })
  return forfaitOf(userId)!
}

/** Admin changes to one started project: a quoted villa takes more projects, an extra update, a wider scope, or "don't count it". */
export function adjustProject(
  userId: number,
  project: string,
  change: { credits?: number; extraUpdates?: number; extraViews?: number; extraPhotos?: number; remove?: boolean },
  actorId: number,
) {
  const db = getDb()
  transaction(db, () => {
    const row = db.prepare('SELECT * FROM forfait_projects WHERE user_id = ? AND project = ?').get(userId, project) as unknown as ProjectRow | undefined
    if (!row) throw new CreditError('Projet introuvable.', 404)
    if (change.remove) {
      db.prepare('DELETE FROM forfait_projects WHERE user_id = ? AND project = ?').run(userId, project)
      // its images stay delivered; if the client works on it again, its next AI image opens it again
      db.prepare('DELETE FROM project_versions WHERE user_id = ? AND project = ?').run(userId, project)
      writeLedger({ userId, kind: 'project-admin', delta: 0, outcome: 'admin', detail: `Projet non compté : ${row.name}`, actorId })
      return
    }
    const int = (v: number | undefined, min: number, max: number, was: number) => {
      if (v === undefined) return was
      if (!Number.isInteger(v) || v < min || v > max) throw new CreditError('Valeur invalide.', 400)
      return v
    }
    const next = {
      credits: int(change.credits, 1, 20, Number(row.credits)),
      extra_updates: int(change.extraUpdates, 0, 50, Number(row.extra_updates)),
      extra_views: int(change.extraViews, 0, 200, Number(row.extra_views)),
      extra_photos: int(change.extraPhotos, 0, 500, Number(row.extra_photos)),
    }
    if (next.credits > Number(row.credits)) {
      const total = projectsTotal(userId) ?? 0
      const used = Number(db.prepare('SELECT COALESCE(SUM(credits), 0) AS n FROM forfait_projects WHERE user_id = ?').get(userId)?.n ?? 0)
      if (used - Number(row.credits) + next.credits > total) throw new CreditError('Pas assez de projets dans le forfait : ajoutez d’abord un pack.', 400)
    }
    db.prepare('UPDATE forfait_projects SET credits = ?, extra_updates = ?, extra_views = ?, extra_photos = ? WHERE user_id = ? AND project = ?').run(
      next.credits,
      next.extra_updates,
      next.extra_views,
      next.extra_photos,
      userId,
      project,
    )
    const parts = [
      next.credits !== Number(row.credits) ? `compte pour ${plural(next.credits, 'projet', 'projets')}` : '',
      next.extra_updates !== Number(row.extra_updates) ? `mises à jour en plus : ${next.extra_updates}` : '',
      next.extra_views !== Number(row.extra_views) ? `points 360° en plus : ${next.extra_views}` : '',
      next.extra_photos !== Number(row.extra_photos) ? `photos en plus : ${next.extra_photos}` : '',
    ].filter(Boolean)
    if (parts.length) writeLedger({ userId, kind: 'project-admin', delta: 0, outcome: 'admin', detail: `${row.name} : ${parts.join(', ')}`, actorId })
  })
}

/**
 * The app is about to take a new version of a project (an update). Returns the refusal to show, or null when it may go on.
 * A project with no AI image yet is not started: its versions are free and not counted.
 */
export function projectUpdateRefusal(userId: number, project: string): string | null {
  const row = getDb().prepare('SELECT * FROM forfait_projects WHERE user_id = ? AND project = ?').get(userId, project) as unknown as ProjectRow | undefined
  if (!row) return null
  const use = projectUse(userId, row, false)
  if (use.updates.used >= use.updates.included) {
    return `Les ${use.updates.included} mises à jour incluses dans « ${row.name} » sont utilisées. Contactez Roomia pour en ajouter une (rien n’a été changé).`
  }
  return null
}

/** The app took a new version of a started project: one update. `note` says why it may be another apartment (admin only). */
export function recordProjectVersion(userId: number, project: string, file: string, note: string | null) {
  const db = getDb()
  const row = db.prepare('SELECT name FROM forfait_projects WHERE user_id = ? AND project = ?').get(userId, project)
  if (!row) return
  db.prepare('INSERT INTO project_versions (user_id, project, file, note, at) VALUES (?, ?, ?, ?, ?)').run(userId, project, file.slice(0, 200), note?.slice(0, 300) ?? null, Date.now())
  writeLedger({ userId, kind: 'project-update', delta: 0, outcome: 'update', detail: `Mise à jour de ${row.name} : ${file}` })
}
