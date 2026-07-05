import { preprocessScanImage, type PreparedScanImage } from '@/lib/scan-image'
import { ScanApiError } from '@/lib/scan-error'
import { scanWithGemini } from '@/lib/scan-providers/gemini'
import { scanWithOpenAI } from '@/lib/scan-providers/openai'

export type ScanProviderPreference = 'auto' | 'openai' | 'gemini'

export interface ScanImageInput {
  base64: string
  mimeType: string
}

export interface ScanModelResult {
  text: string
  model: string
  preparedImage: PreparedScanImage
}

function getProviderPreference(): ScanProviderPreference {
  const value = process.env.SCAN_PROVIDER?.toLowerCase()
  if (value === 'openai' || value === 'gemini' || value === 'auto') return value
  return 'gemini'
}

function hasOpenAiKey() {
  const key = process.env.OPENAI_API_KEY
  // Real sk-proj keys are much longer; skip truncated/placeholder keys in auto mode.
  return Boolean(key && key.startsWith('sk-') && key.length >= 80)
}

function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY)
}

async function tryProvider(
  name: 'openai' | 'gemini',
  image: PreparedScanImage,
): Promise<ScanModelResult> {
  const result = name === 'openai' ? await scanWithOpenAI(image) : await scanWithGemini(image)
  return { ...result, preparedImage: image }
}

export async function runFloorPlanScan(input: ScanImageInput): Promise<ScanModelResult> {
  const preparedImage = await preprocessScanImage(input.base64, input.mimeType)
  const preference = getProviderPreference()

  const order: ('openai' | 'gemini')[] =
    preference === 'openai'
      ? ['openai']
      : preference === 'gemini'
        ? ['gemini']
        : hasGeminiKey() && hasOpenAiKey()
          ? ['gemini', 'openai']
          : hasGeminiKey()
            ? ['gemini']
            : hasOpenAiKey()
              ? ['openai']
              : []

  if (order.length === 0) {
    throw new ScanApiError(
      'No scan API key configured. Add OPENAI_API_KEY or GEMINI_API_KEY.',
      'missing_api_key',
      500,
    )
  }

  const errors: unknown[] = []

  for (const provider of order) {
    try {
      return await tryProvider(provider, preparedImage)
    } catch (err) {
      errors.push(err)
      if (preference !== 'auto') throw err
      const reason =
        err instanceof ScanApiError && err.code === 'missing_api_key'
          ? 'invalid key — skipping to next provider'
          : 'failed'
      console.warn(`Floor plan scan ${reason} with ${provider}:`, err)
    }
  }

  const last = errors[errors.length - 1]
  if (last instanceof ScanApiError) throw last
  throw last instanceof Error ? last : new Error('All scan providers failed.')
}
