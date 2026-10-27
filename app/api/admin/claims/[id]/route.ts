import { NextRequest } from 'next/server'
import { adminDenied } from '@/lib/access-guard'
import { CreditError, decideClaim } from '@/lib/credits'

export const runtime = 'nodejs'

/** POST { decision: 'refund' | 'deny', note } — the admin's answer to a fidelity report. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = adminDenied(req)
  if ('denied' in check) return check.denied
  const id = Number((await params).id)
  const body = (await req.json().catch(() => null)) as { decision?: unknown; note?: unknown } | null
  if (body?.decision !== 'refund' && body?.decision !== 'deny') return Response.json({ detail: 'Décision invalide.' }, { status: 400 })
  try {
    decideClaim(id, body.decision, String(body.note ?? ''), check.user.id)
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof CreditError) return Response.json({ detail: err.message }, { status: err.status })
    throw err
  }
}
