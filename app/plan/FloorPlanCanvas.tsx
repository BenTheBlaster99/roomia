'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arc } from 'react-konva'
import { resolvePlanForView } from '@/lib/floor-plan'
import { loadFloorPlan, saveFloorPlan } from '@/lib/floor-plan-storage'
import {
  PLAN_COLORS,
  canvasToPlan,
  createPlanTransform,
  doorLeafPoints,
  getPlanBounds,
  planToCanvas,
  pointOnWall,
  roomPolygonPoints,
  splitWallSegments,
  wallNormal,
  windowMarkPoints,
} from '@/lib/plan-view'
import type { FurnitureItem } from '@/types'
import type {
  DoorOpening,
  FloorPlanData,
  PlacedFurniture,
  WallSegment,
  WindowOpening,
} from '@/types/floor-plan'

const COLORS: Record<string, string> = {
  Sofa: '#4F84A6',
  Bed: '#7C5C8A',
  Chair: '#4CAF7D',
  'Coffee Table': '#C9A84C',
  'Dining Table': '#C9A84C',
  Light: '#E8C97A',
}

interface Props {
  furniture: FurnitureItem[]
  room: string
  styleId: string
  budgetTier: string
  width: number
  length: number
  height: number
}

const CANVAS_H = 560

function wallStrokeWidth(wall: WallSegment, scale: number): number {
  const base = Math.max(wall.thickness * scale, 4)
  return wall.kind === 'exterior' ? base + 1 : base
}

function DoorSymbol({
  door,
  wall,
  transform,
}: {
  door: DoorOpening
  wall: WallSegment
  transform: ReturnType<typeof createPlanTransform>
}) {
  if (door.swing === 'sliding') {
    const normal = wallNormal(wall)
    const offset = 0.08
    const a = planToCanvas(
      {
        x: pointOnWall(wall, door.offset - door.width / 2).x + normal.x * offset,
        z: pointOnWall(wall, door.offset - door.width / 2).z + normal.z * offset,
      },
      transform,
    )
    const b = planToCanvas(
      {
        x: pointOnWall(wall, door.offset + door.width / 2).x + normal.x * offset,
        z: pointOnWall(wall, door.offset + door.width / 2).z + normal.z * offset,
      },
      transform,
    )
    const c = planToCanvas(
      {
        x: pointOnWall(wall, door.offset - door.width / 2).x - normal.x * offset,
        z: pointOnWall(wall, door.offset - door.width / 2).z - normal.z * offset,
      },
      transform,
    )
    const d = planToCanvas(
      {
        x: pointOnWall(wall, door.offset + door.width / 2).x - normal.x * offset,
        z: pointOnWall(wall, door.offset + door.width / 2).z - normal.z * offset,
      },
      transform,
    )
    return (
      <>
        <Line points={[a.x, a.y, b.x, b.y]} stroke={PLAN_COLORS.door} strokeWidth={1.5} />
        <Line points={[c.x, c.y, d.x, d.y]} stroke={PLAN_COLORS.door} strokeWidth={1.5} />
      </>
    )
  }

  const { hinge, leafEnd } = doorLeafPoints(door, wall)
  const hingeCanvas = planToCanvas(hinge, transform)
  const leafCanvas = planToCanvas(leafEnd, transform)
  const radius = Math.hypot(leafCanvas.x - hingeCanvas.x, leafCanvas.y - hingeCanvas.y)
  const rotation = (Math.atan2(leafCanvas.y - hingeCanvas.y, leafCanvas.x - hingeCanvas.x) * 180) / Math.PI
  const swingSign = door.swing === 'out' ? -1 : 1

  return (
    <>
      <Line
        points={[hingeCanvas.x, hingeCanvas.y, leafCanvas.x, leafCanvas.y]}
        stroke={PLAN_COLORS.door}
        strokeWidth={2}
      />
      <Arc
        x={hingeCanvas.x}
        y={hingeCanvas.y}
        innerRadius={0}
        outerRadius={radius}
        angle={90 * swingSign}
        rotation={rotation - (swingSign > 0 ? 0 : 90)}
        stroke={PLAN_COLORS.doorArc}
        strokeWidth={1}
      />
    </>
  )
}

function WindowSymbol({
  window,
  wall,
  transform,
}: {
  window: WindowOpening
  wall: WallSegment
  transform: ReturnType<typeof createPlanTransform>
}) {
  const { start, end } = windowMarkPoints(window, wall)
  const normal = wallNormal(wall)
  const inset = 0.06
  const marks = [start, end]

  return (
    <>
      <Line
        points={[
          planToCanvas(start, transform).x,
          planToCanvas(start, transform).y,
          planToCanvas(end, transform).x,
          planToCanvas(end, transform).y,
        ]}
        stroke={PLAN_COLORS.window}
        strokeWidth={3}
        lineCap="round"
      />
      {marks.map((point, index) => {
        const inner = planToCanvas(
          { x: point.x + normal.x * inset, z: point.z + normal.z * inset },
          transform,
        )
        const outer = planToCanvas(
          { x: point.x - normal.x * inset, z: point.z - normal.z * inset },
          transform,
        )
        return (
          <Line
            key={`${window.id}-tick-${index}`}
            points={[inner.x, inner.y, outer.x, outer.y]}
            stroke={PLAN_COLORS.windowGlass}
            strokeWidth={2}
            listening={false}
          />
        )
      })}
      <Text
        x={planToCanvas(
          {
            x: (start.x + end.x) / 2,
            z: (start.z + end.z) / 2,
          },
          transform,
        ).x - 12}
        y={
          planToCanvas(
            {
              x: (start.x + end.x) / 2,
              z: (start.z + end.z) / 2,
            },
            transform,
          ).y - 18
        }
        text="W"
        fontSize={9}
        fill={PLAN_COLORS.window}
        listening={false}
      />
    </>
  )
}

export default function FloorPlanCanvas({
  furniture,
  room,
  styleId,
  budgetTier,
  width,
  length,
  height,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(720)
  const [plan, setPlan] = useState<FloorPlanData>(() =>
    resolvePlanForView({
      stored: loadFloorPlan(),
      room,
      styleId,
      budgetTier,
      width,
      length,
      height,
      furniture,
    }),
  )

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width)
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const transform = useMemo(
    () => createPlanTransform(plan, containerWidth, CANVAS_H),
    [plan, containerWidth],
  )

  const bounds = useMemo(() => getPlanBounds(plan), [plan])

  const activeFurniture = useMemo(
    () => plan?.furniture.filter(item => item.status === 'active') ?? [],
    [plan],
  )

  function moveFurniture(id: string, canvasX: number, canvasY: number) {
    if (!transform) return

    const position = canvasToPlan(canvasX, canvasY, transform)
    const nextPlan: FloorPlanData = {
      ...plan,
      furniture: plan.furniture.map(item =>
        item.id === id ? { ...item, position } : item,
      ),
      metadata: { ...plan.metadata, updatedAt: new Date().toISOString() },
    }
    setPlan(nextPlan)
    saveFloorPlan(nextPlan)
  }

  const wallById = new Map(plan.walls.map(wall => [wall.id, wall]))

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="rounded-2xl border border-zinc-200 overflow-hidden shadow-sm"
        style={{ backgroundColor: PLAN_COLORS.canvasBg }}
      >
        <Stage width={containerWidth} height={CANVAS_H}>
          <Layer>
            {plan.rooms.map(zone => (
              <Line
                key={zone.id}
                points={roomPolygonPoints(zone.points, transform)}
                closed
                fill={PLAN_COLORS.floor}
                stroke={PLAN_COLORS.grid}
                strokeWidth={1}
              />
            ))}

            {Array.from({ length: Math.ceil(bounds.width) + 1 }).map((_, i) => {
              const x = bounds.minX + i
              const start = planToCanvas({ x, z: bounds.minZ }, transform)
              const end = planToCanvas({ x, z: bounds.maxZ }, transform)
              return (
                <Line
                  key={`grid-v-${i}`}
                  points={[start.x, start.y, end.x, end.y]}
                  stroke={PLAN_COLORS.grid}
                  strokeWidth={1}
                />
              )
            })}
            {Array.from({ length: Math.ceil(bounds.length) + 1 }).map((_, i) => {
              const z = bounds.minZ + i
              const start = planToCanvas({ x: bounds.minX, z }, transform)
              const end = planToCanvas({ x: bounds.maxX, z }, transform)
              return (
                <Line
                  key={`grid-h-${i}`}
                  points={[start.x, start.y, end.x, end.y]}
                  stroke={PLAN_COLORS.grid}
                  strokeWidth={1}
                />
              )
            })}

            {plan.walls.flatMap(wall => {
              const segments = splitWallSegments(wall, plan.doors, plan.windows)
              const color =
                wall.kind === 'exterior' ? PLAN_COLORS.wallExterior : PLAN_COLORS.wallInterior
              const stroke = wallStrokeWidth(wall, transform.scale)

              return segments.map((segment, index) => {
                const start = planToCanvas(segment.start, transform)
                const end = planToCanvas(segment.end, transform)
                return (
                  <Line
                    key={`${wall.id}-${index}`}
                    points={[start.x, start.y, end.x, end.y]}
                    stroke={color}
                    strokeWidth={stroke}
                    lineCap="square"
                  />
                )
              })
            })}

            {plan.doors.map(door => {
              const wall = wallById.get(door.wallId)
              if (!wall) return null
              return <DoorSymbol key={door.id} door={door} wall={wall} transform={transform} />
            })}

            {plan.windows.map(window => {
              const wall = wallById.get(window.wallId)
              if (!wall) return null
              return (
                <WindowSymbol key={window.id} window={window} wall={wall} transform={transform} />
              )
            })}

            {plan.rooms.map(zone => {
              const labelPoint =
                zone.labelPosition ??
                (zone.points.length > 0
                  ? {
                      x: zone.points.reduce((sum, p) => sum + p.x, 0) / zone.points.length,
                      z: zone.points.reduce((sum, p) => sum + p.z, 0) / zone.points.length,
                    }
                  : { x: bounds.minX + bounds.width / 2, z: bounds.minZ + bounds.length / 2 })

              const canvas = planToCanvas(labelPoint, transform)
              return (
                <Text
                  key={`${zone.id}-label`}
                  x={canvas.x - 40}
                  y={canvas.y - 8}
                  width={80}
                  align="center"
                  text={zone.name}
                  fontSize={12}
                  fontStyle="bold"
                  fill={PLAN_COLORS.roomLabel}
                  listening={false}
                />
              )
            })}

            {activeFurniture.map(item => (
              <FurnitureShape
                key={item.id}
                item={item}
                transform={transform}
                bounds={bounds}
                onMove={moveFurniture}
              />
            ))}

            <Text
              x={planToCanvas({ x: bounds.minX + bounds.width / 2, z: bounds.minZ }, transform).x - 20}
              y={planToCanvas({ x: bounds.minX, z: bounds.minZ }, transform).y - 22}
              text={`${plan.dimensions.width.toFixed(1)}m`}
              fontSize={11}
              fill={PLAN_COLORS.dimension}
              listening={false}
            />
            <Text
              x={planToCanvas({ x: bounds.minX, z: bounds.minZ }, transform).x - 34}
              y={planToCanvas({ x: bounds.minX, z: bounds.minZ + bounds.length / 2 }, transform).y}
              text={`${plan.dimensions.length.toFixed(1)}m`}
              fontSize={11}
              fill={PLAN_COLORS.dimension}
              rotation={-90}
              listening={false}
            />
          </Layer>
        </Stage>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-sm bg-[#2F2F2F]" /> Walls
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-[#444444]" /> Doors
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-[#5B8FD9]" /> Windows
        </span>
        {plan.source === 'scanner' && (
          <span className="text-amber-600 font-medium">Scanned plan</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {activeFurniture.map(item => {
          const color = COLORS[item.category] ?? '#5B9BD5'
          return (
            <div
              key={item.id}
              className="flex items-center gap-2 bg-white border border-zinc-200
                         rounded-lg px-3 py-1.5 shadow-sm"
            >
              <div
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-zinc-700">{item.name}</span>
              <span className="text-xs text-zinc-400">{item.category}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FurnitureShape({
  item,
  transform,
  bounds,
  onMove,
}: {
  item: PlacedFurniture
  transform: ReturnType<typeof createPlanTransform>
  bounds: ReturnType<typeof getPlanBounds>
  onMove: (id: string, canvasX: number, canvasY: number) => void
}) {
  const color = COLORS[item.category] ?? '#5B9BD5'
  const fw = item.dimensions.width * transform.scale
  const fd = item.dimensions.depth * transform.scale
  const center = planToCanvas(item.position, transform)
  const x = center.x - fw / 2
  const y = center.y - fd / 2

  const minCanvas = planToCanvas({ x: bounds.minX, z: bounds.minZ }, transform)
  const maxCanvas = planToCanvas({ x: bounds.maxX, z: bounds.maxZ }, transform)

  return (
    <Group
      x={x}
      y={y}
      draggable
      rotation={item.rotationDeg}
      onDragEnd={e => {
        const node = e.target
        onMove(item.id, node.x() + fw / 2, node.y() + fd / 2)
      }}
      dragBoundFunc={pos => ({
        x: Math.max(minCanvas.x, Math.min(pos.x, maxCanvas.x - fw)),
        y: Math.max(minCanvas.y, Math.min(pos.y, maxCanvas.y - fd)),
      })}
    >
      <Rect
        width={fw}
        height={fd}
        fill={color + '33'}
        stroke={color}
        strokeWidth={1.5}
        cornerRadius={3}
      />
      <Text
        text={item.name}
        fontSize={Math.max(8, Math.min(11, fw / 9))}
        fill="#1f2937"
        width={fw}
        height={fd}
        align="center"
        verticalAlign="middle"
        padding={3}
        listening={false}
      />
    </Group>
  )
}
