import { getDb, transaction } from './db'
import { FORFAIT_LABELS, plural, type Forfait, type ForfaitItemKey } from './forfait'

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
export function reserveCredit(userId: number, jobId: string, sceneId: string, view: string, item: 'photo' | 'pano' = 'photo') {
  const db = getDb()
  transaction(db, () => {
    const forfait = forfaitOf(userId)
    if (forfait) {
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
    if (existing) {
      throw new CreditError(
        existing.status === 'consumed'
          ? 'Cette photo a déjà été produite : elle est dans « Mes photos ».'
          : existing.status === 'reserved'
            ? 'Cette photo est déjà en cours.'
            : 'Cette demande a déjà été traitée. Relancez la photo.',
        409,
      )
    }
    const taken = db.prepare(`UPDATE users SET credits = credits - 1 WHERE id = ? AND credits >= 1 AND status = 'active'`).run(userId)
    if (Number(taken.changes) !== 1) {
      throw new CreditError('Plus de crédits sur ce compte. Contactez Roomia pour recharger.', 402)
    }
    db.prepare(`INSERT INTO jobs (id, user_id, scene_id, view, status, pid, created_at) VALUES (?, ?, ?, ?, 'reserved', ?, ?)`).run(
      jobId,
      userId,
      sceneId,
      view.slice(0, 80),
      process.pid,
      Date.now(),
    )
    writeLedger({ userId, jobId, kind: 'reserve', delta: -1, outcome: 'reserved', detail: `${sceneId} · ${view}` })
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
    const userId = Number(db.prepare('SELECT user_id FROM jobs WHERE id = ?').get(jobId)?.user_id)
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
    if (decision === 'refund') db.prepare('UPDATE users SET credits = credits + 1 WHERE id = ?').run(userId)
    writeLedger({
      userId,
      jobId: String(claim.job_id),
      kind: decision === 'refund' ? 'refund' : 'claim-denied',
      delta: decision === 'refund' ? 1 : 0,
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
export function forfaitOf(userId: number): Forfait | null {
  const db = getDb()
  const row = db.prepare('SELECT label, items, since FROM forfaits WHERE user_id = ?').get(userId)
  if (!row) return null
  const totals = JSON.parse(String(row.items)) as Partial<Record<ForfaitItemKey, number>>
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
  const used: Record<ForfaitItemKey, number> = { photo: jobs(false), pano: jobs(true), plan2d: 0, plan3d: 0, update: usage('update') }
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
