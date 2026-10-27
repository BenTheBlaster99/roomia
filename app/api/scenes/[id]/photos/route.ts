import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { listPhotos } from '@/lib/scene-photos'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — every finished photo of the scene, newest first (the gallery: nothing is lost if the browser leaves). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  return Response.json({ photos: await listPhotos(id) })
}
