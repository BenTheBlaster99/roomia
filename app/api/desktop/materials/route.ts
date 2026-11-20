import { NextRequest } from 'next/server'
import { bearerUser, cloudOff, desktopCloudEnabled, notSignedIn } from '@/lib/desktop-cloud'
import { getOpenAIClient } from '@/lib/openai-client'

export const runtime = 'nodejs'
export const maxDuration = 120

/** the model of Coconut's gateway that names the materials (it reads pictures); scripts/look_materials.py uses the same */
const MATERIALS_MODEL = process.env.ROOMIA_MATERIALS_MODEL?.trim() || 'anthropic/claude-haiku-5.5'

/**
 * POST { image?, prompt } — Roomia Desktop asks what the materials of a project are (scripts/look_materials.py, 19 Nov): a contact
 * sheet of numbered texture samples with their names, or (no image) the plain materials described as text, answered through
 * Coconut's AI gateway with Roomia's key (the desktop app holds no key). Free for the architect; a signed-in account only.
 * Answers { families: { "<number>": "<family>" } }.
 */
export async function POST(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const body = (await req.json().catch(() => null)) as { image?: unknown; prompt?: unknown } | null
  const image = typeof body?.image === 'string' ? body.image : ''
  const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
  // one sheet is 8 x 6 samples of 160 px as a JPEG: a few hundred KB
  if (image.length > 4_000_000 || !prompt || prompt.length > 40_000) return Response.json({ detail: 'Requête invalide.' }, { status: 400 })
  let client
  try {
    client = getOpenAIClient()
  } catch {
    return Response.json({ detail: 'Reconnaissance des matières indisponible.' }, { status: 503 })
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: MATERIALS_MODEL,
        temperature: 0,
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }, ...(image ? [{ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${image}` } }] : [])],
          },
        ],
      })
      const text = res.choices[0]?.message?.content ?? '{}'
      // the JSON object in the answer (a model may wrap it in a code fence or a sentence)
      return Response.json({ families: JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, string> })
    } catch (err) {
      console.error('desktop materials', (err as Error).message.slice(0, 160))
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  return Response.json({ detail: 'La reconnaissance des matières a échoué.' }, { status: 502 })
}
