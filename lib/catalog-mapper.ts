import { CATEGORY_COLORS, CATEGORY_DIMS } from '@/lib/studio-constants'
import { SLUG_TO_STYLE } from '@/lib/style-room-presentation'
import type { CatalogItem } from '@/lib/mock-catalog'
import type { FurnitureItem } from '@/types'

/** Placement dims for AI-generated pieces (metres). */
const GENERATED_DIMS: Record<string, { width: number; depth: number; height: number }> = {
  'Generated Bed': { width: 1.60, depth: 2.00, height: 1.05 },
  'Generated Chair': { width: 0.80, depth: 1.20, height: 1.10 },
}

export function furnitureItemToCatalogItem(item: FurnitureItem): CatalogItem {
  const style = SLUG_TO_STYLE[item.style_id] ?? 'Industrial'
  const rooms = item.room.split(',').map(r => r.trim()).filter(Boolean)

  return {
    id: item.id,
    name: item.name,
    category: item.category,
    room: rooms.length > 0 ? rooms : [item.room],
    style,
    price: item.price,
    color: CATEGORY_COLORS[item.category] ?? '#888888',
    modelUrl: item.model_url,
    imageKeyword: item.image_keyword,
    available: Boolean(item.model_url),
    notes: item.notes ?? undefined,
    dimensions: GENERATED_DIMS[item.name] ?? CATEGORY_DIMS[item.category],
    fromDatabase: true,
  }
}
