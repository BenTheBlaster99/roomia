import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { consumeCredit, CreditError, isJobId, releaseCredit, reserveCredit } from '@/lib/credits'
import { getDb } from '@/lib/db'
import { bearerUser, cloudOff, desktopCloudEnabled, desktopPhotoPath, notSignedIn } from '@/lib/desktop-cloud'
import { getOpenAIClient } from '@/lib/openai-client'
import { checkDeliveredImage } from '@/lib/photo-check'
import { panoFacePrompt } from '@/lib/pano-ai'
import { editPanoLight, panoLightInput, panoLightReference } from '@/lib/pano-light'
import { generatePhotoreal, PhotoChoiceError, renderErrorDetail } from '@/lib/photoreal'
import { RENDER_LIMIT_MESSAGE, takeRenderSlot } from '@/lib/render-limit'
import { parseLighting } from '@/lib/scene-capture'
import { buildSceneRenderPrompt } from '@/lib/scene-render-prompt'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024

/**
 * POST — a Roomia Desktop app's paid photo (Roomia's server, lib/desktop-cloud.ts). The app rendered the view with
 * Blender on its own PC and sends the capture with the light asked for; the prompt is made here, the AI is called
 * here, and the credit follows lib/credits.ts: reserved, spent only once the photo is checked and saved, given back
 * on any failure.
 *
 * The job id makes a retry safe: the same id after the photo was delivered answers that photo again without charging
 * (the app lost the answer: crash, cut connection); while it is still being made, "pending". Streams NDJSON with a
 * ping every 10 s (Cloudflare cuts a silent link at ~100 s).
 */
export async function POST(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const jobId = body?.jobId
  if (!isJobId(jobId)) return Response.json({ detail: 'Requête incomplète.' }, { status: 400 })
  const view = String(body?.view ?? 'Vue').slice(0, 80)
  const project = String(body?.project ?? '').slice(0, 80)
  const lighting = parseLighting(body?.lighting as Record<string, unknown> | undefined)
  const ask = body?.ask === true
  // a 360 tile (lib/look-pipeline.ts): one square view of a panorama, edited with the face prompt; one credit like a photo
  const tile = body?.kind === 'tile'
  // "Blender + AI light" (lib/pano-light.ts): a whole 360 at 2:1 with the project's AI photo as house style; one credit
  const panoLight = body?.kind === 'pano-light'
  const reference = panoLight && typeof body?.reference_base64 === 'string' ? Buffer.from(body.reference_base64, 'base64') : null
  const quality = body?.quality === 'medium' ? 'medium' : undefined

  const job = getDb().prepare('SELECT user_id, status, photo_file FROM jobs WHERE id = ?').get(jobId)
  if (job && Number(job.user_id) !== user.id) return Response.json({ detail: 'Requête incomplète.' }, { status: 400 })
  if (job?.status === 'consumed') {
    // delivered before: the same photo again, nothing charged
    const image = await readFile(desktopPhotoPath(user.id, jobId)).catch(() => null)
    if (image) return ndjson([{ type: 'done', result_base64: image.toString('base64'), credits: user.credits, again: true }])
    return Response.json({ detail: 'Cette photo a déjà été produite.' }, { status: 409 })
  }
  if (job?.status === 'reserved') return ndjson([{ type: 'pending', detail: 'Photo en cours sur le serveur Roomia.' }])
  if (job) return Response.json({ detail: 'Cette demande a déjà été traitée. Relancez la photo.' }, { status: 409 })

  const capture = typeof body?.capture_base64 === 'string' ? Buffer.from(body.capture_base64, 'base64') : null
  if (!capture || capture.length < 10_000 || capture.length > MAX_CAPTURE_BYTES) {
    return Response.json({ detail: 'Capture manquante ou trop lourde.' }, { status: 400 })
  }
  if (user.credits < 1) return Response.json({ detail: 'Plus de crédits sur ce compte. Contactez Roomia pour recharger.' }, { status: 402 })
  try {
    getOpenAIClient()
  } catch (err) {
    return Response.json({ detail: renderErrorDetail(err) }, { status: 503 })
  }

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
      let reserved = false
      const started = performance.now()
      try {
        reserveCredit(user.id, jobId, `desktop:${project || 'projet'}`, panoLight ? `360 lumière · ${view}` : tile ? `360 tuile · ${view}` : view, panoLight || tile ? 'pano' : 'photo')
        reserved = true
        if (!takeRenderSlot()) throw new Error(RENDER_LIMIT_MESSAGE)
        // The photo is made and kept even if the app left: it is paid for, and a retry with the same id gets it.
        const photo = panoLight
          ? {
              base64: (await editPanoLight(await panoLightInput(capture), reference && reference.length > 1000 ? await panoLightReference(reference) : null)).toString('base64'),
              quality: 'high',
              fellBack: false,
              fidelity: 'high',
              provider: 'gateway',
              size: '2560x1280',
            }
          : tile
          ? await generatePhotoreal(capture, panoFacePrompt(), { ask, quality, size: '1536x1536', maxInput: 2048 })
          : await generatePhotoreal(capture, buildSceneRenderPrompt(lighting), { ask, quality })
        const image = Buffer.from(photo.base64, 'base64')
        const unusable = await checkDeliveredImage(image)
        if (unusable) throw new Error(`Le serveur d’images a renvoyé une image inutilisable (${unusable}). Aucun crédit n’est utilisé.`)
        const file = desktopPhotoPath(user.id, jobId)
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, image)
        consumeCredit(jobId, path.basename(file))
        reserved = false
        const credits = Number(getDb().prepare('SELECT credits FROM users WHERE id = ?').get(user.id)?.credits ?? 0)
        send({
          type: 'done',
          result_base64: photo.base64,
          credits,
          seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
          quality: photo.quality,
          fellBack: photo.fellBack,
          fidelity: photo.fidelity,
          provider: photo.provider,
          size: photo.size,
        })
      } catch (err) {
        if (reserved) releaseCredit(jobId, err instanceof Error ? err.message : String(err))
        if (err instanceof CreditError) send({ type: 'error', detail: err.message, status: err.status })
        else if (err instanceof PhotoChoiceError) send({ type: 'choice', tried: err.tried, reason: err.reason, detail: err.detail })
        else {
          console.error('desktop photo error:', err)
          send({ type: 'error', detail: renderErrorDetail(err) })
        }
      } finally {
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          // the app already left
        }
      }
    },
    cancel() {
      open = false
    },
  })
  return new Response(stream, { headers: STREAM_HEADERS })
}

const STREAM_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' }

function ndjson(events: Record<string, unknown>[]) {
  return new Response(events.map(e => JSON.stringify(e)).join('\n') + '\n', { headers: STREAM_HEADERS })
}
