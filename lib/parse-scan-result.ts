import { createRectangularFloorPlan } from '@/lib/floor-plan'
import type {
  DoorHinge,
  DoorOpening,
  DoorSwing,
  FloorPlanData,
  PlanPoint,
  RoomZone,
  WallKind,
  WallSegment,
  WindowOpening,
} from '@/types/floor-plan'

const DEFAULT_HEIGHT = 2.8
const DEFAULT_WALL_THICKNESS = 0.12

export interface RawScanPayload {
  width_m?: unknown
  length_m?: unknown
  height_m?: unknown
  confidence?: unknown
  notes?: unknown
  walls?: unknown
  doors?: unknown
  windows?: unknown
  rooms?: unknown
}

export interface ParseScanOptions {
  room?: string
  height?: number
}

export interface ParsedScanResult {
  floorPlan: FloorPlanData
  width_m: number
  length_m: number
  height_m: number
  confidence: 'high' | 'medium' | 'low'
  notes: string
}

export function parseScanResultToFloorPlan(
  raw: RawScanPayload,
  options: ParseScanOptions = {},
): ParsedScanResult {
  const confidence = parseConfidence(raw.confidence)
  const notes = typeof raw.notes === 'string' ? raw.notes.trim() : ''
  const height = positive(
    raw.height_m,
    options.height && options.height > 0 ? options.height : DEFAULT_HEIGHT,
  )

  let walls = parseWalls(raw.walls, height)
  const widthFromRaw = positive(raw.width_m, 0)
  const lengthFromRaw = positive(raw.length_m, 0)

  if (walls.length === 0) {
    const width = widthFromRaw || 4
    const length = lengthFromRaw || 5
    walls = createRectangularFloorPlan({
      width,
      length,
      height,
      room: options.room,
      source: 'scanner',
    }).walls
  }

  const bounds = boundsFromWalls(walls)
  const width_m = widthFromRaw || bounds.width || 4
  const length_m = lengthFromRaw || bounds.length || 5

  const dimensions = { width: width_m, length: length_m, height }
  const wallIds = new Set(walls.map(w => w.id))

  const doors = parseDoors(raw.doors, wallIds)
  const windows = parseWindows(raw.windows, wallIds)
  const rooms = parseRooms(raw.rooms, dimensions, options.room)

  const now = new Date().toISOString()

  const floorPlan: FloorPlanData = {
    schemaVersion: 1,
    units: 'm',
    source: 'scanner',
    dimensions,
    walls,
    doors: remapOpeningsToWalls(doors, walls),
    windows: remapOpeningsToWalls(windows, walls),
    rooms: rooms.length > 0 ? rooms : defaultRoomZone(dimensions, options.room),
    furniture: [],
    metadata: {
      room: options.room,
      scanConfidence: confidence,
      scanNotes: notes || undefined,
      createdAt: now,
      updatedAt: now,
    },
  }

  return {
    floorPlan,
    width_m,
    length_m,
    height_m: height,
    confidence,
    notes,
  }
}

function parseConfidence(value: unknown): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'medium'
}

function parseWalls(raw: unknown, height: number): WallSegment[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item, index) => parseWall(item, index, height))
    .filter((wall): wall is WallSegment => wall !== null)
}

function parseWall(raw: unknown, index: number, height: number): WallSegment | null {
  if (!raw || typeof raw !== 'object') return null
  const wall = raw as Record<string, unknown>
  const start = parsePoint(wall.start)
  const end = parsePoint(wall.end)
  if (!start || !end) return null
  if (start.x === end.x && start.z === end.z) return null

  const kind: WallKind = wall.kind === 'interior' ? 'interior' : 'exterior'
  const thickness = positive(wall.thickness, DEFAULT_WALL_THICKNESS)

  return {
    id: typeof wall.id === 'string' && wall.id ? wall.id : `wall-${index + 1}`,
    start,
    end,
    thickness,
    height: positive(wall.height, height),
    kind,
  }
}

function parseDoors(raw: unknown, wallIds: Set<string>): DoorOpening[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item, index) => parseDoor(item, index, wallIds))
    .filter((door): door is DoorOpening => door !== null)
}

function parseDoor(raw: unknown, index: number, wallIds: Set<string>): DoorOpening | null {
  if (!raw || typeof raw !== 'object') return null
  const door = raw as Record<string, unknown>
  const wallId = typeof door.wallId === 'string' ? door.wallId : ''
  if (!wallId) return null

  const hinge: DoorHinge = door.hinge === 'right' ? 'right' : 'left'
  const swing: DoorSwing =
    door.swing === 'out' || door.swing === 'sliding' ? door.swing : 'in'

  return {
    id: typeof door.id === 'string' && door.id ? door.id : `door-${index + 1}`,
    wallId: wallIds.has(wallId) ? wallId : wallId,
    offset: Math.max(0, positive(door.offset, 0)),
    width: positive(door.width, 0.9),
    height: positive(door.height, 2.05),
    hinge,
    swing,
  }
}

function parseWindows(raw: unknown, wallIds: Set<string>): WindowOpening[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item, index) => parseWindow(item, index, wallIds))
    .filter((window): window is WindowOpening => window !== null)
}

function parseWindow(raw: unknown, index: number, wallIds: Set<string>): WindowOpening | null {
  if (!raw || typeof raw !== 'object') return null
  const window = raw as Record<string, unknown>
  const wallId = typeof window.wallId === 'string' ? window.wallId : ''
  if (!wallId) return null

  return {
    id: typeof window.id === 'string' && window.id ? window.id : `window-${index + 1}`,
    wallId: wallIds.has(wallId) ? wallId : wallId,
    offset: Math.max(0, positive(window.offset, 0)),
    width: positive(window.width, 1.2),
    height: positive(window.height, 1.2),
    sillHeight: positive(window.sillHeight, 0.9),
  }
}

function parseRooms(
  raw: unknown,
  dimensions: { width: number; length: number },
  roomName?: string,
): RoomZone[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item, index) => parseRoom(item, index, roomName))
    .filter((room): room is RoomZone => room !== null)
    .map(room => ({
      ...room,
      labelPosition: room.labelPosition ?? centroid(room.points) ?? {
        x: dimensions.width / 2,
        z: dimensions.length / 2,
      },
    }))
}

function parseRoom(raw: unknown, index: number, fallbackName?: string): RoomZone | null {
  if (!raw || typeof raw !== 'object') return null
  const room = raw as Record<string, unknown>
  const points = parsePointList(room.points)
  if (points.length < 3) return null

  const labelPosition = parsePoint(room.labelPosition) ?? undefined

  return {
    id: typeof room.id === 'string' && room.id ? room.id : `room-${index + 1}`,
    name: typeof room.name === 'string' && room.name ? room.name : fallbackName ?? 'Room',
    type: typeof room.type === 'string' ? room.type : fallbackName,
    points,
    labelPosition,
  }
}

function defaultRoomZone(
  dimensions: { width: number; length: number },
  roomName?: string,
): RoomZone[] {
  return [
    {
      id: 'room-main',
      name: roomName ?? 'Room',
      type: roomName,
      points: [
        { x: 0, z: 0 },
        { x: dimensions.width, z: 0 },
        { x: dimensions.width, z: dimensions.length },
        { x: 0, z: dimensions.length },
      ],
      labelPosition: { x: dimensions.width / 2, z: dimensions.length / 2 },
    },
  ]
}

function parsePoint(raw: unknown): PlanPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const point = raw as Record<string, unknown>
  const x = numberOrNull(point.x)
  const z = numberOrNull(point.z)
  if (x === null || z === null) return null
  return { x, z }
}

function parsePointList(raw: unknown): PlanPoint[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parsePoint).filter((point): point is PlanPoint => point !== null)
}

function boundsFromWalls(walls: WallSegment[]): { width: number; length: number } {
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

  return {
    width: Math.max(0, maxX - minX),
    length: Math.max(0, maxZ - minZ),
  }
}

function remapOpeningsToWalls<T extends { wallId: string; offset: number; width: number }>(
  openings: T[],
  walls: WallSegment[],
): T[] {
  if (walls.length === 0) return openings

  return openings.map(opening => {
    const wall = walls.find(w => w.id === opening.wallId)
    if (wall) return opening

    const fallbackWall = walls[0]
    return { ...opening, wallId: fallbackWall.id }
  })
}

function centroid(points: PlanPoint[]): PlanPoint | null {
  if (points.length === 0) return null
  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }),
    { x: 0, z: 0 },
  )
  return { x: total.x / points.length, z: total.z / points.length }
}

function positive(value: unknown, fallback: number): number {
  const num = numberOrNull(value)
  return num !== null && num > 0 ? num : fallback
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function extractJsonFromModelText(text: string): unknown {
  const clean = text.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1))
    }
    throw new Error('Model response was not valid JSON')
  }
}
