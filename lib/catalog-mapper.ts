import { CATEGORY_COLORS, CATEGORY_DIMS } from '@/lib/studio-constants'
import { SLUG_TO_STYLE } from '@/lib/style-room-presentation'
import type { CatalogItem } from '@/lib/mock-catalog'
import type { FurnitureItem } from '@/types'

/** Placement dims for AI-generated pieces (metres). */
/** Placement dims (metres). Undersized values make pieces vanish in photoreal renders. */
const GENERATED_DIMS: Record<string, { width: number; depth: number; height: number }> = {
  'Generated Bed': { width: 1.60, depth: 2.00, height: 1.05 },
  'Generated Chair': { width: 0.70, depth: 0.75, height: 1.00 },
  'testing-bed2': { width: 1.60, depth: 2.00, height: 1.05 },
  'testing-chair2': { width: 0.70, depth: 0.75, height: 1.00 },
  'brown-chair': { width: 0.65, depth: 0.70, height: 0.95 },
  'cozy-chair': { width: 0.75, depth: 0.80, height: 0.95 },
  'long-chair': { width: 0.65, depth: 0.85, height: 1.00 },
  'short-chair': { width: 0.55, depth: 0.60, height: 0.90 },
  'Mid-Way': { width: 0.55, depth: 0.60, height: 0.90 },
}

const GENERATED_MODEL_URLS: Record<string, string> = {
  'Generated Bed': '/models/generated-bed.glb',
  'Generated Chair': '/models/generated-chair.glb',
}

export function furnitureItemToCatalogItem(item: FurnitureItem): CatalogItem {
  const style = SLUG_TO_STYLE[item.style_id] ?? 'Industrial'
  const rooms = item.room.split(',').map(r => r.trim()).filter(Boolean)
  const modelUrl = item.model_url ?? GENERATED_MODEL_URLS[item.name] ?? null

  return {
    id: item.id,
    name: item.name,
    category: item.category,
    room: rooms.length > 0 ? rooms : [item.room],
    style,
    price: item.price,
    color: CATEGORY_COLORS[item.category] ?? '#888888',
    modelUrl,
    imageUrl: item.image_url ?? null,
    imageKeyword: item.image_keyword,
    available: Boolean(modelUrl),
    notes: item.notes ?? undefined,
    dimensions: GENERATED_DIMS[item.name] ?? CATEGORY_DIMS[item.category],
    fromDatabase: true,
  }
}
