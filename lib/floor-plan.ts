import type { FurnitureItem } from '@/types'
import type {
  FloorPlanData,
  FloorPlanDimensions,
  FloorPlanSource,
  FurnitureDimensions,
  PlacedFurniture,
  PlanPoint,
  WallSegment,
} from '@/types/floor-plan'

const WALL_THICKNESS_M = 0.12
const DEFAULT_DIMENSIONS: FloorPlanDimensions = {
  width: 4,
  length: 5,
  height: 2.8,
}

export const FURNITURE_DIMENSIONS: Record<string, FurnitureDimensions> = {
  Sofa: { width: 2.1, depth: 0.85, height: 0.8 },
  Bed: { width: 1.6, depth: 2, height: 0.5 },
  Chair: { width: 0.65, depth: 0.65, height: 0.85 },
  'Coffee Table': { width: 1.1, depth: 0.6, height: 0.45 },
  'Dining Table': { width: 1.4, depth: 0.8, height: 0.75 },
  Light: { width: 0.3, depth: 0.3, height: 1.6 },
}

const FALLBACK_FURNITURE_DIMENSIONS: FurnitureDimensions = {
  width: 0.8,
  depth: 0.8,
  height: 0.8,
}

interface CreateRectangularFloorPlanInput {
  room?: string
  styleId?: string
  budgetTier?: string
  width: number
  length: number
  height: number
  furniture?: FurnitureItem[]
  source?: FloorPlanSource
}

export function createRectangularFloorPlan({
  room,
  styleId,
  budgetTier,
  width,
  length,
  height,
  furniture = [],
  source = 'manual',
}: CreateRectangularFloorPlanInput): FloorPlanData {
  const dimensions = sanitizeDimensions({ width, length, height })
  const walls = createRectangularWalls(dimensions)
  const now = new Date().toISOString()

  return {
    schemaVersion: 1,
    units: 'm',
    source,
    dimensions,
    walls,
    doors: [],
    windows: [],
    rooms: [
      {
        id: 'room-main',
        name: room ?? 'Room',
        type: room,
        points: [
          { x: 0, z: 0 },
          { x: dimensions.width, z: 0 },
          { x: dimensions.width, z: dimensions.length },
          { x: 0, z: dimensions.length },
        ],
        labelPosition: {
          x: dimensions.width / 2,
          z: dimensions.length / 2,
        },
      },
    ],
    furniture: createInitialFurniturePlacements(furniture, dimensions),
    metadata: {
      room,
      styleId,
      budgetTier,
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function getFurnitureDimensions(category: string): FurnitureDimensions {
  return FURNITURE_DIMENSIONS[category] ?? FALLBACK_FURNITURE_DIMENSIONS
}

function sanitizeDimensions(dimensions: FloorPlanDimensions): FloorPlanDimensions {
  return {
    width: positiveOrDefault(dimensions.width, DEFAULT_DIMENSIONS.width),
    length: positiveOrDefault(dimensions.length, DEFAULT_DIMENSIONS.length),
    height: positiveOrDefault(dimensions.height, DEFAULT_DIMENSIONS.height),
  }
}

function positiveOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function createRectangularWalls({ width, length, height }: FloorPlanDimensions): WallSegment[] {
  return [
    createWall('wall-south', { x: 0, z: 0 }, { x: width, z: 0 }, height),
    createWall('wall-east', { x: width, z: 0 }, { x: width, z: length }, height),
    createWall('wall-north', { x: width, z: length }, { x: 0, z: length }, height),
    createWall('wall-west', { x: 0, z: length }, { x: 0, z: 0 }, height),
  ]
}

function createWall(
  id: string,
  start: PlanPoint,
  end: PlanPoint,
  height: number,
): WallSegment {
  return {
    id,
    start,
    end,
    height,
    thickness: WALL_THICKNESS_M,
    kind: 'exterior',
  }
}

interface ResolvePlanInput {
  stored: FloorPlanData | null
  room?: string
  styleId?: string
  budgetTier?: string
  width: number
  length: number
  height: number
  furniture: FurnitureItem[]
}

export function resolvePlanForView({
  stored,
  room,
  styleId,
  budgetTier,
  width,
  length,
  height,
  furniture,
}: ResolvePlanInput): FloorPlanData {
  const dimensions = sanitizeDimensions({ width, length, height })

  const storedMatchesSession =
    stored &&
    Math.abs(stored.dimensions.width - dimensions.width) < 1.5 &&
    Math.abs(stored.dimensions.length - dimensions.length) < 1.5

  if (stored && (stored.source === 'scanner' || storedMatchesSession)) {
    return {
      ...stored,
      dimensions,
      furniture: mergeFurniturePlacements(stored.furniture, furniture, dimensions),
      metadata: {
        ...stored.metadata,
        room,
        styleId,
        budgetTier,
        updatedAt: new Date().toISOString(),
      },
    }
  }

  return createRectangularFloorPlan({
    room,
    styleId,
    budgetTier,
    width: dimensions.width,
    length: dimensions.length,
    height: dimensions.height,
    furniture,
    source: 'manual',
  })
}

function mergeFurniturePlacements(
  stored: PlacedFurniture[],
  furniture: FurnitureItem[],
  dimensions: FloorPlanDimensions,
): PlacedFurniture[] {
  const storedByItemId = new Map(
    stored
      .filter(item => item.status === 'active')
      .map(item => [item.furnitureItemId, item]),
  )

  const kept = furniture.flatMap(item => {
    const existing = storedByItemId.get(item.id)
    if (!existing) return []

    return [
      {
        ...existing,
        name: item.name,
        category: item.category,
        modelUrl: item.model_url,
        partnerLink: item.partner_link,
      },
    ]
  })

  const missingItems = furniture.filter(item => !storedByItemId.has(item.id))
  const newPlacements = createInitialFurniturePlacements(missingItems, dimensions)

  return kept.length > 0 || newPlacements.length > 0
    ? [...kept, ...newPlacements]
    : createInitialFurniturePlacements(furniture, dimensions)
}

function createInitialFurniturePlacements(
  furniture: FurnitureItem[],
  { width, length }: FloorPlanDimensions,
): PlacedFurniture[] {
  const margin = 0.3
  const placements: PlacedFurniture[] = []
  const taken: { x: number; z: number; dimensions: FurnitureDimensions }[] = []

  function place(item: FurnitureItem, x: number, z: number, rotationDeg = 0) {
    const dimensions = getFurnitureDimensions(item.category)
    const position = {
      x: clamp(x, margin + dimensions.width / 2, width - margin - dimensions.width / 2),
      z: clamp(z, margin + dimensions.depth / 2, length - margin - dimensions.depth / 2),
    }

    placements.push({
      id: `placement-${item.id}`,
      furnitureItemId: item.id,
      name: item.name,
      category: item.category,
      position,
      rotationDeg,
      dimensions,
      status: 'active',
      modelUrl: item.model_url,
      partnerLink: item.partner_link,
    })
    taken.push({ ...position, dimensions })
  }

  function overlaps(x: number, z: number, dimensions: FurnitureDimensions) {
    return taken.some(item =>
      Math.abs(x - item.x) < (dimensions.width + item.dimensions.width) / 2 + 0.15 &&
      Math.abs(z - item.z) < (dimensions.depth + item.dimensions.depth) / 2 + 0.15
    )
  }

  furniture.forEach((item, index) => {
    const dimensions = getFurnitureDimensions(item.category)
    const defaultPosition = getDefaultFurniturePosition(item.category, index, width, length)
    const fallbackPosition = {
      x: margin + dimensions.width / 2 + index * (dimensions.width + 0.3),
      z: length - margin - dimensions.depth / 2,
    }
    const position = overlaps(defaultPosition.x, defaultPosition.z, dimensions)
      ? fallbackPosition
      : defaultPosition

    place(item, position.x, position.z, defaultPosition.rotationDeg)
  })

  return placements
}

function getDefaultFurniturePosition(
  category: string,
  index: number,
  width: number,
  length: number,
): PlanPoint & { rotationDeg: number } {
  if (category === 'Sofa') {
    return { x: width / 2 + index * 0.25, z: 0.75, rotationDeg: 0 }
  }

  if (category === 'Bed') {
    return { x: width / 2 + index * 0.25, z: 1.3, rotationDeg: 0 }
  }

  if (category === 'Coffee Table') {
    return { x: width / 2, z: 1.9, rotationDeg: 0 }
  }

  if (category === 'Dining Table') {
    return { x: width * 0.72, z: length * 0.35, rotationDeg: 0 }
  }

  if (category === 'Chair') {
    return {
      x: index % 2 === 0 ? width * 0.25 : width * 0.75,
      z: 2 + Math.floor(index / 2) * 0.8,
      rotationDeg: 0,
    }
  }

  if (category === 'Light') {
    return {
      x: index % 2 === 0 ? width * 0.3 : width * 0.7,
      z: length * 0.4,
      rotationDeg: 0,
    }
  }

  return {
    x: width * 0.5,
    z: length * 0.6,
    rotationDeg: 0,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2
  return Math.max(min, Math.min(max, value))
}
