import { CATEGORY_COLORS, CATEGORY_DIMS } from '@/lib/studio-constants'
import { SLUG_TO_STYLE } from '@/lib/style-room-presentation'
import { inferCatalogMaterial } from '@/lib/catalog-material'
import type { CatalogItem } from '@/lib/mock-catalog'
import type { FurnitureItem } from '@/types'

/** Placement dims (metres). Undersized values make pieces vanish in photoreal renders. */
const GENERATED_DIMS: Record<string, { width: number; depth: number; height: number }> = {
  'Generated Bed': { width: 1.6, depth: 2.0, height: 1.05 },
  'Generated Chair': { width: 0.7, depth: 0.75, height: 1.0 },
  'testing-bed2': { width: 1.6, depth: 2.0, height: 1.05 },
  'testing-chair2': { width: 0.7, depth: 0.75, height: 1.0 },
  'brown-chair': { width: 0.65, depth: 0.7, height: 0.95 },
  'cozy-chair': { width: 0.75, depth: 0.8, height: 0.95 },
  'long-chair': { width: 0.65, depth: 0.85, height: 1.0 },
  'short-chair': { width: 0.55, depth: 0.6, height: 0.9 },
  'Mid-Way': { width: 0.72, depth: 0.95, height: 0.92 },
  Pure: { width: 0.88, depth: 0.92, height: 1.08 },
}

/** Refuse absurdly small footprints that break Studio / photoreal. */
const MIN_DIMS: Record<string, { width: number; depth: number; height: number }> = {
  Sofa: { width: 1.4, depth: 0.7, height: 0.7 },
  Bed: { width: 1.2, depth: 1.8, height: 0.7 },
  Chair: { width: 0.45, depth: 0.45, height: 0.75 },
  'Coffee Table': { width: 0.7, depth: 0.4, height: 0.3 },
  'Dining Table': { width: 1.0, depth: 0.7, height: 0.65 },
  Wardrobe: { width: 1.0, depth: 0.45, height: 1.8 },
  'TV Unit': { width: 1.0, depth: 0.35, height: 0.4 },
  'Side Table': { width: 0.35, depth: 0.35, height: 0.4 },
  Bookshelf: { width: 0.5, depth: 0.25, height: 1.2 },
  Rug: { width: 1.2, depth: 0.8, height: 0.01 },
  Light: { width: 0.15, depth: 0.15, height: 0.18 },
  Curtains: { width: 1.0, depth: 0.04, height: 2.0 },
}

export function sanitizeDimensions(
  category: string,
  dims: { width: number; depth: number; height: number },
): { width: number; depth: number; height: number } {
  const floor = MIN_DIMS[category] ?? { width: 0.4, depth: 0.4, height: 0.4 }
  return {
    width: Math.max(dims.width, floor.width),
    depth: Math.max(dims.depth, floor.depth),
    height: Math.max(dims.height, floor.height),
  }
}

const GENERATED_MODEL_URLS: Record<string, string> = {
  'Generated Bed': '/models/generated-bed.glb',
  'Generated Chair': '/models/generated-chair.glb',
}

export function furnitureItemToCatalogItem(item: FurnitureItem): CatalogItem {
  const style = SLUG_TO_STYLE[item.style_id] ?? 'Industrial'
  const rooms = item.room.split(',').map(r => r.trim()).filter(Boolean)
  const rawUrl = item.model_url ?? GENERATED_MODEL_URLS[item.name] ?? null
  const modelUrl =
    item.category === 'Light' && rawUrl?.endsWith('/light.glb') ? null : rawUrl
  const material = inferCatalogMaterial(item.notes, item.category, item.image_keyword)
  const fromDb =
    item.width_m != null && item.depth_m != null && item.height_m != null
      ? { width: Number(item.width_m), depth: Number(item.depth_m), height: Number(item.height_m) }
      : null
  const rawDims = fromDb ?? GENERATED_DIMS[item.name] ?? CATEGORY_DIMS[item.category] ?? {
    width: 0.8,
    depth: 0.8,
    height: 0.8,
  }

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
    available: true,
    notes: item.notes ?? undefined,
    material,
    dimensions: sanitizeDimensions(item.category, rawDims),
    fromDatabase: true,
  }
}

export { inferCatalogMaterial } from '@/lib/catalog-material'
