export type FloorPlanUnits = 'm'
export type FloorPlanSource = 'manual' | 'scanner' | 'imported'
export type WallKind = 'exterior' | 'interior'
export type DoorSwing = 'in' | 'out' | 'sliding'
export type DoorHinge = 'left' | 'right'
export type FurniturePlacementStatus = 'active' | 'hidden' | 'deleted'

/**
 * Shared 2D/3D coordinate in metres.
 * x = room width axis, z = room length/depth axis.
 */
export interface PlanPoint {
  x: number
  z: number
}

export interface FloorPlanDimensions {
  width: number
  length: number
  height: number
}

export interface WallSegment {
  id: string
  start: PlanPoint
  end: PlanPoint
  thickness: number
  height?: number
  kind: WallKind
}

export interface DoorOpening {
  id: string
  wallId: string
  offset: number
  width: number
  height: number
  hinge: DoorHinge
  swing: DoorSwing
}

export interface WindowOpening {
  id: string
  wallId: string
  offset: number
  width: number
  height: number
  sillHeight: number
}

export interface RoomZone {
  id: string
  name: string
  type?: string
  points: PlanPoint[]
  labelPosition?: PlanPoint
}

export interface FurnitureDimensions {
  width: number
  depth: number
  height: number
}

export interface PlacedFurniture {
  id: string
  furnitureItemId: string
  name: string
  category: string
  position: PlanPoint
  rotationDeg: number
  dimensions: FurnitureDimensions
  status: FurniturePlacementStatus
  modelUrl?: string | null
  partnerLink?: string | null
}

export interface FloorPlanMetadata {
  room?: string
  styleId?: string
  budgetTier?: string
  scanConfidence?: 'high' | 'medium' | 'low'
  scanNotes?: string
  createdAt?: string
  updatedAt?: string
}

export interface FloorPlanData {
  schemaVersion: 1
  units: FloorPlanUnits
  source: FloorPlanSource
  dimensions: FloorPlanDimensions
  walls: WallSegment[]
  doors: DoorOpening[]
  windows: WindowOpening[]
  rooms: RoomZone[]
  furniture: PlacedFurniture[]
  metadata?: FloorPlanMetadata
}
