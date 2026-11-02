import { loadSharp } from './load-sharp'

/**
 * What counts as a delivered photo (the moment the credit is spent): the provider's answer decodes
 * to a real image of at least 512 px, it isn't one flat colour, and it is saved on the PC. An HTTP
 * success alone is not enough. Whether the photo respects the design is judged by people: the
 * user can report it (see lib/credits.ts fileClaim) and an admin decides on a refund.
 */
export async function checkDeliveredImage(data: Buffer): Promise<string | null> {
  if (data.length < 10_000) return 'image vide ou tronquée'
  const sharp = loadSharp()
  const meta = await sharp(data).metadata().catch(() => null)
  if (!meta?.width || !meta?.height || Math.min(meta.width, meta.height) < 512) return 'image illisible ou trop petite'
  const { channels } = await sharp(data).stats()
  if (channels.every(c => c.stdev < 3)) return 'image uniforme (vide)'
  return null
}
