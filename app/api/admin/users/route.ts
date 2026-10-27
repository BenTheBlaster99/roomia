import { NextRequest } from 'next/server'
import { adminDenied } from '@/lib/access-guard'
import { createUser } from '@/lib/auth'
import { adjustCredits } from '@/lib/credits'

export const runtime = 'nodejs'

/** POST { login, name, password, credits?, role? } — a new office or freelancer account. */
export async function POST(req: NextRequest) {
  const check = adminDenied(req)
  if ('denied' in check) return check.denied
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const user = createUser({
      login: String(body?.login ?? '').trim(),
      name: String(body?.name ?? ''),
      password: String(body?.password ?? ''),
      role: body?.role === 'admin' ? 'admin' : 'user',
    })
    const credits = Number(body?.credits ?? 0)
    if (Number.isInteger(credits) && credits > 0) adjustCredits(user.id, credits, String(body?.reason ?? 'Crédits initiaux'), check.user.id)
    return Response.json({ ok: true, id: user.id })
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : 'Création impossible' }, { status: 400 })
  }
}
