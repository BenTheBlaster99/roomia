import { aiBackendHeaders, getAiBackendUrl } from '@/lib/openai-client'
import { hasReplicateSam2, segmentClicksWithReplicate } from '@/lib/sam2-replicate'

export { hasReplicateSam2 }

async function segmentClickOnGpu(imageBase64: string, x: number, y: number): Promise<string> {
  const backend = getAiBackendUrl()
  const res = await fetch(`${backend}/segment`, {
    method: 'POST',
    headers: aiBackendHeaders(),
    body: JSON.stringify({ image_base64: imageBase64, x, y }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail =
      typeof err === 'object' && err && 'detail' in err
        ? String((err as { detail: unknown }).detail)
        : `SAM2 segment failed (${res.status})`
    throw new Error(detail)
  }

  const data = (await res.json()) as { mask_base64?: string }
  if (!data.mask_base64) throw new Error('SAM2 returned no mask')
  return data.mask_base64
}

/**
 * Click → grayscale mask (white = selected).
 * Replicate when REPLICATE_API_TOKEN is set (live pitch). Else Jack’s GPU.
 */
export async function segmentClicks(
  imageBase64: string,
  clicks: Array<{ x: number; y: number }>,
): Promise<string[]> {
  if (clicks.length === 0) return []
  if (hasReplicateSam2()) {
    return segmentClicksWithReplicate(imageBase64, clicks)
  }
  return Promise.all(clicks.map(click => segmentClickOnGpu(imageBase64, click.x, click.y)))
}

export async function segmentMask(imageBase64: string, x: number, y: number): Promise<string> {
  const [mask] = await segmentClicks(imageBase64, [{ x, y }])
  return mask
}
