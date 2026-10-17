import OpenAI from 'openai'

export const GPT_IMAGE_MODEL = 'gpt-image-2' as const

/** Server-side OpenAI client. Uses OPENAI_API_KEY + optional OPENAI_BASE_URL. */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  })
}

/**
 * Second image provider, used only when the main gateway is down (outages on 15 Oct: 15:15 and
 * 20:50). IMAGE_BACKUP_API_KEY turns it on; IMAGE_BACKUP_BASE_URL defaults to OpenAI itself and
 * IMAGE_BACKUP_MODEL to the main model. A direct provider has no 100 s Cloudflare cut.
 */
export function getBackupImageClient(): { client: OpenAI; model: string } | null {
  const apiKey = process.env.IMAGE_BACKUP_API_KEY?.trim()
  if (!apiKey) return null
  const baseURL = process.env.IMAGE_BACKUP_BASE_URL?.trim() || undefined
  return {
    client: new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }),
    model: process.env.IMAGE_BACKUP_MODEL?.trim() || GPT_IMAGE_MODEL,
  }
}

/** Local SAM2 / FastAPI host for segmentation (server-side only). */
export function getAiBackendUrl(): string {
  return (
    process.env.AI_BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_AI_BACKEND_URL?.trim() ||
    'http://localhost:8000'
  )
}

/** Shared secret for the GPU SAM2 host. Never NEXT_PUBLIC_*. */
export function aiBackendHeaders(): Record<string, string> {
  const secret = process.env.AI_BACKEND_SECRET?.trim()
  return {
    'Content-Type': 'application/json',
    ...(secret ? { 'x-roomia-ai-key': secret } : {}),
  }
}
