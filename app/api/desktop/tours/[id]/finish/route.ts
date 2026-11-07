import { NextRequest } from 'next/server'
import { bearerUser, cloudOff, desktopCloudEnabled, notSignedIn } from '@/lib/desktop-cloud'
import { DriveError, finishPublish } from '@/lib/desktop-drive'

export const runtime = 'nodejs'

/** POST { files: [{ path, bytes }] } — the upload is complete: checks it and opens the tour to its link. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { files?: { path?: unknown; bytes?: unknown }[] } | null
  const files = Array.isArray(body?.files) ? body.files.map(f => ({ path: String(f?.path ?? ''), bytes: Number(f?.bytes ?? -1) })) : []
  try {
    const done = await finishPublish(user.id, id, files)
    return Response.json({ ...done, url: `/studio/tour/${id}` })
  } catch (err) {
    if (err instanceof DriveError) return Response.json({ detail: err.message }, { status: err.status })
    throw err
  }
}
