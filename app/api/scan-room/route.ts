import { NextRequest } from 'next/server'
import { extractJsonFromModelText, parseScanResultToFloorPlan } from '@/lib/parse-scan-result'
import { ScanApiError } from '@/lib/scan-error'
import { runFloorPlanScan } from '@/lib/scan-providers'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType, room, height } = await req.json()

    if (!imageBase64) {
      throw new ScanApiError('No image provided.', 'no_image', 400)
    }

    const { text, model } = await runFloorPlanScan({
      base64: imageBase64,
      mimeType: mimeType || 'image/jpeg',
    })

    const raw = extractJsonFromModelText(text) as Record<string, unknown>
    const parsedHeight =
      typeof height === 'number'
        ? height
        : typeof height === 'string'
          ? Number(height)
          : undefined

    const parsed = parseScanResultToFloorPlan(raw, {
      room: typeof room === 'string' ? room : undefined,
      height: Number.isFinite(parsedHeight) && parsedHeight! > 0 ? parsedHeight : undefined,
    })

    return Response.json({
      success: true,
      width_m: parsed.width_m,
      length_m: parsed.length_m,
      height_m: parsed.height_m,
      confidence: parsed.confidence,
      notes: parsed.notes,
      floorPlan: parsed.floorPlan,
      shapeOnly: parsed.shapeOnly,
      modelUsed: model,
    })
  } catch (err) {
    console.error('Room scan error:', err)

    if (err instanceof ScanApiError) {
      return Response.json(
        { success: false, error: err.message, code: err.code },
        { status: err.status },
      )
    }

    const message = err instanceof Error ? err.message : 'Could not analyze the image'
    const code = message.includes('JSON') ? 'parse_failed' : 'unknown'

    return Response.json(
      {
        success: false,
        error:
          code === 'parse_failed'
            ? 'Could not parse the floor plan response. Try again or enter dimensions manually.'
            : 'Could not analyze the image. Enter dimensions manually.',
        code,
      },
      { status: 500 },
    )
  }
}
