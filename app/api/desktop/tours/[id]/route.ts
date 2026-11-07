import { NextRequest } from 'next/server'
import { bearerUser, cloudOff, desktopCloudEnabled, notSignedIn } from '@/lib/desktop-cloud'
import { DriveError, putPublishChunk, unpublish } from '@/lib/desktop-drive'

export const runtime = 'nodejs'
export const maxDuration = 300

/** PUT ?path=tour/pano-1.jpg&offset=0 — one piece of one file of a tour being published. Answers the size received. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const { id } = await params
  const rel = req.nextUrl.searchParams.get('path') ?? ''
  const offset = Number(req.nextUrl.searchParams.get('offset') ?? NaN)
  if (!Number.isInteger(offset) || offset < 0 || !req.body) return Response.json({ detail: 'Requête incomplète.' }, { status: 400 })
  try {
    return Response.json({ size: await putPublishChunk(user.id, id, rel, offset, req.body) })
  } catch (err) {
    if (err instanceof DriveError) return Response.json({ detail: err.message }, { status: err.status })
    throw err
  }
}

/** DELETE — removes a published tour: its link stops working. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const { id } = await params
  try {
    await unpublish(user.id, id)
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof DriveError) return Response.json({ detail: err.message }, { status: err.status })
    throw err
  }
}
