import { getDb, transaction } from './db'

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
export function reserveCredit(userId: number, jobId: string, sceneId: string, view: string) {
  const db = getDb()
  transaction(db, () => {
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
