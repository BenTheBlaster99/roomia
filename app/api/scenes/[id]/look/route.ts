import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { getLookState, quoteAi, startLookAi, startLookRender, stopLook } from '@/lib/look-pipeline'
import { setUserPause, thermalState } from '@/lib/blender-guard'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — the state of the scene's "Présentation" job (the look pipeline): stage, step, suggestions, the AI job's progress. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if ((await readMeta(id))?.status !== 'ready') return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  return Response.json({ ...(await getLookState(id)), thermal: thermalState() })
}

const ints = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 200) : [])

/**
 * POST — { action: 'render' }  free: the golden-hour 360 tour of every point (Blender only).
 *        { action: 'pause' | 'resume' }  "pause after this point": the point in progress finishes, the next one waits (any render of this PC).
 *        { action: 'stop' }  stops the job now (Blender killed; the AI tiles already made are kept).
 *        { action: 'quote', points, ring }  nothing is sent: the images and the cost.
 *        { action: 'ai', points, ring, maxCost }  paid: the AI finishing of those points; refused unless maxCost covers the cost.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if ((await readMeta(id))?.status !== 'ready') return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { action?: unknown; points?: unknown; ring?: unknown; maxCost?: unknown } | null
  try {
    if (body?.action === 'render') return Response.json(await startLookRender(id))
    if (body?.action === 'stop') return Response.json(await stopLook(id))
    if (body?.action === 'pause' || body?.action === 'resume') {
      setUserPause(body.action === 'pause')
      return Response.json(thermalState())
    }
    const points = ints(body?.points)
    const ring = ints(body?.ring).filter(p => points.includes(p))
    if (body?.action === 'quote') return Response.json(quoteAi(points, ring))
    if (body?.action === 'ai') return Response.json(await startLookAi(id, points, ring, Number(body.maxCost)))
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : 'Erreur.' }, { status: 400 })
  }
  return Response.json({ detail: 'Requête incomplète.' }, { status: 400 })
}
