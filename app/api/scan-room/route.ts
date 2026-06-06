import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest } from 'next/server'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType } = await req.json()

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const result = await model.generateContent([
      {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType || 'image/jpeg',
        },
      },
      `Analyze this room floor plan or sketch.
       Look for dimension labels, scale bars, or measurement annotations.
       If none are visible, estimate based on typical room proportions.

       Return ONLY a raw JSON object — no markdown, no code block, no explanation:
       {
         "width_m": <number>,
         "length_m": <number>,
         "confidence": "<high|medium|low>",
         "notes": "<one sentence about what you detected>"
       }`,
    ])

    const text = result.response.text()
    const clean = text.replace(/```json|```/g, '').trim()
    const data = JSON.parse(clean)

    return Response.json({ success: true, ...data })
  } catch (err) {
    console.error('Room scan error:', err)
    return Response.json(
      { success: false, error: 'Could not analyze the image' },
      { status: 500 }
    )
  }
}
