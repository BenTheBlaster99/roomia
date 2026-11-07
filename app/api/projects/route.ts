import { statfs } from 'node:fs/promises'
import { desktopMode, listProjects } from '@/lib/desktop-projects'
import { SCENES_DIR } from '@/lib/scene-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — Roomia Desktop: the projects on this PC, newest first, and the free disk space where they are kept. */
export async function GET() {
  if (!desktopMode()) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  const disk = await statfs(SCENES_DIR).catch(() => null)
  return Response.json({
    projects: await listProjects(),
    freeBytes: disk ? disk.bavail * disk.bsize : null,
    folder: SCENES_DIR,
  })
}
