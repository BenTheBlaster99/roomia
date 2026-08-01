import { getFurnitureDimensions } from '@/lib/floor-plan'
import { wallLengthM } from '@/lib/plan-view'
import type { FurnitureItem } from '@/types'
import type {
  DoorHinge,
  DoorOpening,
  DoorSwing,
  FloorPlanData,
  FurnitureDimensions,
  PlacedFurniture,
  WallSegment,
  WindowOpening,
} from '@/types/floor-plan'

export function touchPlan(plan: FloorPlanData): FloorPlanData {
  return {
    ...plan,
    metadata: { ...plan.metadata, updatedAt: new Date().toISOString() },
  }
}

export function getWallById(plan: FloorPlanData, wallId: string): WallSegment | undefined {
  return plan.walls.find(w => w.id === wallId)
}

export function suggestOpeningOffset(
  plan: FloorPlanData,
  wallId: string,
  openingWidth: number,
): number {
  const wall = getWallById(plan, wallId)
  if (!wall) return 1

  const length = wallLengthM(wall)
  const margin = openingWidth / 2 + 0.15
  const preferred = length / 2

  const taken = [
    ...plan.doors.filter(d => d.wallId === wallId).map(d => d.offset),
    ...plan.windows.filter(w => w.wallId === wallId).map(w => w.offset),
  ]

  if (!taken.includes(preferred)) {
    return clampOffset(preferred, openingWidth, length)
  }

  for (let offset = margin; offset <= length - margin; offset += 0.25) {
    if (!taken.some(t => Math.abs(t - offset) < openingWidth + 0.2)) {
      return offset
    }
  }

  return clampOffset(preferred, openingWidth, length)
}

function clampOffset(offset: number, width: number, wallLength: number): number {
  const half = width / 2 + 0.1
  return Math.max(half, Math.min(wallLength - half, offset))
}

export function addDoorToPlan(
  plan: FloorPlanData,
  wallId: string,
  offset?: number,
  width = 0.9,
): FloorPlanData {
  const wall = getWallById(plan, wallId)
  if (!wall) return plan

  const wallLen = wallLengthM(wall)
  const resolvedWidth = plan.metadata?.needsWallDimensions
    ? relativeOpeningWidth(wallLen, 0.14, 0.04)
    : clampOpeningWidth(width, wallLen, 0.45)
  const resolvedOffset = offset ?? suggestOpeningOffset(plan, wallId, resolvedWidth)
  const newDoor: DoorOpening = {
    id: `door-${Date.now()}`,
    wallId,
    offset: resolvedOffset,
    width: resolvedWidth,
    height: 2.05,
    hinge: 'left',
    swing: 'in',
  }

  return touchPlan({ ...plan, doors: [...plan.doors, newDoor] })
}

export function addWindowToPlan(
  plan: FloorPlanData,
  wallId: string,
  offset?: number,
  width = 1.2,
): FloorPlanData {
  const wall = getWallById(plan, wallId)
  if (!wall) return plan

  const wallLen = wallLengthM(wall)
  const resolvedWidth = plan.metadata?.needsWallDimensions
    ? relativeOpeningWidth(wallLen, 0.18, 0.05)
    : clampOpeningWidth(width, wallLen, 0.55)
  const resolvedOffset = offset ?? suggestOpeningOffset(plan, wallId, resolvedWidth)
  const newWindow: WindowOpening = {
    id: `window-${Date.now()}`,
    wallId,
    offset: resolvedOffset,
    width: resolvedWidth,
    height: 1.2,
    sillHeight: 0.9,
  }

  return touchPlan({ ...plan, windows: [...plan.windows, newWindow] })
}

export function deleteElementFromPlan(
  plan: FloorPlanData,
  type: 'door' | 'window',
  id: string,
): FloorPlanData {
  if (type === 'door') {
    return touchPlan({ ...plan, doors: plan.doors.filter(d => d.id !== id) })
  }
  return touchPlan({ ...plan, windows: plan.windows.filter(w => w.id !== id) })
}

export function updateWallInPlan(
  plan: FloorPlanData,
  wallId: string,
  updates: { thickness?: number; length?: number; kind?: WallSegment['kind'] },
): FloorPlanData {
  const wall = getWallById(plan, wallId)
  if (
    wall &&
    plan.metadata?.needsWallDimensions &&
    updates.length !== undefined &&
    updates.length > 0
  ) {
    const currentLength = wallLengthM(wall)
    if (currentLength > 0) {
      const factor = updates.length / currentLength
      const scaled = scalePlanUniform(plan, factor)
      return touchPlan({
        ...scaled,
        metadata: {
          ...scaled.metadata,
          needsWallDimensions: false,
          scanNotes: 'Wall lengths applied — review the plan or edit individual walls.',
        },
      })
    }
  }

  return touchPlan({
    ...plan,
    walls: plan.walls.map(w => {
      if (w.id !== wallId) return w

      let next = { ...w }
      if (updates.thickness !== undefined && updates.thickness > 0) {
        next.thickness = updates.thickness
      }
      if (updates.kind !== undefined) {
        next.kind = updates.kind
      }
      if (updates.length !== undefined && updates.length > 0) {
        next = setWallLength(next, updates.length)
      }
      return next
    }),
  })
}

/** Scale every plan coordinate and opening size from a shape-only scan. */
export function scalePlanUniform(plan: FloorPlanData, factor: number): FloorPlanData {
  if (!Number.isFinite(factor) || factor <= 0) return plan

  const scalePoint = (p: { x: number; z: number }) => ({
    x: p.x * factor,
    z: p.z * factor,
  })

  const walls = plan.walls.map(wall => ({
    ...wall,
    start: scalePoint(wall.start),
    end: scalePoint(wall.end),
    thickness: wall.thickness * factor,
  }))

  const bounds = boundsFromWallList(walls)
  const dimensions = {
    width: bounds.width || plan.dimensions.width * factor,
    length: bounds.length || plan.dimensions.length * factor,
    height: plan.dimensions.height,
  }

  return {
    ...plan,
    dimensions,
    walls,
    doors: plan.doors.map(door => ({
      ...door,
      offset: door.offset * factor,
      width: door.width * factor,
    })),
    windows: plan.windows.map(window => ({
      ...window,
      offset: window.offset * factor,
      width: window.width * factor,
    })),
    rooms: plan.rooms.map(room => ({
      ...room,
      points: room.points.map(scalePoint),
      labelPosition: room.labelPosition ? scalePoint(room.labelPosition) : room.labelPosition,
    })),
    furniture: plan.furniture.map(item => ({
      ...item,
      position: scalePoint(item.position),
      dimensions: {
        width: item.dimensions.width * factor,
        depth: item.dimensions.depth * factor,
        height: item.dimensions.height * factor,
      },
    })),
  }
}

function boundsFromWallList(walls: WallSegment[]): { width: number; length: number } {
  if (walls.length === 0) return { width: 0, length: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const wall of walls) {
    minX = Math.min(minX, wall.start.x, wall.end.x)
    maxX = Math.max(maxX, wall.start.x, wall.end.x)
    minZ = Math.min(minZ, wall.start.z, wall.end.z)
    maxZ = Math.max(maxZ, wall.start.z, wall.end.z)
  }
  return { width: Math.max(0, maxX - minX), length: Math.max(0, maxZ - minZ) }
}

export function setWallLength(wall: WallSegment, newLength: number): WallSegment {
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.z - wall.start.z
  const currentLength = Math.hypot(dx, dz)
  if (currentLength <= 0) return wall

  const scale = newLength / currentLength
  return {
    ...wall,
    end: {
      x: wall.start.x + dx * scale,
      z: wall.start.z + dz * scale,
    },
  }
}

export function updateDoorInPlan(
  plan: FloorPlanData,
  doorId: string,
  updates: { offset?: number; width?: number; hinge?: DoorHinge; swing?: DoorSwing },
): FloorPlanData {
  return touchPlan({
    ...plan,
    doors: plan.doors.map(door => {
      if (door.id !== doorId) return door
      const wall = getWallById(plan, door.wallId)
      const wallLen = wall ? wallLengthM(wall) : undefined
      const width = wallLen ? clampOpeningWidth(updates.width ?? door.width, wallLen, 0.45) : updates.width ?? door.width
      const offset =
        updates.offset !== undefined && wallLen
          ? clampOffset(updates.offset, width, wallLen)
          : (updates.offset ?? door.offset)

      return {
        ...door,
        ...updates,
        width,
        offset,
      }
    }),
  })
}

export function updateWindowInPlan(
  plan: FloorPlanData,
  windowId: string,
  updates: { offset?: number; width?: number; sillHeight?: number },
): FloorPlanData {
  return touchPlan({
    ...plan,
    windows: plan.windows.map(window => {
      if (window.id !== windowId) return window
      const wall = getWallById(plan, window.wallId)
      const wallLen = wall ? wallLengthM(wall) : undefined
      const width = wallLen ? clampOpeningWidth(updates.width ?? window.width, wallLen, 0.55) : updates.width ?? window.width
      const offset =
        updates.offset !== undefined && wallLen
          ? clampOffset(updates.offset, width, wallLen)
          : (updates.offset ?? window.offset)

      return {
        ...window,
        ...updates,
        width,
        offset,
      }
    }),
  })
}

export function getWallLength(wall: WallSegment): number {
  return wallLengthM(wall)
}

function clampPosition(
  x: number,
  z: number,
  dimensions: FurnitureDimensions,
  width: number,
  length: number,
): { x: number; z: number } {
  const margin = 0.3
  return {
    x: Math.max(margin + dimensions.width / 2, Math.min(width - margin - dimensions.width / 2, x)),
    z: Math.max(margin + dimensions.depth / 2, Math.min(length - margin - dimensions.depth / 2, z)),
  }
}

function relativeOpeningWidth(wallLength: number, ratio: number, minimum: number): number {
  if (!Number.isFinite(wallLength) || wallLength <= 0) return minimum
  return clampOpeningWidth(wallLength * ratio, wallLength, 0.45)
}

function clampOpeningWidth(width: number, wallLength: number, maxRatio: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0.1
  if (!Number.isFinite(wallLength) || wallLength <= 0) return width
  const max = Math.max(0.04, wallLength * maxRatio)
  return Math.min(width, max)
}

function furnitureOverlaps(
  x: number,
  z: number,
  dimensions: FurnitureDimensions,
  others: PlacedFurniture[],
): boolean {
  return others.some(item =>
    Math.abs(x - item.position.x) < (dimensions.width + item.dimensions.width) / 2 + 0.15 &&
    Math.abs(z - item.position.z) < (dimensions.depth + item.dimensions.depth) / 2 + 0.15,
  )
}

function suggestFurniturePosition(
  plan: FloorPlanData,
  dimensions: FurnitureDimensions,
): { x: number; z: number } {
  const { width, length } = plan.dimensions
  const active = plan.furniture.filter(item => item.status === 'active')
  const candidates = [
    { x: width / 2, z: length / 2 },
    { x: width * 0.35, z: length * 0.35 },
    { x: width * 0.65, z: length * 0.35 },
    { x: width * 0.35, z: length * 0.65 },
    { x: width * 0.65, z: length * 0.65 },
  ]

  for (let ring = 0; ring < 6; ring += 1) {
    for (const base of candidates) {
      const offset = ring * 0.35
      const position = clampPosition(base.x + offset, base.z + offset, dimensions, width, length)
      if (!furnitureOverlaps(position.x, position.z, dimensions, active)) {
        return position
      }
    }
  }

  return clampPosition(width / 2, length / 2, dimensions, width, length)
}

export function addFurnitureToPlan(plan: FloorPlanData, item: FurnitureItem): FloorPlanData {
  const dimensions = getFurnitureDimensions(item.category)
  const position = suggestFurniturePosition(plan, dimensions)

  const placement: PlacedFurniture = {
    id: `placement-${item.id}-${Date.now()}`,
    furnitureItemId: item.id,
    name: item.name,
    category: item.category,
    position,
    rotationDeg: 0,
    dimensions,
    status: 'active',
    modelUrl: item.model_url,
    partnerLink: item.partner_link,
    price: item.price,
  }

  return touchPlan({ ...plan, furniture: [...plan.furniture, placement] })
}

export function removeFurnitureFromPlan(
  plan: FloorPlanData,
  placementId: string,
): FloorPlanData {
  return touchPlan({
    ...plan,
    furniture: plan.furniture.filter(item => item.id !== placementId),
  })
}

export function removeOneFurnitureByCatalogId(
  plan: FloorPlanData,
  furnitureItemId: string,
): FloorPlanData {
  for (let i = plan.furniture.length - 1; i >= 0; i -= 1) {
    const item = plan.furniture[i]
    if (item.status === 'active' && item.furnitureItemId === furnitureItemId) {
      return removeFurnitureFromPlan(plan, item.id)
    }
  }
  return plan
}

export function computePlacedFurnitureTotal(
  plan: FloorPlanData,
  catalog: FurnitureItem[],
): number {
  const catalogById = new Map(catalog.map(item => [item.id, item.price]))

  return plan.furniture
    .filter(item => item.status === 'active')
    .reduce((sum, item) => sum + (item.price ?? catalogById.get(item.furnitureItemId) ?? 0), 0)
}
