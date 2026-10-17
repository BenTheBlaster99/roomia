/** Pick the tightest SAM mask that contains a normalized click (0–1). */

export type GrayMask = {
  width: number
  height: number
  data: Uint8Array
}

function pixelAt(mask: GrayMask, px: number, py: number): number {
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return 0
  return mask.data[py * mask.width + px]
}

function areaOf(mask: GrayMask, threshold = 128): number {
  let area = 0
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] > threshold) area++
  }
  return area
}

function invert(mask: GrayMask): GrayMask {
  const data = new Uint8Array(mask.data.length)
  for (let i = 0; i < mask.data.length; i++) data[i] = 255 - mask.data[i]
  return { width: mask.width, height: mask.height, data }
}

function containingAt(
  masks: GrayMask[],
  px: number,
  py: number,
  radius: number,
): GrayMask | null {
  const hits: { mask: GrayMask; area: number }[] = []
  for (const mask of masks) {
    let hit = false
    for (let dy = -radius; dy <= radius && !hit; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (pixelAt(mask, px + dx, py + dy) > 128) {
          hit = true
          break
        }
      }
    }
    if (hit) hits.push({ mask, area: areaOf(mask) })
  }
  if (hits.length === 0) return null
  hits.sort((a, b) => a.area - b.area)
  return hits[0].mask
}

/**
 * Automatic SAM2 returns many object masks. A Composer pin is a click.
 * Prefer the smallest white region that covers the click (sofa, not room).
 */
export function pickMaskAtClick(masks: GrayMask[], x: number, y: number): GrayMask {
  if (masks.length === 0) {
    throw new Error('SAM2 returned no masks')
  }
  const { width, height } = masks[0]
  const px = Math.min(Math.max(Math.round(x * (width - 1)), 0), width - 1)
  const py = Math.min(Math.max(Math.round(y * (height - 1)), 0), height - 1)

  const oriented = masks.map(mask => {
    const white = areaOf(mask)
    const total = mask.data.length || 1
    return white / total > 0.55 ? invert(mask) : mask
  })

  for (const radius of [0, 6, 18]) {
    const hit = containingAt(oriented, px, py, radius)
    if (hit) return hit
  }

  throw new Error('SAM2 did not find furniture at that spot. Click the piece itself.')
}
