import sharp from 'sharp'

const MAX_EDGE_PX = 2048

export interface PreparedScanImage {
  base64: string
  mimeType: string
  width: number
  height: number
}

/** Normalize, deskew via EXIF, resize, and boost contrast for vision models. */
export async function preprocessScanImage(
  base64: string,
  _mimeType: string,
): Promise<PreparedScanImage> {
  const input = Buffer.from(base64, 'base64')

  const pipeline = sharp(input, { failOn: 'none' })
    .rotate()
    .resize(MAX_EDGE_PX, MAX_EDGE_PX, {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1 })

  const { data, info } = await pipeline.png({ compressionLevel: 6 }).toBuffer({
    resolveWithObject: true,
  })

  return {
    base64: data.toString('base64'),
    mimeType: 'image/png',
    width: info.width,
    height: info.height,
  }
}
