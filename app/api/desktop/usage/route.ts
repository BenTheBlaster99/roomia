import { NextRequest } from 'next/server'
import { recordForfaitUse } from '@/lib/credits'
import { bearerUser, cloudOff, desktopCloudEnabled, notSignedIn } from '@/lib/desktop-cloud'

export const runtime = 'nodejs'

/**
 * POST { item: 'update', detail } — Roomia Desktop reports a free use its forfait counts (lib/forfait.ts): a new version
 * of a project. Counted only, never refused: the app does the work on its own PC whatever the answer.
 */
export async function POST(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const body = (await req.json().catch(() => null)) as { item?: unknown; detail?: unknown } | null
  if (body?.item !== 'update') return Response.json({ detail: 'Requête incomplète.' }, { status: 400 })
  recordForfaitUse(user.id, 'update', String(body.detail ?? ''))
  return Response.json({ ok: true })
}
