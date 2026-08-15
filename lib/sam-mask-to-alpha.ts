import sharp from 'sharp'

function stripDataUrl(b64: string): string {
  const i = b64.indexOf(',')
  return i >= 0 ? b64.slice(i + 1) : b64
}

/**
 * Convert a SAM2 grayscale mask (white = selected furniture) into an RGBA PNG
 * for GPT Image edits: transparent pixels = edit, opaque = keep.
 */
export async function samMaskToAlphaPng(
  maskBase64: string,
  options?: { featherPx?: number },
): Promise<Buffer> {
  return unionSamMasksToAlphaPng([maskBase64], options)
}

/**
 * Merge multiple SAM2 masks (white = edit) into one RGBA alpha PNG.
 * Any white pixel from any mask becomes editable (alpha 0).
 */
export async function unionSamMasksToAlphaPng(
  maskBase64List: string[],
  options?: { featherPx?: number },
): Promise<Buffer> {
  if (maskBase64List.length === 0) {
    throw new Error('At least one mask is required')
  }

  const feather = Math.max(0, options?.featherPx ?? 4)
  const decoded = await Promise.all(
    maskBase64List.map(async b64 => {
      const input = Buffer.from(stripDataUrl(b64), 'base64')
      return sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true })
    }),
  )

  const { info } = decoded[0]
  const width = info.width
  const height = info.height
  const pixelCount = width * height

  for (const item of decoded) {
    if (item.info.width !== width || item.info.height !== height) {
      throw new Error('All SAM2 masks must share the same dimensions')
    }
  }

  const union = Buffer.alloc(pixelCount, 0)
  for (const item of decoded) {
    const channels = item.info.channels || 1
    for (let i = 0; i < pixelCount; i++) {
      const lum = item.data[i * channels]
      if (lum > union[i]) union[i] = lum
    }
  }

  let soft: Buffer | Uint8Array = union
  if (feather > 0) {
    soft = await sharp(union, { raw: { width, height, channels: 1 } })
      .blur(Math.max(0.3, feather / 2))
      .raw()
      .toBuffer()
  }

  const rgba = Buffer.alloc(pixelCount * 4)
  for (let i = 0; i < pixelCount; i++) {
    const lum = soft[i]
    rgba[i * 4] = 0
    rgba[i * 4 + 1] = 0
    rgba[i * 4 + 2] = 0
    // white object → alpha 0 (edit); black → alpha 255 (keep)
    rgba[i * 4 + 3] = 255 - lum
  }

  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
}

export async function dilateSamMask(maskBase64: string, radiusPx: number): Promise<string> {
  const input = Buffer.from(stripDataUrl(maskBase64), 'base64')
  const radius = Math.max(1, radiusPx)
  const buf = await sharp(input)
    .greyscale()
    .blur(Math.max(0.5, radius / 2))
    .threshold(28)
    .png()
    .toBuffer()
  return buf.toString('base64')
}
export function decodeImageBase64(imageBase64: string): Buffer {
  return Buffer.from(stripDataUrl(imageBase64), 'base64')
}

/** Guess image mime from magic bytes (default jpeg). */
export function sniffImageMime(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp'
  return 'image/jpeg'
}
