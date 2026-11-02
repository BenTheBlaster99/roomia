import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { PANO_REJECT_REASONS } from '@/lib/pano-review'
import { editTourPoint, readTour, reviewTourAi, startMirrorRepair, startNewVersion, startTourAi, startTourBuild, startTourUpdate, TOUR_AI_LIGHTS, type TourAiLight } from '@/lib/scene-tour'
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
 * With { ai: [viewIndex, …] }: makes those viewpoints’ 360° photoreal (paid: 1 image each).
 * With { review: { index, approve, reason? } }: approves an AI 360° (clients then see it) or rejects it (reason: PANO_REJECT_REASONS).
 * With { point: { index, hidden?, startYaw? } }: removes a point from the tour, or sets where its 360° starts.
 * With { newVersion: sceneId }: a new version of the file, uploaded as a scene of its own, replaces this scene's file;
 * the tour is rebuilt and finds what changed (free).
 * With { update: true }: remakes only the AI 360° faces and the photos that see what the new version changed (paid).
 * With { mirrors: true }: puts the real mirrors back into AI 360° views not approved yet (free).
 * With { complete: true, light? }: the build, then every stop in photo quality (paid, 1 image per stop).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if ((await readMeta(id))?.status !== 'ready') return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as {
    ai?: unknown
    light?: unknown
    review?: { index?: unknown; approve?: unknown; reason?: unknown }
    point?: { index?: unknown; hidden?: unknown; startYaw?: unknown }
    newVersion?: unknown
    update?: unknown
    mirrors?: unknown
    complete?: unknown
    bake?: unknown
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
      const reason = PANO_REJECT_REASONS.find(r => r === body.review?.reason)
      await reviewTourAi(id, Number(body.review.index), body.review.approve === true, reason)
      return Response.json(await readTour(id, { review: true }))
    }
    if (typeof body?.newVersion === 'string') {
      // The new version must be reachable by the same person (its owner, with accounts on).
      const deniedFrom = await accessDenied(req, body.newVersion)
      if (deniedFrom) return deniedFrom
      return Response.json({ status: await startNewVersion(id, body.newVersion) })
    }
    if (body?.update === true) return Response.json({ status: await startTourUpdate(id) })
    if (body?.mirrors === true) return Response.json({ status: await startMirrorRepair(id) })
    if (Array.isArray(body?.ai)) {
      const light: TourAiLight = TOUR_AI_LIGHTS.find(l => l === body.light) ?? 'soleil'
      return Response.json({ status: await startTourAi(id, body.ai.map(Number), light) })
    }
    if (body?.complete === true) {
      const light: TourAiLight = TOUR_AI_LIGHTS.find(l => l === body.light) ?? 'soleil'
      return Response.json({ status: await startTourBuild(id, { photoQuality: light }) })
    }
    // {bake: true}: the build also bakes the free walk's light (experiment, 2 Nov)
    return Response.json({ status: await startTourBuild(id, body?.bake === true ? { bakeExplorer: true } : {}) })
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
