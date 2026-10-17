import { deflateSync } from 'node:zlib'
import { decodeImageBase64, readImageSize } from '@/lib/image-bytes'

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(data: Buffer) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crcPayload = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcPayload))
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Transparent RGBA PNG — GPT Image treats transparent pixels as the edit region. */
export function fullFrameEditMaskPng(imageBase64: string): Buffer {
  const { width, height } = readImageSize(decodeImageBase64(imageBase64))
  if (width < 8 || height < 8 || width > 8192 || height > 8192) {
    throw new Error('Photo size is not usable for a kitchen restyle')
  }
  const raw = Buffer.alloc((width * 4 + 1) * height, 0)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
