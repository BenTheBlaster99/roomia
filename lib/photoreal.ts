import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { toFile } from 'openai'
import { extractImageBase64 } from './extract-image-b64'
import { loadSharp } from './load-sharp'
import OpenAI from 'openai'
import { GPT_IMAGE_MODEL, getBackupImageClient, getOpenAIClient } from './openai-client'

/**
 * The image gateway sits behind Cloudflare, which drops requests that take over ~100 s (HTTP
 * 524), though high quality has also finished in ~115 s. Default is high; set
 * RENDER_IMAGE_QUALITY=medium (about 70 s) if it times out.
 */
export const IMAGE_QUALITY = ['low', 'medium', 'high'].includes(process.env.RENDER_IMAGE_QUALITY ?? '')
  ? (process.env.RENDER_IMAGE_QUALITY as 'low' | 'medium' | 'high')
  : 'high'

/** How closely the photo follows the capture. RENDER_INPUT_FIDELITY=low turns it off. */
const INPUT_FIDELITY: 'high' | undefined = process.env.RENDER_INPUT_FIDELITY === 'low' ? undefined : 'high'

/** One attempt only: each retry of a slow request is another paid generation and another wait. */
const REQUEST_OPTIONS = { maxRetries: 0, timeout: 170_000 }

/** gpt-image sizes that match the capture's orientation. */
function pickSize(width = 0, height = 0): '1536x1024' | '1024x1536' | '1024x1024' {
  if (width > height * 1.1) return '1536x1024'
  if (height > width * 1.1) return '1024x1536'
  return '1024x1024'
}

const timedOut = (err: unknown) => {
  const status = (err as { status?: number }).status
  return status === 504 || status === 524 || status === 408 || /timed? ?out/i.test(String((err as Error)?.message))
}

/** The image service itself is unreachable or failing (not a problem with our request). */
export function isGatewayDown(err: unknown): boolean {
  const status = (err as { status?: number }).status
  const text = `${(err as Error)?.message ?? ''} ${String((err as { cause?: unknown }).cause ?? '')}`
  return (
    timedOut(err) ||
    status === 502 ||
    status === 503 ||
    (err as { code?: string }).code === 'upstream_unavailable' ||
    /connection error|fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|upstream/i.test(text)
  )
}

export function renderErrorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Render failed'
  if (message.includes('OPENAI_API_KEY')) return 'OPENAI_API_KEY is not configured'
  if (timedOut(err)) {
    return 'Le serveur d’images est trop lent en ce moment et n’a pas répondu à temps. Réessayez dans quelques minutes.'
  }
  if (isGatewayDown(err)) {
    return 'Le serveur d’images est momentanément indisponible. Réessayez dans quelques minutes.'
  }
  return message
}

/** A gateway answer that is an error body instead of an image (it came back as HTTP 200). */
class GatewayError extends Error {
  readonly status = 502
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

/**
 * Thrown in "ask" mode when the image service is too slow or down: instead of silently retrying
 * (a second paid generation), the Studio asks the user: continue in medium quality, or hold the
 * render until the service is back. The Blender capture is already kept, so neither costs a recapture.
 */
export class PhotoChoiceError extends Error {
  constructor(
    /** The quality that just failed. */
    readonly tried: 'low' | 'medium' | 'high',
    /** 'slow' = timed out (Cloudflare's ~100 s cut), 'down' = unreachable or failing. */
    readonly reason: 'slow' | 'down',
    readonly detail: string,
  ) {
    super(detail)
  }
}

export interface PhotorealOptions {
  /** First quality to try; defaults to RENDER_IMAGE_QUALITY (high). */
  quality?: 'low' | 'medium' | 'high'
  /** Ask the user instead of falling back to medium on its own (see PhotoChoiceError). */
  ask?: boolean
}

export interface PhotorealResult {
  base64: string
  seconds: number
  quality: string
  size: string
  /** True when high quality timed out and the photo was made at medium instead. */
  fellBack: boolean
  /** How closely the photo was asked to follow the capture. */
  fidelity: 'high' | 'low'
  /** 'backup' when the main gateway was down and the backup provider made the photo. */
  provider: 'gateway' | 'backup'
}

/**
 * Turns a 3D capture into a photoreal image with GPT Image. Throws errors whose message is
 * already readable (use renderErrorDetail for the final text).
 */
export async function generatePhotoreal(image: Buffer, prompt: string, options: PhotorealOptions = {}): Promise<PhotorealResult> {
  const client = getOpenAIClient()
  const startQuality = options.quality ?? IMAGE_QUALITY

  // Re-encode the capture as a plain PNG (max 2048 px): browsers can hand over odd JPEGs
  // (huge, progressive, tagged) that the image provider rejects as "Invalid value for 'image'".
  const sharp = loadSharp()
  const original = await sharp(image).metadata()
  const { channels } = await sharp(image).stats()
  if (channels.every(c => c.stdev < 3)) {
    throw new Error('La capture 3D est vide (image uniforme). Rechargez la page et réessayez.')
  }
  const tooBig = Math.max(original.width ?? 0, original.height ?? 0) > 2048
  const png = await (tooBig
    ? sharp(image).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    : sharp(image)
  )
    .png()
    .toBuffer()
  const dims = await sharp(png).metadata()
  const size = pickSize(dims.width, dims.height)

  const started = performance.now()
  // 'high' makes the model stick to the capture (shapes, materials, framing) instead of drifting
  // from it; the default 'low' let it repaint wood tones and stone patterns.
  let fidelity: 'high' | undefined = INPUT_FIDELITY
  const attempt = async (
    quality: 'low' | 'medium' | 'high',
    target: { client: OpenAI; model: string } = { client, model: GPT_IMAGE_MODEL },
  ): Promise<unknown> => {
    const params = {
      model: target.model,
      image: await toFile(png, 'studio.png', { type: 'image/png' }),
      prompt,
      quality,
      ...(fidelity ? { input_fidelity: fidelity } : {}),
      background: 'opaque' as const,
      output_format: 'jpeg' as const,
      // Prefer inline base64; gateways that ignore this may still return url
      response_format: 'b64_json' as const,
      size,
    }
    // The gateway sometimes answers an instant, unbilled "upstream_400 Invalid value for 'image'"
    // for a picture it accepts a moment later. Retry only that.
    for (let tries = 1; ; tries++) {
      try {
        const response = await target.client.images.edit(params, REQUEST_OPTIONS)
        const body = response as unknown as { data?: unknown; error?: { message?: string; code?: string } }
        if (body.error && !body.data) throw new GatewayError(body.error.message ?? 'upstream error', body.error.code)
        return response
      } catch (err) {
        // A gateway that doesn't know input_fidelity refuses instantly (unbilled): go on without it.
        if (fidelity && (err as { status?: number }).status === 400 && /input_fidelity/i.test(String((err as Error).message))) {
          console.warn('photoreal: gateway refused input_fidelity, continuing without it')
          fidelity = undefined
          return attempt(quality, target)
        }
        const flaky = (err as { code?: string }).code === 'upstream_400'
        if (!flaky || tries === 3) {
          if ((err as { status?: number }).status === 400) {
            // Keep the picture that was rejected so it can be looked at.
            const dump = path.join(tmpdir(), 'roomia-last-rejected-render-input')
            await writeFile(dump, png).catch(() => undefined)
            console.error(`photoreal: rejected input saved to ${dump} (${png.length} bytes)`)
          }
          throw err
        }
        console.warn(`photoreal: gateway rejected the image (attempt ${tries}), retrying`)
        await new Promise(r => setTimeout(r, 1500))
      }
    }
  }

  // High quality on a complex view can take longer than the gateway's ~100 s Cloudflare limit
  // (504 / 524). Rather than fail, try once more at medium quality, which takes about 60-70 s.
  let usedQuality: 'low' | 'medium' | 'high' = startQuality
  let fellBack = false
  let provider: 'gateway' | 'backup' = 'gateway'
  let response: unknown
  try {
    try {
      response = await attempt(startQuality)
    } catch (err) {
      // In ask mode the user decides; otherwise one automatic retry at medium.
      if (options.ask || startQuality !== 'high' || !timedOut(err)) throw err
      const status = (err as { status?: number }).status
      console.warn(`photoreal: high quality timed out (${status ?? 'timeout'}) after ${((performance.now() - started) / 1000).toFixed(0)}s; retrying once at medium`)
      usedQuality = 'medium'
      fellBack = true
      response = await attempt('medium')
    }
  } catch (err) {
    // The gateway is down (outage, 524 even at medium, unreachable): one try on the backup provider.
    const backup = getBackupImageClient()
    if (!isGatewayDown(err)) throw err
    if (!backup) {
      if (options.ask) {
        console.warn(`photoreal: ${startQuality} failed (${(err as Error).message?.slice(0, 80)}); asking the user`)
        throw new PhotoChoiceError(startQuality, timedOut(err) ? 'slow' : 'down', renderErrorDetail(err))
      }
      throw err
    }
    console.warn(`photoreal: gateway down (${(err as Error).message?.slice(0, 80)}); trying the backup provider`)
    provider = 'backup'
    usedQuality = startQuality
    fellBack = false
    response = await attempt(startQuality, backup)
  }
  const seconds = (performance.now() - started) / 1000
  console.log(`photoreal: ${usedQuality}${fellBack ? ' (fallback)' : ''}${provider === 'backup' ? ' via backup' : ''} ${size} fidelity ${fidelity ?? 'low'} in ${seconds.toFixed(1)}s`)

  try {
    return { base64: await extractImageBase64(response), seconds, quality: usedQuality, size, fellBack, fidelity: fidelity ?? 'low', provider }
  } catch (extractErr) {
    console.error('photoreal extract failed; raw response:', JSON.stringify(response)?.slice(0, 800))
    throw extractErr
  }
}
