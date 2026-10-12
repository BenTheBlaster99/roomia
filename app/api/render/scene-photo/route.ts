import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { BlenderRenderError, renderSceneView, viewFromSceneCamera } from '@/lib/blender-render'
import { getOpenAIClient } from '@/lib/openai-client'
import { generatePhotoreal, renderErrorDetail } from '@/lib/photoreal'
import { RENDER_LIMIT_MESSAGE, takeRenderSlot } from '@/lib/render-limit'
import { isTimeOfDay, type Lighting } from '@/lib/render-lighting'
import { buildSceneRenderPrompt } from '@/lib/scene-render-prompt'
import { isSceneId, readCameras, readMeta, sceneDir, sourcePath } from '@/lib/scene-store'

export const runtime = 'nodejs'
export const maxDuration = 300

interface Body {
  sceneId?: unknown
  cameraIndex?: unknown
  time?: unknown
  sun?: unknown
}

/**
 * POST — photo of one of the scene's saved views: Blender captures the view from the full file
 * (exact camera, real textures), then GPT Image turns the capture into a photograph, keeping the
 * design. Streams progress as NDJSON; every run is logged to <scene>/runs.jsonl.
 */
export async function POST(req: NextRequest) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const body = (await req.json().catch(() => null)) as Body | null
  const sceneId = String(body?.sceneId ?? '')
  const cameraIndex = Number(body?.cameraIndex)
  const lighting: Lighting = {
    time: isTimeOfDay(body?.time) ? body.time : 'midi',
    sun: body?.sun !== false,
  }

  const meta = isSceneId(sceneId) ? await readMeta(sceneId) : null
  if (!meta || meta.status !== 'ready') {
    return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  }
  const cameras = await readCameras(sceneId)
  const camera = Number.isInteger(cameraIndex) ? cameras[cameraIndex] : undefined
  if (!camera) return Response.json({ detail: 'Vue enregistrée introuvable.' }, { status: 400 })
  try {
    getOpenAIClient()
  } catch (err) {
    return Response.json({ detail: renderErrorDetail(err) }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
      }
      const started = performance.now()
      const run: Record<string, unknown> = {
        at: new Date().toISOString(),
        view: camera.name,
        time: lighting.time,
        sun: lighting.sun,
      }

      try {
        send({ type: 'progress', step: 'capturing', label: 'Étape 1 · Capture', detail: `${camera.name} depuis le fichier complet…`, pct: 10 })
        const capture = await renderSceneView(sourcePath(sceneId), viewFromSceneCamera(camera), lighting)
        run.captureSeconds = Number(capture.seconds.toFixed(1))
        send({ type: 'capture', capture_base64: capture.png.toString('base64'), seconds: run.captureSeconds })

        send({ type: 'progress', step: 'generating', label: 'Étape 2 · Photo', detail: 'Génération de la photo (environ 1 à 2 minutes)…', pct: 35 })
        if (!takeRenderSlot()) throw new Error(RENDER_LIMIT_MESSAGE)
        const photo = await generatePhotoreal(capture.png, buildSceneRenderPrompt(lighting))
        run.photoSeconds = Number(photo.seconds.toFixed(1))
        run.quality = photo.quality
        run.size = photo.size

        run.totalSeconds = Number(((performance.now() - started) / 1000).toFixed(1))
        run.ok = true
        send({ type: 'progress', step: 'results', label: 'Étape 3 · Résultat', detail: 'Terminé', pct: 100 })
        send({
          type: 'done',
          result_base64: photo.base64,
          timings: { capture: run.captureSeconds, photo: run.photoSeconds, total: run.totalSeconds },
        })
      } catch (err: unknown) {
        console.error('render/scene-photo error:', err)
        const detail = err instanceof BlenderRenderError ? err.message : renderErrorDetail(err)
        run.ok = false
        run.error = detail
        run.totalSeconds = Number(((performance.now() - started) / 1000).toFixed(1))
        send({ type: 'error', detail })
      } finally {
        await appendFile(path.join(sceneDir(sceneId), 'runs.jsonl'), `${JSON.stringify(run)}\n`).catch(() => undefined)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  })
}
