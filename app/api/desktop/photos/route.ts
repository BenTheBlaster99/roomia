import { NextRequest } from 'next/server'
import { bearerUser, cloudOff, desktopCloudEnabled, notSignedIn } from '@/lib/desktop-cloud'
import { listDrivePhotos } from '@/lib/desktop-drive'

export const runtime = 'nodejs'

/** GET — every AI photo delivered to this desktop account, newest first (Roomia's server, "Mon espace"). */
export async function GET(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  return Response.json({ photos: listDrivePhotos(user.id) })
}
