import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { listFaceReviews, saveFaceLabel, type FaceLabel } from '@/lib/scene-tour'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — the faces of the photo-quality runs (capture, AI result, scores, decision) with their labels. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  return Response.json({ faces: await listFaceReviews(id) })
}

/** POST { run, index, face, eligible?, result?, reasons? } — one reviewer label. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as FaceLabel | null
  if (!body) return Response.json({ detail: 'Requête invalide' }, { status: 400 })
  try {
    return Response.json({ label: await saveFaceLabel(id, body) })
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : 'Requête invalide' }, { status: 400 })
  }
}
