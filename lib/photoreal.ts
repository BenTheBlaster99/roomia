import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { toFile } from 'openai'
import { extractImageBase64 } from './extract-image-b64'
import { loadSharp } from './load-sharp'
import { GPT_IMAGE_MODEL, getOpenAIClient } from './openai-client'

/**
 * The image gateway sits behind Cloudflare, which drops requests that take over ~100 s (HTTP
 * 524), though high quality has also finished in ~115 s. Default is high; set
 * RENDER_IMAGE_QUALITY=medium (about 70 s) if it times out.
 */
export const IMAGE_QUALITY = ['low', 'medium', 'high'].includes(process.env.RENDER_IMAGE_QUALITY ?? '')
  ? (process.env.RENDER_IMAGE_QUALITY as 'low' | 'medium' | 'high')
  : 'high'

/** One attempt only: each retry of a slow request is another paid generation and another wait. */
const REQUEST_OPTIONS = { maxRetries: 0, timeout: 170_000 }

/** gpt-image sizes that match the capture's orientation. */
function pickSize(width = 0, height = 0): '1536x1024' | '1024x1536' | '1024x1024' {
  if (width > height * 1.1) return '1536x1024'
  if (height > width * 1.1) return '1024x1536'
  return '1024x1024'
}

export function renderErrorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Render failed'
  if (message.includes('OPENAI_API_KEY')) return 'OPENAI_API_KEY is not configured'
  const status = (err as { status?: number }).status
  if (status === 524 || status === 504 || status === 408 || /timed? ?out/i.test(message)) {
    return 'Le serveur d’images n’a pas répondu à temps. Réessayez ; en cas d’échec répété, baissez RENDER_IMAGE_QUALITY.'
  }
  return message
}

export interface PhotorealResult {
  base64: string
  seconds: number
  quality: string
  size: string
}

/**
 * Turns a 3D capture into a photoreal image with GPT Image. Throws errors whose message is
 * already readable (use renderErrorDetail for the final text).
 */
export async function generatePhotoreal(image: Buffer, prompt: string): Promise<PhotorealResult> {
  const client = getOpenAIClient()

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
  const params = {
    model: GPT_IMAGE_MODEL,
    image: await toFile(png, 'studio.png', { type: 'image/png' }),
    prompt,
    quality: IMAGE_QUALITY,
    background: 'opaque' as const,
    output_format: 'jpeg' as const,
    // Prefer inline base64; gateways that ignore this may still return url
    response_format: 'b64_json' as const,
    size,
  }

  // The gateway sometimes answers an instant, unbilled "upstream_400 Invalid value for 'image'"
  // for a picture it accepts a moment later. Retry only that; never retry a timeout.
  let response: Awaited<ReturnType<typeof client.images.edit>> | undefined
  for (let attempt = 1; attempt <= 3 && !response; attempt++) {
    try {
      response = await client.images.edit(params, REQUEST_OPTIONS)
    } catch (err) {
      const flaky = (err as { code?: string }).code === 'upstream_400'
      if (!flaky || attempt === 3) {
        if ((err as { status?: number }).status === 400) {
          // Keep the picture that was rejected so it can be looked at.
          const dump = path.join(tmpdir(), 'roomia-last-rejected-render-input')
          await writeFile(dump, png).catch(() => undefined)
          console.error(`photoreal: rejected input saved to ${dump} (${png.length} bytes)`)
        }
        throw err
      }
      console.warn(`photoreal: gateway rejected the image (attempt ${attempt}), retrying`)
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  if (!response) throw new Error('Render failed')
  const seconds = (performance.now() - started) / 1000
  console.log(`photoreal: ${IMAGE_QUALITY} ${size} in ${seconds.toFixed(1)}s`)

  try {
    return { base64: await extractImageBase64(response), seconds, quality: IMAGE_QUALITY, size }
  } catch (extractErr) {
    console.error('photoreal extract failed; raw response:', JSON.stringify(response)?.slice(0, 800))
    throw extractErr
  }
}
