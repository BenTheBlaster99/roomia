import { readFile } from 'node:fs/promises'
import { NextRequest } from 'next/server'
import { isJobId } from '@/lib/credits'
import { getDb } from '@/lib/db'
import { bearerUser, cloudOff, desktopCloudEnabled, desktopPhotoPath, notSignedIn } from '@/lib/desktop-cloud'

export const runtime = 'nodejs'

/** GET — one delivered photo of this account (JPEG). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const { job } = await params
  const row = isJobId(job) ? getDb().prepare("SELECT 1 FROM jobs WHERE id = ? AND user_id = ? AND status = 'consumed'").get(job, user.id) : null
  const image = row ? await readFile(desktopPhotoPath(user.id, job)).catch(() => null) : null
  if (!image) return Response.json({ detail: 'Photo introuvable.' }, { status: 404 })
  return new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' } })
}
