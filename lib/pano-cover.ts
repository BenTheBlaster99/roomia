import { stat } from 'node:fs/promises'
import { loadSharp } from './load-sharp'

/**
 * 25 Nov: the covers of the visit's carousel. A point's cover is cut from its own 360° (the AI one when it has one),
 * 110 degrees wide around the yaw the page asks for (TourClient coverYaw: the way the architect’s camera looked).
 * Made on demand and kept in memory (about 25 KB each).
 */

const W = 2048
const H = 1024
const OUT_W = 480
const OUT_H = 300
const cache = new Map<string, Buffer>()
const MAX = 400

export async function panoCover(file: string, yaw: number): Promise<Buffer | null> {
  const s = await stat(file).catch(() => null)
  if (!s?.isFile()) return null
  const turn = Math.atan2(Math.sin(yaw), Math.cos(yaw))
  const key = `${file}:${Math.round(s.mtimeMs)}:${turn.toFixed(2)}`
  const hit = cache.get(key)
  if (hit) return hit
  const sharp = loadSharp()
  const { data, info } = await sharp(file).resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  // the viewer's yaw 0 is the middle of the picture, positive to the right (PanoViewer's shader)
  const cw = Math.round((W * 110) / 360) // 110 degrees: the room, not one wall
  const chh = Math.round(cw * (OUT_H / OUT_W))
  const left = Math.round(W * (0.5 + turn / (2 * Math.PI)) - cw / 2)
  // a little under the horizon: more floor and furniture, less ceiling
  const top = Math.max(0, Math.min(H - chh, Math.round(H / 2 - chh / 2 + H * 0.03)))
  const out = Buffer.alloc(cw * chh * ch)
  const x0 = ((left % W) + W) % W
  const first = Math.min(cw, W - x0)
  for (let y = 0; y < chh; y++) {
    const row = (top + y) * W * ch
    data.copy(out, y * cw * ch, row + x0 * ch, row + (x0 + first) * ch)
    if (first < cw) data.copy(out, (y * cw + first) * ch, row, row + (cw - first) * ch)
  }
  const jpg = await sharp(out, { raw: { width: cw, height: chh, channels: ch } }).resize(OUT_W, OUT_H).jpeg({ quality: 80 }).toBuffer()
  if (cache.size >= MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, jpg)
  return jpg
}
