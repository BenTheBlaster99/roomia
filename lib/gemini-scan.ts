import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] as const
const MAX_RETRIES_PER_MODEL = 2
const RETRY_DELAYS_MS = [1500, 3000]

type ContentPart = { inlineData: { data: string; mimeType: string } } | string

export type ScanApiErrorCode =
  | 'missing_api_key'
  | 'no_image'
  | 'model_overloaded'
  | 'parse_failed'
  | 'unknown'

export class ScanApiError extends Error {
  code: ScanApiErrorCode
  status: number

  constructor(message: string, code: ScanApiErrorCode, status = 500) {
    super(message)
    this.code = code
    this.status = status
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableGeminiError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    message.includes('503') ||
    message.includes('429') ||
    message.includes('high demand') ||
    message.includes('overloaded') ||
    message.includes('UNAVAILABLE')
  )
}

async function generateWithModel(
  model: GenerativeModel,
  parts: ContentPart[],
): Promise<string> {
  const result = await model.generateContent(parts)
  return result.response.text()
}

export async function generateScanContent(
  genAI: GoogleGenerativeAI,
  parts: ContentPart[],
): Promise<{ text: string; model: string }> {
  let lastError: unknown = null

  for (const modelName of MODELS) {
    const model = genAI.getGenerativeModel({ model: modelName })

    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      try {
        const text = await generateWithModel(model, parts)
        return { text, model: modelName }
      } catch (err) {
        lastError = err
        const retryable = isRetryableGeminiError(err)
        const hasRetryLeft = attempt < MAX_RETRIES_PER_MODEL

        if (retryable && hasRetryLeft) {
          await sleep(RETRY_DELAYS_MS[attempt] ?? 3000)
          continue
        }

        if (retryable) break
        throw err
      }
    }
  }

  if (isRetryableGeminiError(lastError)) {
    throw new ScanApiError(
      'Gemini is temporarily overloaded. Wait a minute and try again.',
      'model_overloaded',
      503,
    )
  }

  throw lastError
}
