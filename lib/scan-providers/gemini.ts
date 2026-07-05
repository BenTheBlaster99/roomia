import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'
import { FLOOR_PLAN_SCAN_PROMPT } from '@/lib/scan-prompt'
import { ScanApiError } from '@/lib/scan-error'
import type { PreparedScanImage } from '@/lib/scan-image'

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] as const
const MAX_RETRIES_PER_MODEL = 2
const RETRY_DELAYS_MS = [1500, 3000]

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
  image: PreparedScanImage,
): Promise<string> {
  const result = await model.generateContent([
    {
      inlineData: {
        data: image.base64,
        mimeType: image.mimeType,
      },
    },
    FLOOR_PLAN_SCAN_PROMPT,
  ])
  return result.response.text()
}

export async function scanWithGemini(image: PreparedScanImage): Promise<{ text: string; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new ScanApiError('Gemini API key is not configured.', 'missing_api_key', 500)
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  let lastError: unknown = null

  for (const modelName of MODELS) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    })

    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      try {
        const text = await generateWithModel(model, image)
        return { text, model: `gemini:${modelName}` }
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
