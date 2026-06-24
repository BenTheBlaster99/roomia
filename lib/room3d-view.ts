import { getPlanBounds, pointOnWall, splitWallSegments, wallLengthM, wallUnitVector } from '@/lib/plan-view'
import type {
  DoorOpening,
  FloorPlanData,
  PlanPoint,
  WallSegment,
} from '@/types/floor-plan'

export interface SceneFrame {
  centerX: number
  centerZ: number
  span: number
  width: number
  length: number
  height: number
  minX: number
  minZ: number
}

export function getSceneFrame(plan: FloorPlanData): SceneFrame {
  const bounds = getPlanBounds(plan)
  const span = Math.max(bounds.width, bounds.length, plan.dimensions.height)

  return {
    centerX: bounds.minX + bounds.width / 2,
    centerZ: bounds.minZ + bounds.length / 2,
    span,
    width: bounds.width,
    length: bounds.length,
    height: plan.dimensions.height,
    minX: bounds.minX,
    minZ: bounds.minZ,
  }
}

export interface WallMeshSpec {
  id: string
  start: PlanPoint
  end: PlanPoint
  height: number
  thickness: number
  kind: WallSegment['kind']
}

export function buildWallMeshSpecs(plan: FloorPlanData): WallMeshSpec[] {
  return plan.walls.flatMap(wall =>
    splitWallSegments(wall, plan.doors, plan.windows).map((segment, index) => ({
      id: `${wall.id}-${index}`,
      start: segment.start,
      end: segment.end,
      height: wall.height ?? plan.dimensions.height,
      thickness: wall.thickness,
      kind: wall.kind,
    })),
  )
}

export function wallSegmentTransform(spec: WallMeshSpec): {
  position: [number, number, number]
  rotationY: number
  length: number
} {
  const dx = spec.end.x - spec.start.x
  const dz = spec.end.z - spec.start.z
  const length = Math.hypot(dx, dz)

  return {
    position: [(spec.start.x + spec.end.x) / 2, spec.height / 2, (spec.start.z + spec.end.z) / 2],
    rotationY: Math.atan2(dz, dx),
    length,
  }
}

export interface WindowMeshSpec {
  id: string
  center: PlanPoint
  width: number
  height: number
  sillHeight: number
  rotationY: number
}

export function buildWindowMeshSpecs(plan: FloorPlanData): WindowMeshSpec[] {
  const wallById = new Map(plan.walls.map(wall => [wall.id, wall]))

  return plan.windows.flatMap(window => {
    const wall = wallById.get(window.wallId)
    if (!wall) return []

    const unit = wallUnitVector(wall)
    return [
      {
        id: window.id,
        center: pointOnWall(wall, window.offset),
        width: window.width,
        height: window.height,
        sillHeight: window.sillHeight,
        rotationY: Math.atan2(unit.z, unit.x),
      },
    ]
  })
}

export interface DoorMeshSpec {
  id: string
  hinge: PlanPoint
  leafEnd: PlanPoint
  height: number
  rotationY: number
  swing: DoorOpening['swing']
}

export function buildDoorMeshSpecs(plan: FloorPlanData): DoorMeshSpec[] {
  const wallById = new Map(plan.walls.map(wall => [wall.id, wall]))

  return plan.doors.flatMap(door => {
    const wall = wallById.get(door.wallId)
    if (!wall) return []

    const length = wallLengthM(wall)
    const half = door.width / 2
    const openingStart = pointOnWall(wall, Math.max(0, door.offset - half))
    const openingEnd = pointOnWall(wall, Math.min(length, door.offset + half))
    const hinge = door.hinge === 'right' ? openingEnd : openingStart
    const leafEnd = door.hinge === 'right' ? openingStart : openingEnd
    const unit = wallUnitVector(wall)

    return [
      {
        id: door.id,
        hinge,
        leafEnd,
        height: door.height,
        rotationY: Math.atan2(unit.z, unit.x),
        swing: door.swing,
      },
    ]
  })
}

export const ROOM3D_COLORS = {
  floor: '#E8E2D9',
  wallExterior: '#EEEAE4',
  wallInterior: '#F4F0EB',
  windowGlass: '#A8C8F0',
  windowFrame: '#5B8FD9',
  door: '#8B7355',
} as const
