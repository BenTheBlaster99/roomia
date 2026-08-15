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

/** Local SAM2 / FastAPI host for segmentation (server-side only). */
export function getAiBackendUrl(): string {
  return (
    process.env.AI_BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_AI_BACKEND_URL?.trim() ||
    'http://localhost:8000'
  )
}
