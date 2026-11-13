import { NextRequest } from 'next/server'
import { adminDenied } from '@/lib/access-guard'
import { getUser, setPassword } from '@/lib/auth'
import { adjustCredits, CreditError, removeForfait, setForfait } from '@/lib/credits'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST — one change to an account:
 *   { action: 'credits', delta, reason }   add (positive) or remove (negative) credits
 *   { action: 'forfait', label, photo, pano, plan2d, plan3d, update }   gives a forfait (lib/forfait.ts), replacing any other
 *   { action: 'forfait-remove' }            back to plain credits
 *   { action: 'suspend' } / { action: 'activate' }
 *   { action: 'password', password }        sets a new password and signs the account out everywhere
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = adminDenied(req)
  if ('denied' in check) return check.denied
  const id = Number((await params).id)
  const target = Number.isInteger(id) ? getUser(id) : null
  if (!target) return Response.json({ detail: 'Compte introuvable.' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const db = getDb()
  try {
    switch (body?.action) {
      case 'credits':
        return Response.json({ ok: true, credits: adjustCredits(id, Number(body.delta), String(body.reason ?? ''), check.user.id) })
      case 'forfait': {
        const n = (k: string) => Math.max(0, Math.round(Number(body[k] ?? 0)) || 0)
        const label = String(body.label ?? '').trim().slice(0, 60) || 'Projet'
        const forfait = setForfait(id, label, { photo: n('photo'), pano: n('pano'), plan2d: n('plan2d'), plan3d: n('plan3d'), update: n('update') }, check.user.id)
        return Response.json({ ok: true, forfait })
      }
      case 'forfait-remove':
        removeForfait(id)
        return Response.json({ ok: true })
      case 'suspend':
        if (id === check.user.id) return Response.json({ detail: 'Vous ne pouvez pas suspendre votre propre compte.' }, { status: 400 })
        db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(id)
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
        return Response.json({ ok: true })
      case 'activate':
        db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(id)
        return Response.json({ ok: true })
      case 'password':
        setPassword(id, String(body.password ?? ''))
        return Response.json({ ok: true })
      default:
        return Response.json({ detail: 'Action inconnue.' }, { status: 400 })
    }
  } catch (err) {
    const status = err instanceof CreditError ? err.status : 400
    return Response.json({ detail: err instanceof Error ? err.message : 'Modification impossible' }, { status })
  }
}
