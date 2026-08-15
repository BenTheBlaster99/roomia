import { NextRequest } from 'next/server'
import { toFile } from 'openai'
import { GPT_IMAGE_MODEL, getOpenAIClient } from '@/lib/openai-client'
import { extractImageBase64 } from '@/lib/extract-image-b64'
import { buildRenderPrompt } from '@/lib/render-prompt'
import { decodeImageBase64, sniffImageMime } from '@/lib/sam-mask-to-alpha'

export const runtime = 'nodejs'
export const maxDuration = 180

interface RenderBody {
  image_base64: string
  floor_material?: string
  wall_color?: string
  room_type?: string
}

type ProgressStep = 'capturing' | 'generating' | 'results'

function errorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Render failed'
  if (message.includes('OPENAI_API_KEY')) return 'OPENAI_API_KEY is not configured'
  return message
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RenderBody

  if (!body.image_base64) {
    return Response.json({ detail: 'image_base64 is required' }, { status: 400 })
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
          step: 'capturing' satisfies ProgressStep,
          label: 'Step 1 · Capture',
          detail: 'Studio view ready',
          pct: 15,
        })

        send({
          type: 'progress',
          step: 'generating' satisfies ProgressStep,
          label: 'Step 2 · Generating',
          detail: 'Sending 1 image to GPT Image 2…',
          pct: 45,
        })

        const client = getOpenAIClient()
        const { prompt, negative } = buildRenderPrompt({
          floorMaterial: body.floor_material,
          wallColor: body.wall_color,
          roomType: body.room_type,
        })

        const fullPrompt = [
          'Image 1 is a 3D studio screenshot of a furnished room.',
          'Turn it into ONE photorealistic interior photograph.',
          prompt,
          `Avoid: ${negative}`,
          'CRITICAL layout lock: keep the exact same furniture, positions, proportions, and camera angle as the input.',
          'FORBIDDEN: moving, adding, removing, or redesigning furniture; changing the camera.',
          'ALLOWED: realistic materials, lighting, shadows, and photographic detail on the same scene.',
        ].join(' ')

        const buf = decodeImageBase64(body.image_base64)
        const mime = sniffImageMime(buf)
        const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'

        const response = await client.images.edit({
          model: GPT_IMAGE_MODEL,
          image: await toFile(buf, `studio.${ext}`, { type: mime }),
          prompt: fullPrompt,
          quality: 'high',
          background: 'opaque',
          output_format: 'jpeg',
          // Prefer inline base64; gateways that ignore this may still return url
          response_format: 'b64_json',
          size: 'auto',
        })

        let b64: string
        try {
          b64 = await extractImageBase64(response)
        } catch (extractErr) {
          console.error('render extract failed; raw response:', JSON.stringify(response)?.slice(0, 800))
          throw extractErr
        }

        send({
          type: 'progress',
          step: 'results' satisfies ProgressStep,
          label: 'Step 3 · Results',
          detail: 'Done',
          pct: 100,
        })

        send({ type: 'done', result_base64: b64 })
      } catch (err: unknown) {
        console.error('render/photorealistic stream error:', err)
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
