import { NextRequest } from 'next/server'
import { adminDenied } from '@/lib/access-guard'
import { forfaitOf } from '@/lib/credits'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'

/** GET — accounts with balances and usage, the latest ledger entries, and the fidelity reports. */
export async function GET(req: NextRequest) {
  const check = adminDenied(req)
  if ('denied' in check) return check.denied
  const db = getDb()
  const users = db
    .prepare(
      `SELECT u.id, u.login, u.name, u.role, u.status, u.credits, u.created_at,
         (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.status = 'consumed') AS delivered,
         (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.status = 'released') AS failed,
         (SELECT MAX(at) FROM ledger l WHERE l.user_id = u.id) AS last_activity
       FROM users u ORDER BY u.created_at DESC`,
    )
    .all()
  const ledger = db
    .prepare(
      `SELECT l.id, l.at, l.kind, l.delta, l.balance_after, l.outcome, l.detail, l.job_id, u.login, a.login AS actor
       FROM ledger l JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
       ORDER BY l.id DESC LIMIT 300`,
    )
    .all()
  const claims = db
    .prepare(
      `SELECT c.id, c.created_at, c.status, c.reason, c.note, c.scene_id, c.photo_file, c.job_id, u.login
       FROM claims c JOIN users u ON u.id = c.user_id ORDER BY (c.status = 'pending') DESC, c.id DESC LIMIT 100`,
    )
    .all()
  return Response.json({ users: users.map(u => ({ ...u, forfait: forfaitOf(Number(u.id)) })), ledger, claims })
}
