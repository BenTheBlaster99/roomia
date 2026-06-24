import type {
  DoorOpening,
  FloorPlanData,
  PlanPoint,
  WallSegment,
  WindowOpening,
} from '@/types/floor-plan'

export interface PlanTransform {
  scale: number
  offsetX: number
  offsetY: number
  planWidth: number
  planLength: number
}

export interface PlanBounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  width: number
  length: number
}

export interface WallDrawSegment {
  start: PlanPoint
  end: PlanPoint
}

const PADDING = 50

export function getPlanBounds(plan: FloorPlanData): PlanBounds {
  const points: PlanPoint[] = []

  for (const wall of plan.walls) {
    points.push(wall.start, wall.end)
  }
  for (const room of plan.rooms) {
    points.push(...room.points)
  }

  if (points.length === 0) {
    return {
      minX: 0,
      minZ: 0,
      maxX: plan.dimensions.width,
      maxZ: plan.dimensions.length,
      width: plan.dimensions.width,
      length: plan.dimensions.length,
    }
  }

  const xs = points.map(p => p.x)
  const zs = points.map(p => p.z)

  const minX = Math.min(...xs, 0)
  const minZ = Math.min(...zs, 0)
  const maxX = Math.max(...xs, plan.dimensions.width)
  const maxZ = Math.max(...zs, plan.dimensions.length)

  return {
    minX,
    minZ,
    maxX,
    maxZ,
    width: maxX - minX,
    length: maxZ - minZ,
  }
}

export function createPlanTransform(
  plan: FloorPlanData,
  containerWidth: number,
  canvasHeight: number,
): PlanTransform {
  const bounds = getPlanBounds(plan)
  const availW = containerWidth - PADDING * 2
  const availH = canvasHeight - PADDING * 2
  const scale = Math.min(availW / bounds.width, availH / bounds.length)
  const drawW = bounds.width * scale
  const drawH = bounds.length * scale

  return {
    scale,
    offsetX: PADDING + (availW - drawW) / 2 - bounds.minX * scale,
    offsetY: PADDING + (availH - drawH) / 2 - bounds.minZ * scale,
    planWidth: bounds.width,
    planLength: bounds.length,
  }
}

export function planToCanvas(point: PlanPoint, transform: PlanTransform): { x: number; y: number } {
  return {
    x: transform.offsetX + point.x * transform.scale,
    y: transform.offsetY + point.z * transform.scale,
  }
}

export function canvasToPlan(x: number, y: number, transform: PlanTransform): PlanPoint {
  return {
    x: (x - transform.offsetX) / transform.scale,
    z: (y - transform.offsetY) / transform.scale,
  }
}

export function wallLengthM(wall: WallSegment): number {
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.z - wall.start.z
  return Math.hypot(dx, dz)
}

export function pointOnWall(wall: WallSegment, offsetM: number): PlanPoint {
  const length = wallLengthM(wall)
  if (length <= 0) return { ...wall.start }

  const t = Math.max(0, Math.min(1, offsetM / length))
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    z: wall.start.z + (wall.end.z - wall.start.z) * t,
  }
}

interface OpeningSpan {
  start: number
  end: number
}

function mergeOpeningSpans(spans: OpeningSpan[]): OpeningSpan[] {
  if (spans.length === 0) return []

  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: OpeningSpan[] = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const current = sorted[i]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push({ ...current })
    }
  }

  return merged
}

export function splitWallSegments(
  wall: WallSegment,
  doors: DoorOpening[],
  windows: WindowOpening[],
): WallDrawSegment[] {
  const length = wallLengthM(wall)
  if (length <= 0) return []

  const spans = mergeOpeningSpans([
    ...doors
      .filter(d => d.wallId === wall.id)
      .map(d => ({ start: d.offset - d.width / 2, end: d.offset + d.width / 2 })),
    ...windows
      .filter(w => w.wallId === wall.id)
      .map(w => ({ start: w.offset - w.width / 2, end: w.offset + w.width / 2 })),
  ])

  if (spans.length === 0) {
    return [{ start: wall.start, end: wall.end }]
  }

  const segments: WallDrawSegment[] = []
  let cursor = 0

  for (const span of spans) {
    const gapStart = Math.max(0, span.start)
    const gapEnd = Math.min(length, span.end)
    if (gapStart > cursor) {
      segments.push({
        start: pointOnWall(wall, cursor),
        end: pointOnWall(wall, gapStart),
      })
    }
    cursor = Math.max(cursor, gapEnd)
  }

  if (cursor < length) {
    segments.push({
      start: pointOnWall(wall, cursor),
      end: pointOnWall(wall, length),
    })
  }

  return segments.filter(segment => segmentLengthM(segment.start, segment.end) > 0.01)
}

function segmentLengthM(start: PlanPoint, end: PlanPoint): number {
  return Math.hypot(end.x - start.x, end.z - start.z)
}

export function wallUnitVector(wall: WallSegment): { x: number; z: number } {
  const length = wallLengthM(wall)
  if (length <= 0) return { x: 1, z: 0 }
  return {
    x: (wall.end.x - wall.start.x) / length,
    z: (wall.end.z - wall.start.z) / length,
  }
}

export function wallNormal(wall: WallSegment): { x: number; z: number } {
  const unit = wallUnitVector(wall)
  return { x: -unit.z, z: unit.x }
}

export function roomPolygonPoints(
  points: PlanPoint[],
  transform: PlanTransform,
): number[] {
  return points.flatMap(point => {
    const canvas = planToCanvas(point, transform)
    return [canvas.x, canvas.y]
  })
}

export function doorLeafPoints(
  door: DoorOpening,
  wall: WallSegment,
): { hinge: PlanPoint; leafEnd: PlanPoint } {
  const length = wallLengthM(wall)
  const half = door.width / 2

  const openingStart = pointOnWall(wall, Math.max(0, door.offset - half))
  const openingEnd = pointOnWall(wall, Math.min(length, door.offset + half))

  const hinge = door.hinge === 'right' ? openingEnd : openingStart
  const leafEnd = door.hinge === 'right' ? openingStart : openingEnd

  return { hinge, leafEnd }
}

export function windowMarkPoints(
  window: WindowOpening,
  wall: WallSegment,
): { start: PlanPoint; end: PlanPoint } {
  const length = wallLengthM(wall)
  const start = pointOnWall(wall, Math.max(0, window.offset - window.width / 2))
  const end = pointOnWall(wall, Math.min(length, window.offset + window.width / 2))
  return { start, end }
}

export const PLAN_COLORS = {
  canvasBg: '#F5F2EC',
  floor: '#FFFFFF',
  wallExterior: '#2F2F2F',
  wallInterior: '#6B6B6B',
  door: '#444444',
  doorArc: '#888888',
  window: '#5B8FD9',
  windowGlass: '#A8C8F0',
  dimension: '#8A8480',
  roomLabel: '#5C5C5C',
  grid: '#E8E4DE',
} as const
