import { decodeImageBase64, sniffImageMime } from '@/lib/image-bytes'
import { loadSharp } from '@/lib/load-sharp'
import { pickMaskAtClick, type GrayMask } from '@/lib/sam2-click'

const REPLICATE_FILES = 'https://api.replicate.com/v1/files'
const REPLICATE_MODEL = 'https://api.replicate.com/v1/models/meta/sam-2'
const REPLICATE_PREDICTIONS = 'https://api.replicate.com/v1/predictions'

type ReplicateOutput = {
  combined_mask?: string
  individual_masks?: string[]
}

type ReplicatePrediction = {
  status?: string
  error?: string | null
  output?: ReplicateOutput | null
  urls?: { get?: string }
}

function replicateToken(): string {
  const token = process.env.REPLICATE_API_TOKEN?.trim()
  if (!token) throw new Error('REPLICATE_API_TOKEN is not configured')
  return token
}

export function hasReplicateSam2(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN?.trim())
}

async function wait(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function uploadImage(imageBase64: string, token: string): Promise<string> {
  const buf = decodeImageBase64(imageBase64)
  const mime = sniffImageMime(buf)
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const form = new FormData()
  form.append('content', new Blob([new Uint8Array(buf)], { type: mime }), `room.${ext}`)

  const res = await fetch(REPLICATE_FILES, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as {
    urls?: { get?: string }
    error?: string
    detail?: string
  }
  if (!res.ok || !data.urls?.get) {
    throw new Error(data.error || data.detail || `Replicate file upload failed (${res.status})`)
  }
  return data.urls.get
}

async function fetchPrediction(url: string, token: string): Promise<ReplicatePrediction> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const data = (await res.json().catch(() => ({}))) as ReplicatePrediction
  if (!res.ok) {
    throw new Error(data.error || `Replicate poll failed (${res.status})`)
  }
  return data
}

async function latestSam2Version(token: string): Promise<string> {
  const res = await fetch(REPLICATE_MODEL, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = (await res.json().catch(() => ({}))) as {
    latest_version?: { id?: string }
    detail?: string
    error?: string
  }
  if (!res.ok || !data.latest_version?.id) {
    throw new Error(data.error || data.detail || `Replicate SAM2 model lookup failed (${res.status})`)
  }
  return data.latest_version.id
}

async function runSam2(imageUrl: string, token: string): Promise<ReplicateOutput> {
  const version = await latestSam2Version(token)
  const res = await fetch(REPLICATE_PREDICTIONS, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    },
    body: JSON.stringify({
      version,
      input: {
        image: imageUrl,
        points_per_side: 24,
        pred_iou_thresh: 0.88,
        stability_score_thresh: 0.95,
        use_m2m: true,
      },
    }),
  })

  let prediction = (await res.json().catch(() => ({}))) as ReplicatePrediction
  if (!res.ok && res.status !== 201) {
    throw new Error(prediction.error || `Replicate SAM2 failed (${res.status})`)
  }

  const started = Date.now()
  while (prediction.status === 'starting' || prediction.status === 'processing') {
    if (Date.now() - started > 90_000) {
      throw new Error('Replicate SAM2 timed out')
    }
    const getUrl = prediction.urls?.get
    if (!getUrl) throw new Error('Replicate SAM2 is still running with no poll URL')
    await wait(2000)
    prediction = await fetchPrediction(getUrl, token)
  }

  if (prediction.status === 'failed' || prediction.error) {
    throw new Error(prediction.error || 'Replicate SAM2 failed')
  }
  if (!prediction.output) {
    throw new Error('Replicate SAM2 returned no output')
  }
  return prediction.output
}

async function decodeGrayMask(url: string): Promise<GrayMask> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download SAM2 mask (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const sharp = loadSharp()
  const { data, info } = await sharp(buf)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data),
  }
}

async function encodeMaskPng(mask: GrayMask, width: number, height: number): Promise<string> {
  const sharp = loadSharp()
  const png = await sharp(Buffer.from(mask.data), {
    raw: { width: mask.width, height: mask.height, channels: 1 },
  })
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .png()
    .toBuffer()
  return png.toString('base64')
}

/**
 * One Replicate SAM2 run per photo, then one mask per click.
 * meta/sam-2 is automatic (“segment everything”); we pick the mask under the pin.
 */
export async function segmentClicksWithReplicate(
  imageBase64: string,
  clicks: Array<{ x: number; y: number }>,
): Promise<string[]> {
  if (clicks.length === 0) return []

  const token = replicateToken()
  const imageUrl = await uploadImage(imageBase64, token)
  const output = await runSam2(imageUrl, token)
  const urls = output.individual_masks?.filter(Boolean) ?? []
  if (urls.length === 0) {
    throw new Error('Replicate SAM2 returned no individual masks')
  }

  const masks = await Promise.all(urls.map(decodeGrayMask))
  const buf = decodeImageBase64(imageBase64)
  const sharp = loadSharp()
  const meta = await sharp(buf).metadata()
  const width = meta.width
  const height = meta.height
  if (!width || !height) throw new Error('Could not read photo size for SAM2')

  return Promise.all(
    clicks.map(click => encodeMaskPng(pickMaskAtClick(masks, click.x, click.y), width, height)),
  )
}
