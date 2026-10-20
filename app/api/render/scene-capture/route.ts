import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { BlenderRenderError } from '@/lib/blender-render'
import { getCapture, parseCaptureRequest } from '@/lib/scene-capture'
import { isSceneId, readCameras, readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'
// Vercel Hobby allows at most 300. Captures only run on the Studio PC (`next start` ignores this).
export const maxDuration = 300

/**
 * POST — free check of a view: the Blender capture alone, no image generation. Same body as
 * /api/render/scene-photo; the capture is kept, so generating the photo right after reuses it.
 * Streams NDJSON: Cloudflare (the Studio link) cuts a request that stays silent for 100 s and a
 * big scene takes longer to capture, so a ping goes out every 10 s, then the capture.
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

  const encoder = new TextEncoder()
  let open = true
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
        } catch {
          open = false
        }
      }
      const heartbeat = setInterval(() => send({ type: 'ping' }), 10_000)
      try {
        const capture = await getCapture(sceneId, request)
        console.log(`scene-capture ${sceneId} ${request.name}: ${capture.reused ? 'reused' : `${capture.seconds.toFixed(1)}s`}`)
        send({ type: 'done', capture_base64: capture.png.toString('base64'), seconds: capture.seconds, reused: capture.reused })
      } catch (err) {
        console.error('render/scene-capture error:', err)
        send({ type: 'error', detail: err instanceof BlenderRenderError ? err.message : 'La capture de la vue a échoué.' })
      } finally {
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // already closed by the client leaving
        }
      }
    },
    cancel() {
      open = false
    },
  })

  return new Response(stream, {
    // Served as an event stream: Cloudflare (the studio.room-ia.com link) passes those through at
    // once, while it held other streamed types until the end (no live progress, 18 Oct).
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
