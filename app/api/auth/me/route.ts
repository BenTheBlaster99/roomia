import { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/access-guard'

export const runtime = 'nodejs'

/** GET — the signed-in account (name, role, credits), or 401. */
export async function GET(req: NextRequest) {
  const user = sessionUser(req)
  if (!user) return Response.json({ detail: 'Non connecté' }, { status: 401 })
  return Response.json({ user: { login: user.login, name: user.name, role: user.role, credits: user.credits } })
}
