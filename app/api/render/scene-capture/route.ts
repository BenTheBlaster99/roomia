import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { BlenderRenderError } from '@/lib/blender-render'
import { getCapture, parseCaptureRequest } from '@/lib/scene-capture'
import { isSceneId, readCameras, readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'
// Vercel Hobby allows at most 300 seconds on a function.
export const maxDuration = 300

/**
 * POST — free check of a view: the Blender capture alone, no image generation. Same body as
 * /api/render/scene-photo; the capture is kept, so generating the photo right after reuses it.
 */
export async function POST(req: NextRequest) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sceneId = String(body?.sceneId ?? '')
  const meta = isSceneId(sceneId) ? await readMeta(sceneId) : null
  if (!meta || meta.status !== 'ready') {
    return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  }
  const request = parseCaptureRequest(body, await readCameras(sceneId))
  if (typeof request === 'string') return Response.json({ detail: request }, { status: 400 })

  try {
    const capture = await getCapture(sceneId, request)
    console.log(`scene-capture ${sceneId} ${request.name}: ${capture.reused ? 'reused' : `${capture.seconds.toFixed(1)}s`}`)
    return new Response(new Uint8Array(capture.png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Render-Seconds': capture.seconds.toFixed(1) },
    })
  } catch (err) {
    const status = err instanceof BlenderRenderError ? err.status : 500
    const detail = err instanceof BlenderRenderError ? err.message : 'La capture de la vue a échoué.'
    return Response.json({ detail }, { status })
  }
}
