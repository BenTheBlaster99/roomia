import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { BlenderRenderError } from '@/lib/blender-render'
import { getOpenAIClient } from '@/lib/openai-client'
import { generatePhotoreal, PhotoChoiceError, renderErrorDetail } from '@/lib/photoreal'
import { RENDER_LIMIT_MESSAGE, takeRenderSlot } from '@/lib/render-limit'
import { getCapture, parseCaptureRequest } from '@/lib/scene-capture'
import { buildSceneRenderPrompt } from '@/lib/scene-render-prompt'
import { isSceneId, readCameras, readMeta, sceneDir } from '@/lib/scene-store'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST — photo of one of the scene's saved views: Blender captures the view from the full file
 * (exact camera, real textures), then GPT Image turns the capture into a photograph, keeping the
 * design. Streams progress as NDJSON; every run is logged to <scene>/runs.jsonl.
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
  const { lighting, lens } = request
  const camera = { name: request.name }
  // The Studio sends ask:true: when the image service is slow or down, it asks the user instead of
  // retrying on its own. quality:'medium' is the answer "continue in medium quality".
  const ask = body?.ask === true
  const quality = body?.quality === 'medium' ? 'medium' : undefined
  try {
    getOpenAIClient()
  } catch (err) {
    return Response.json({ detail: renderErrorDetail(err) }, { status: 500 })
  }

  const encoder = new TextEncoder()
  let open = true
  const stream = new ReadableStream({
    async start(controller) {
      // The browser may leave mid-render (reload, dropped connection); then there is nobody to send to.
      const send = (payload: Record<string, unknown>) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
        } catch {
          open = false
        }
      }
      // Cloudflare cuts a connection that stays silent for ~100 s, and the photo step is silent for
      // 100-120 s. A small ping every 10 s keeps the stream alive.
      const heartbeat = setInterval(() => send({ type: 'ping' }), 10_000)
      const started = performance.now()
      const run: Record<string, unknown> = {
        at: new Date().toISOString(),
        view: camera.name,
        time: lighting.time,
        sun: lighting.sun,
        interior: lighting.interior,
        lens,
      }

      try {
        send({ type: 'progress', step: 'capturing', label: 'Étape 1 · Capture', detail: `${camera.name} depuis le fichier complet…`, pct: 10 })
        // A capture made by "Vérifier la vue" (or a failed attempt) with the same settings is reused.
        const capture = await getCapture(sceneId, request)
        run.captureSeconds = Number(capture.seconds.toFixed(1))
        run.captureReused = capture.reused
        send({ type: 'capture', capture_base64: capture.png.toString('base64'), seconds: run.captureSeconds })

        send({ type: 'progress', step: 'generating', label: 'Étape 2 · Photo', detail: 'Génération de la photo (environ 1 à 2 minutes)…', pct: 35 })
        if (!takeRenderSlot()) throw new Error(RENDER_LIMIT_MESSAGE)
        // Cloudflare drops a stream that stays silent for ~100s. The photo call is longer than that.
        const beat = setInterval(() => {
          try {
            send({ type: 'ping' })
          } catch {
            clearInterval(beat)
          }
        }, 15_000)
        const photo = await generatePhotoreal(capture.png, buildSceneRenderPrompt(lighting), { ask, quality }).finally(() => clearInterval(beat))
        run.photoSeconds = Number(photo.seconds.toFixed(1))
        // Keep every finished photo on disk: it was paid for, even if the browser never receives it.
        const photoName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${camera.name.replace(/\W+/g, '_')}`
        await mkdir(path.join(sceneDir(sceneId), 'photos'), { recursive: true })
        await writeFile(path.join(sceneDir(sceneId), 'photos', `${photoName}.jpg`), Buffer.from(photo.base64, 'base64'))
        await writeFile(path.join(sceneDir(sceneId), 'photos', `${photoName}-capture.png`), capture.png)
        run.photoFile = `photos/${photoName}.jpg`
        run.quality = photo.quality
        run.fellBack = photo.fellBack
        run.fidelity = photo.fidelity
        run.provider = photo.provider
        run.size = photo.size

        run.totalSeconds = Number(((performance.now() - started) / 1000).toFixed(1))
        run.ok = true
        send({ type: 'progress', step: 'results', label: 'Étape 3 · Résultat', detail: 'Terminé', pct: 100 })
        send({
          type: 'done',
          result_base64: photo.base64,
          timings: { capture: run.captureSeconds, photo: run.photoSeconds, total: run.totalSeconds },
          fellBack: photo.fellBack,
        })
      } catch (err: unknown) {
        if (err instanceof PhotoChoiceError) {
          // Not a failure: the capture is kept, so the user can continue in medium or hold this render.
          run.ok = false
          run.choice = err.reason
          run.error = `Choix proposé (${err.tried} : ${err.reason === 'slow' ? 'trop lent' : 'indisponible'})`
          run.totalSeconds = Number(((performance.now() - started) / 1000).toFixed(1))
          send({ type: 'choice', tried: err.tried, reason: err.reason, detail: err.detail })
          return
        }
        console.error('render/scene-photo error:', err)
        const detail = err instanceof BlenderRenderError ? err.message : renderErrorDetail(err)
        run.ok = false
        run.error = detail
        run.totalSeconds = Number(((performance.now() - started) / 1000).toFixed(1))
        send({ type: 'error', detail })
      } finally {
        clearInterval(heartbeat)
        await appendFile(path.join(sceneDir(sceneId), 'runs.jsonl'), `${JSON.stringify(run)}\n`).catch(() => undefined)
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
