import { FLOOR_PLAN_SCAN_PROMPT } from '@/lib/scan-prompt'
import { ScanApiError } from '@/lib/scan-error'
import type { PreparedScanImage } from '@/lib/scan-image'
import { getOpenAIClient } from '@/lib/openai-client'

const MODELS = ['gpt-4o', 'gpt-4o-mini'] as const

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isAuthError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase()
  return (
    message.includes('401') ||
    message.includes('incorrect api key') ||
    message.includes('invalid api key') ||
    message.includes('authentication')
  )
}

function isRetryableOpenAiError(err: unknown): boolean {
  const message = errorMessage(err)
  return (
    message.includes('429') ||
    message.includes('503') ||
    message.includes('rate limit') ||
    message.includes('overloaded')
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function scanWithOpenAI(image: PreparedScanImage): Promise<{ text: string; model: string }> {
  let client
  try {
    client = getOpenAIClient()
  } catch {
    throw new ScanApiError('OpenAI API key is not configured.', 'missing_api_key', 500)
  }

  let lastError: unknown = null

  for (const modelName of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: modelName,
          max_tokens: 8192,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You digitize floor plans into metric JSON geometry. Follow the schema exactly. Never invent walls without evidence in the image.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: FLOOR_PLAN_SCAN_PROMPT },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${image.mimeType};base64,${image.base64}`,
                    detail: 'high',
                  },
                },
              ],
            },
          ],
        })

        const text = response.choices[0]?.message?.content
        if (!text) {
          throw new ScanApiError('OpenAI returned an empty response.', 'parse_failed', 502)
        }

        return { text, model: `openai:${modelName}` }
      } catch (err) {
        lastError = err
        if (err instanceof ScanApiError) throw err
        if (isAuthError(err)) {
          throw new ScanApiError(
            'OpenAI API key is invalid. Check OPENAI_API_KEY or use SCAN_PROVIDER=gemini.',
            'missing_api_key',
            401,
          )
        }
        if (isRetryableOpenAiError(err) && attempt === 0) {
          await sleep(2000)
          continue
        }
        if (modelName === MODELS[MODELS.length - 1]) break
      }
    }
  }

  if (isRetryableOpenAiError(lastError)) {
    throw new ScanApiError(
      'OpenAI is temporarily unavailable. Try again in a moment.',
      'model_overloaded',
      503,
    )
  }

  throw lastError
}
