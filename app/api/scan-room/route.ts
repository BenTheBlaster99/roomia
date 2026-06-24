import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest } from 'next/server'
import { generateScanContent, ScanApiError } from '@/lib/gemini-scan'
import { extractJsonFromModelText, parseScanResultToFloorPlan } from '@/lib/parse-scan-result'

const SCAN_PROMPT = `Analyze this architectural floor plan or room sketch.

Extract the room geometry as structured data for a 2D/3D interior design app.

Rules:
- Use metres for all measurements.
- Coordinate system: origin (0,0) at the bottom-left corner of the room bounding box.
- x increases to the right, z increases upward on the plan (depth/length).
- Walls are straight line segments between corner points.
- Door/window "offset" is the distance in metres from the wall segment START point to the opening center.
- If dimensions are labeled on the drawing, use them. Otherwise estimate from scale or typical proportions.
- For a simple rectangle, return 4 walls forming a closed loop.
- Include at least one room zone polygon when possible.

Return ONLY raw JSON — no markdown, no code block, no explanation:
{
  "width_m": <number>,
  "length_m": <number>,
  "height_m": <number or null if unknown>,
  "confidence": "<high|medium|low>",
  "notes": "<one sentence about what you detected>",
  "walls": [
    {
      "id": "wall-south",
      "start": { "x": 0, "z": 0 },
      "end": { "x": <width>, "z": 0 },
      "thickness": 0.12,
      "kind": "exterior"
    }
  ],
  "doors": [
    {
      "id": "door-1",
      "wallId": "wall-south",
      "offset": <metres from wall start>,
      "width": 0.9,
      "height": 2.05,
      "hinge": "left",
      "swing": "in"
    }
  ],
  "windows": [
    {
      "id": "window-1",
      "wallId": "wall-east",
      "offset": <metres from wall start>,
      "width": 1.2,
      "height": 1.2,
      "sillHeight": 0.9
    }
  ],
  "rooms": [
    {
      "id": "room-main",
      "name": "<room name if visible, else Room>",
      "points": [
        { "x": 0, "z": 0 },
        { "x": <width>, "z": 0 },
        { "x": <width>, "z": <length> },
        { "x": 0, "z": <length> }
      ]
    }
  ]
}`

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new ScanApiError(
        'Gemini API key is not configured.',
        'missing_api_key',
        500,
      )
    }

    const { imageBase64, mimeType, room, height } = await req.json()

    if (!imageBase64) {
      throw new ScanApiError('No image provided.', 'no_image', 400)
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

    const { text, model } = await generateScanContent(genAI, [
      {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType || 'image/jpeg',
        },
      },
      SCAN_PROMPT,
    ])

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
