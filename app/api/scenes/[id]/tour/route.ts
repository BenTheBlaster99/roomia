import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { editTourPoint, readTour, reviewTourAi, startTourAi, startTourBuild, TOUR_AI_LIGHTS, type TourAiLight } from '@/lib/scene-tour'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — the scene's tour: each saved view with its latest photo and its 360° panorama, the plan, and the build status. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if ((await readMeta(id))?.status !== 'ready') return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  // ?edit=1: the reviewer also sees AI 360° views that are not approved yet.
  return Response.json(await readTour(id, { review: req.nextUrl.searchParams.get('edit') === '1' }))
}

/**
 * POST — renders the panoramas and the plan in the background (free: Blender only, no image service).
 * With { ai: [viewIndex, …] }: makes those viewpoints' 360° photoreal (paid: up to 5 images each).
 * With { review: { index, approve } }: approves an AI 360° (clients then see it) or rejects it.
 * With { point: { index, hidden?, startYaw? } }: removes a point from the tour, or sets where its 360° starts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if ((await readMeta(id))?.status !== 'ready') return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as {
    ai?: unknown
    light?: unknown
    review?: { index?: unknown; approve?: unknown }
    point?: { index?: unknown; hidden?: unknown; startYaw?: unknown }
  } | null
  try {
    if (body?.point) {
      const { index, hidden, startYaw } = body.point
      await editTourPoint(id, Number(index), {
        hidden: typeof hidden === 'boolean' ? hidden : undefined,
        startYaw: startYaw === null ? null : typeof startYaw === 'number' ? startYaw : undefined,
      })
      return Response.json(await readTour(id, { review: true }))
    }
    if (body?.review) {
      await reviewTourAi(id, Number(body.review.index), body.review.approve === true)
      return Response.json(await readTour(id, { review: true }))
    }
    if (Array.isArray(body?.ai)) {
      const light: TourAiLight = TOUR_AI_LIGHTS.find(l => l === body.light) ?? 'soleil'
      return Response.json({ status: await startTourAi(id, body.ai.map(Number), light) })
    }
    return Response.json({ status: await startTourBuild(id) })
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
