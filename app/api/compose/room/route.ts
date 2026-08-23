import { NextRequest } from 'next/server'
import { toFile } from 'openai'
import { GPT_IMAGE_MODEL, aiBackendHeaders, getAiBackendUrl, getOpenAIClient } from '@/lib/openai-client'
import { extractImageBase64 } from '@/lib/extract-image-b64'
import {
  buildMultiZoneComposePrompt,
  getReferenceFidelity,
  type ComposeAtmosphere,
  type ReferenceFidelity,
} from '@/lib/render-prompt'
import {
  decodeImageBase64,
  sniffImageMime,
  unionSamMasksToAlphaPng,
  dilateSamMask,
} from '@/lib/sam-mask-to-alpha'

export const runtime = 'nodejs'
export const maxDuration = 300

interface ComposeZone {
  x: number
  y: number
  prompt: string
  category?: string | null
  fidelity?: ReferenceFidelity | null
  reference_base64?: string | null
  auto_place?: boolean
}

interface ComposeAtmosphereBody {
  wall?: { prompt: string; x: number; y: number } | null
  lighting?: {
    prompt: string
    kind: string
    x: number
    y: number
    reference_base64?: string | null
  } | null
}

interface ComposeBody {
  image_base64: string
  zones: ComposeZone[]
  atmosphere?: ComposeAtmosphereBody | null
  num_variations?: number
}

type ProgressStep = 'masking' | 'generating' | 'results'

async function segmentMask(
  imageBase64: string,
  x: number,
  y: number,
): Promise<string> {
  const backend = getAiBackendUrl()
  const res = await fetch(`${backend}/segment`, {
    method: 'POST',
    headers: aiBackendHeaders(),
    body: JSON.stringify({ image_base64: imageBase64, x, y }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail =
      typeof err === 'object' && err && 'detail' in err
        ? String((err as { detail: unknown }).detail)
        : `SAM2 segment failed (${res.status})`
    throw new Error(detail)
  }

  const data = (await res.json()) as { mask_base64?: string }
  if (!data.mask_base64) {
    throw new Error('SAM2 returned no mask')
  }
  return data.mask_base64
}

/**
 * Exactly ONE GPT Image call per variation, regardless of how many pins/zones.
 * All furniture is applied in a single masked edit.
 */
async function generateVariation(opts: {
  roomBase64: string
  combinedMaskPng: Buffer
  zones: ComposeZone[]
  atmosphere?: ComposeAtmosphere | null
  lightingRefBase64?: string | null
  variationIndex: number
}): Promise<string> {
  const client = getOpenAIClient()
  const roomBuf = decodeImageBase64(opts.roomBase64)
  const roomMime = sniffImageMime(roomBuf)
  const roomExt = roomMime === 'image/png' ? 'png' : roomMime === 'image/webp' ? 'webp' : 'jpg'

  const images = [await toFile(roomBuf, `room.${roomExt}`, { type: roomMime })]

  const zonePromptInputs = []
  for (let i = 0; i < opts.zones.length; i++) {
    const zone = opts.zones[i]
    const hasReference = Boolean(zone.reference_base64)
    let referenceImageIndex: number | null = null

    if (hasReference && zone.reference_base64) {
      const refBuf = decodeImageBase64(zone.reference_base64)
      const refMime = sniffImageMime(refBuf)
      const refExt = refMime === 'image/png' ? 'png' : refMime === 'image/webp' ? 'webp' : 'jpg'
      images.push(await toFile(refBuf, `product-${i + 1}.${refExt}`, { type: refMime }))
      referenceImageIndex = images.length
    }

    zonePromptInputs.push({
      catalogPrompt: zone.prompt,
      category: zone.category,
      fidelity: zone.fidelity ?? getReferenceFidelity(zone.category),
      hasReference,
      referenceImageIndex,
      x: zone.x,
      y: zone.y,
      autoPlace: Boolean(zone.auto_place),
    })
  }

  let atmosphere = opts.atmosphere ?? null
  if (atmosphere?.lighting && opts.lightingRefBase64) {
    const refBuf = decodeImageBase64(opts.lightingRefBase64)
    const refMime = sniffImageMime(refBuf)
    const refExt = refMime === 'image/png' ? 'png' : refMime === 'image/webp' ? 'webp' : 'jpg'
    images.push(await toFile(refBuf, `lighting.${refExt}`, { type: refMime }))
    atmosphere = {
      ...atmosphere,
      lighting: {
        ...atmosphere.lighting,
        hasReference: true,
        referenceImageIndex: images.length,
      },
    }
  }

  const prompt = buildMultiZoneComposePrompt({
    zones: zonePromptInputs,
    variationIndex: opts.variationIndex,
    atmosphere,
  })

  const response = await client.images.edit({
    model: GPT_IMAGE_MODEL,
    image: images,
    mask: await toFile(opts.combinedMaskPng, 'mask.png', { type: 'image/png' }),
    prompt,
    quality: 'high',
    background: 'opaque',
    output_format: 'jpeg',
    response_format: 'b64_json',
    size: 'auto',
  })

  return extractImageBase64(response)
}

function errorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Compose failed'
  if (message.includes('ECONNREFUSED') || message.toLowerCase().includes('fetch failed')) {
    return 'Could not reach SAM2. On this PC: npm run back. Live site needs the GPU tunnel (docs/SAM2-GPU-TUNNEL.txt).'
  }
  return message
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ComposeBody

  const wall = body.atmosphere?.wall
  const lighting = body.atmosphere?.lighting
  const hasAtmosphere = Boolean(wall || lighting)

  if (!body.image_base64) {
    return Response.json({ detail: 'image_base64 is required' }, { status: 400 })
  }
  if (!Array.isArray(body.zones)) {
    return Response.json({ detail: 'zones must be an array' }, { status: 400 })
  }
  if (body.zones.length === 0 && !hasAtmosphere) {
    return Response.json({ detail: 'Add furniture, a wall color, or a light' }, { status: 400 })
  }
  if (body.zones.length > 3) {
    return Response.json({ detail: 'Maximum 3 furniture zones per composition' }, { status: 400 })
  }

  // Always exactly this many GPT Image calls — never zones × variations
  const numVariations = Math.min(4, Math.max(1, body.num_variations ?? 3))

  for (const z of body.zones) {
    if (typeof z.x !== 'number' || typeof z.y !== 'number' || !z.prompt) {
      return Response.json({ detail: 'Each zone needs x, y, and prompt' }, { status: 400 })
    }
  }

  try {
    getOpenAIClient()
  } catch (err) {
    return Response.json({ detail: errorDetail(err) }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
      }

      try {
        send({
          type: 'progress',
          step: 'masking' satisfies ProgressStep,
          label: 'Step 1 · Masking',
          detail: hasAtmosphere
            ? 'Reading walls, light, and furniture in the photo…'
            : `Segmenting ${body.zones.length} furniture spot(s) with SAM2…`,
          pct: 12,
        })

        const maskList: string[] = []
        if (body.zones.length > 0) {
          maskList.push(
            ...(await Promise.all(body.zones.map(z => segmentMask(body.image_base64, z.x, z.y)))),
          )
        }
        if (wall && typeof wall.x === 'number' && typeof wall.y === 'number') {
          const wallMask = await segmentMask(body.image_base64, wall.x, wall.y)
          maskList.push(await dilateSamMask(wallMask, 10))
        }
        if (lighting && typeof lighting.x === 'number' && typeof lighting.y === 'number') {
          const lightMask = await segmentMask(body.image_base64, lighting.x, lighting.y)
          maskList.push(await dilateSamMask(lightMask, 42))
        }
        if (maskList.length === 0) {
          throw new Error('Could not build an edit mask')
        }
        const combinedMaskPng = await unionSamMasksToAlphaPng(maskList, {
          featherPx: hasAtmosphere ? 8 : 5,
        })

        send({
          type: 'progress',
          step: 'generating' satisfies ProgressStep,
          label: 'Step 2 · Generating',
          detail: `Sending ${numVariations} restyles to GPT Image 2…`,
          pct: 40,
        })

        let atmosphereForPrompt: ComposeAtmosphere = {}
        if (wall) atmosphereForPrompt.wall = wall
        if (lighting) {
          atmosphereForPrompt.lighting = {
            prompt: lighting.prompt,
            kind: lighting.kind,
            x: lighting.x,
            y: lighting.y,
            hasReference: Boolean(lighting.reference_base64),
            referenceImageIndex: null,
          }
        }

        const settled = await Promise.allSettled(
          Array.from({ length: numVariations }, (_, i) =>
            generateVariation({
              roomBase64: body.image_base64,
              combinedMaskPng,
              zones: body.zones,
              atmosphere: Object.keys(atmosphereForPrompt).length > 0 ? atmosphereForPrompt : null,
              lightingRefBase64: lighting?.reference_base64 ?? null,
              variationIndex: i,
            }),
          ),
        )

        const variations: string[] = []
        const failures: string[] = []
        settled.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            variations.push(result.value)
          } else {
            const msg =
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason ?? 'unknown error')
            failures.push(`variation ${i + 1}: ${msg}`)
            console.error(`compose variation ${i + 1} failed:`, result.reason)
          }
        })

        if (variations.length === 0) {
          send({
            type: 'error',
            detail:
              failures[0] ??
              'All variations failed. Check OPENAI_API_KEY / OPENAI_BASE_URL and try again.',
          })
          return
        }

        send({
          type: 'progress',
          step: 'results' satisfies ProgressStep,
          label: 'Step 3 · Results',
          detail:
            failures.length > 0
              ? `${variations.length}/${numVariations} succeeded — showing available results`
              : 'Packaging variations…',
          pct: 92,
        })

        send({
          type: 'done',
          variations,
          failed_count: failures.length,
          warnings: failures,
          api_calls: numVariations,
        })
      } catch (err: unknown) {
        console.error('compose/room stream error:', err)
        send({ type: 'error', detail: errorDetail(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
