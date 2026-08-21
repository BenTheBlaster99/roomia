import type { FloorMaterial, PlacedItem, RoomConfig } from '@/store/useStudioStore'

export const STUDIO_DESIGN_KEY = 'roomia:studio-design'

const FLOOR_MATERIALS: FloorMaterial[] = ['wood', 'tile', 'concrete', 'carpet', 'marble']

export type SavedStudioDesign = {
  room: RoomConfig
  items: PlacedItem[]
  savedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRoom(value: unknown): RoomConfig | null {
  if (!isRecord(value)) return null
  const width = Number(value.width)
  const length = Number(value.length)
  const height = Number(value.height)
  const floorMaterial = value.floorMaterial
  const wallColor = value.wallColor
  if (!Number.isFinite(width) || width <= 0) return null
  if (!Number.isFinite(length) || length <= 0) return null
  if (!Number.isFinite(height) || height <= 0) return null
  if (typeof floorMaterial !== 'string' || !FLOOR_MATERIALS.includes(floorMaterial as FloorMaterial)) {
    return null
  }
  if (typeof wallColor !== 'string') return null
  return {
    width,
    length,
    height,
    floorMaterial: floorMaterial as FloorMaterial,
    wallColor,
  }
}

function parseItem(value: unknown): PlacedItem | null {
  if (!isRecord(value)) return null
  const position = isRecord(value.position) ? value.position : null
  const dimensions = isRecord(value.dimensions) ? value.dimensions : null
  if (!position || !dimensions) return null
  const x = Number(position.x)
  const z = Number(position.z)
  const width = Number(dimensions.width)
  const depth = Number(dimensions.depth)
  const height = Number(dimensions.height)
  if (![x, z, width, depth, height].every(Number.isFinite)) return null
  if (typeof value.id !== 'string' || typeof value.furnitureId !== 'string') return null
  if (typeof value.name !== 'string' || typeof value.category !== 'string') return null
  return {
    id: value.id,
    furnitureId: value.furnitureId,
    name: value.name,
    category: value.category,
    modelUrl: typeof value.modelUrl === 'string' ? value.modelUrl : null,
    position: { x, z },
    rotationY: Number.isFinite(Number(value.rotationY)) ? Number(value.rotationY) : 0,
    dimensions: { width, depth, height },
    color: typeof value.color === 'string' ? value.color : '#888888',
    price: Number.isFinite(Number(value.price)) ? Number(value.price) : 0,
    notes: typeof value.notes === 'string' ? value.notes : null,
  }
}

export function parseStudioDesign(raw: string): SavedStudioDesign | null {
  try {
    const data = JSON.parse(raw) as unknown
    if (!isRecord(data)) return null
    const room = parseRoom(data.room)
    if (!room || !Array.isArray(data.items)) return null
    const items = data.items.map(parseItem).filter((item): item is PlacedItem => item !== null)
    return {
      room,
      items,
      savedAt: typeof data.savedAt === 'string' ? data.savedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function saveStudioDesign(room: RoomConfig, items: PlacedItem[]): SavedStudioDesign {
  const design: SavedStudioDesign = {
    room,
    items,
    savedAt: new Date().toISOString(),
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem(STUDIO_DESIGN_KEY, JSON.stringify(design))
  }
  return design
}

export function loadStudioDesign(): SavedStudioDesign | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(STUDIO_DESIGN_KEY)
  if (!raw) return null
  return parseStudioDesign(raw)
}
