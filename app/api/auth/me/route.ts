import { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/access-guard'
import { cloudMe, cloudMode } from '@/lib/roomia-cloud'

export const runtime = 'nodejs'

/** GET — the signed-in account (name, role, credits), or 401. */
export async function GET(req: NextRequest) {
  // Roomia Desktop: the account on Roomia's server (offline: 503, the Studio still works without photos IA)
  if (cloudMode()) {
    try {
      const account = await cloudMe()
      if (!account) return Response.json({ detail: 'Non connecté', desktop: true }, { status: 401 })
      return Response.json({ user: account, desktop: true })
    } catch (err) {
      return Response.json({ detail: err instanceof Error ? err.message : 'Serveur Roomia injoignable', desktop: true }, { status: 503 })
    }
  }
  const user = sessionUser(req)
  if (!user) return Response.json({ detail: 'Non connecté' }, { status: 401 })
  return Response.json({ user: { login: user.login, name: user.name, role: user.role, credits: user.credits } })
}
