import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { readVideo, startVideoBuild } from '@/lib/scene-video'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — the scene's video walkthrough (when made) and the status of its build. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if ((await readMeta(id))?.status !== 'ready') return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  return Response.json(await readVideo(id))
}

/** POST — films the video walkthrough in the background, through the tour's points (free: Blender only). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if ((await readMeta(id))?.status !== 'ready') return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  try {
    return Response.json({ status: await startVideoBuild(id) })
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
