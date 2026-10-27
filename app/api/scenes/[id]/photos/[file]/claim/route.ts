import { NextRequest } from 'next/server'
import { accessDenied, sessionUser } from '@/lib/access-guard'
import { CreditError, fileClaim } from '@/lib/credits'
import { PHOTO_FILE } from '@/lib/scene-photos'

export const runtime = 'nodejs'

/**
 * POST { reason } — "this photo doesn't respect my design". Recorded for review; an admin decides
 * whether to refund the credit. One report per photo, within 7 days, only for photos this account paid.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params
  const user = sessionUser(req)
  if (!user) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!PHOTO_FILE.test(file)) return Response.json({ detail: 'Photo introuvable' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null
  try {
    fileClaim(user.id, id, file, String(body?.reason ?? ''))
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof CreditError) return Response.json({ detail: err.message }, { status: err.status })
    throw err
  }
}
