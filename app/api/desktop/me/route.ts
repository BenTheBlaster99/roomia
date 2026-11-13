import { NextRequest } from 'next/server'
import { forfaitOf } from '@/lib/credits'
import { getDb } from '@/lib/db'
import { bearerUser, cloudOff, desktopCloudEnabled, notSignedIn } from '@/lib/desktop-cloud'

export const runtime = 'nodejs'

/** GET — the desktop app's account: name, credits (or its forfait, lib/forfait.ts), and its last credit movements (Roomia's server). */
export async function GET(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const ledger = getDb()
    .prepare('SELECT at, kind, delta, balance_after, outcome, detail FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100')
    .all(user.id)
  return Response.json({ user: { login: user.login, name: user.name, role: user.role, credits: user.credits, forfait: forfaitOf(user.id) }, ledger })
}
