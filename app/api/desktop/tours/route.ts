import { NextRequest } from 'next/server'
import { bearerUser, cloudOff, desktopCloudEnabled, notSignedIn } from '@/lib/desktop-cloud'
import { DriveError, listDriveTours, PUBLISH_CHUNK_BYTES, startPublish } from '@/lib/desktop-drive'

export const runtime = 'nodejs'

/** GET — the tours this desktop account published (Roomia's server, "Mon espace"). */
export async function GET(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  return Response.json({ tours: await listDriveTours(user.id) })
}

/**
 * POST { title, from, id? } — starts publishing a tour built on the architect's PC: a new link, or the same link
 * again with `id`. Then PUT each file in pieces to /api/desktop/tours/:id, then POST …/finish.
 */
export async function POST(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const body = (await req.json().catch(() => null)) as { title?: unknown; from?: unknown; id?: unknown } | null
  try {
    const { id } = await startPublish(user.id, String(body?.title ?? 'Visite'), String(body?.from ?? ''), typeof body?.id === 'string' ? body.id : undefined)
    return Response.json({ id, chunk: PUBLISH_CHUNK_BYTES })
  } catch (err) {
    if (err instanceof DriveError) return Response.json({ detail: err.message }, { status: err.status })
    throw err
  }
}
