export function stripDataUrl(b64: string): string {
  const i = b64.indexOf(',')
  return i >= 0 ? b64.slice(i + 1) : b64
}

export function decodeImageBase64(imageBase64: string): Buffer {
  return Buffer.from(stripDataUrl(imageBase64), 'base64')
}

export function sniffImageMime(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp'
  return 'image/jpeg'
}

export function readImageSize(buf: Buffer): { width: number; height: number } {
  const png = readPngSize(buf)
  if (png) return png
  const jpeg = readJpegSize(buf)
  if (jpeg) return jpeg
  const webp = readWebpSize(buf)
  if (webp) return webp
  throw new Error('Could not read photo size. Use a JPG or PNG.')
}

function readPngSize(buf: Buffer) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function readJpegSize(buf: Buffer) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = buf[i + 1]
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2
      continue
    }
    const len = buf.readUInt16BE(i + 2)
    if (len < 2) break
    i += 2 + len
  }
  return null
}

function readWebpSize(buf: Buffer) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null
  }
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8X' && buf.length >= 30) {
    const width = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16)
    const height = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16)
    return { width, height }
  }
  if (chunk === 'VP8 ' && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  return null
}
