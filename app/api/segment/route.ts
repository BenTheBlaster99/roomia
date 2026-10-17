import { NextRequest } from 'next/server'
import { segmentMask } from '@/lib/sam2'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    image_base64?: string
    x?: number
    y?: number
  }

  if (!body.image_base64) {
    return Response.json({ detail: 'image_base64 is required' }, { status: 400 })
  }
  if (typeof body.x !== 'number' || typeof body.y !== 'number') {
    return Response.json({ detail: 'x and y must be numbers between 0 and 1' }, { status: 400 })
  }

  try {
    const mask_base64 = await segmentMask(body.image_base64, body.x, body.y)
    return Response.json({ mask_base64 })
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'SAM2 failed'
    const status = detail.includes('not configured') ? 500 : 502
    return Response.json({ detail }, { status })
  }
}
