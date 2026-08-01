'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Text, Group, Line, Arc } from 'react-konva'
import ArchitectureToolbar, { type SelectedElement } from '@/components/ArchitectureToolbar'
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
import type {
  DoorHinge,
  DoorOpening,
  DoorSwing,
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
  plan: FloorPlanData
  onPlanUpdate: (plan: FloorPlanData) => void
  onAddDoor: (wallId: string, offset?: number, width?: number) => void
  onAddWindow: (wallId: string, offset?: number, width?: number) => void
  onDeleteElement: (type: 'door' | 'window', id: string) => void
  onUpdateWall: (
    wallId: string,
    updates: { thickness?: number; length?: number; kind?: WallSegment['kind'] },
  ) => void
  onUpdateDoor: (
    doorId: string,
    updates: { offset?: number; width?: number; hinge?: DoorHinge; swing?: DoorSwing },
  ) => void
  onUpdateWindow: (
    windowId: string,
    updates: { offset?: number; width?: number; sillHeight?: number },
  ) => void
  onRemoveFurniture: (placementId: string) => void
  fillHeight?: boolean
}

type CanvasSelection =
  | SelectedElement
  | { type: 'furniture'; id: string }

const CANVAS_H = 560

function wallStrokeWidth(wall: WallSegment, scale: number): number {
  const base = Math.max(wall.thickness * scale, 4)
  return wall.kind === 'exterior' ? base + 1 : base
}

function DoorSymbol({
  door,
  wall,
  transform,
  isSelected,
  onSelect,
}: {
  door: DoorOpening
  wall: WallSegment
  transform: ReturnType<typeof createPlanTransform>
  isSelected: boolean
  onSelect: () => void
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
      <Group onClick={onSelect} onTap={onSelect}>
        <Line
          points={[a.x, a.y, b.x, b.y]}
          stroke={isSelected ? '#C9A84C' : PLAN_COLORS.door}
          strokeWidth={isSelected ? 3 : 1.5}
          hitStrokeWidth={16}
        />
        <Line
          points={[c.x, c.y, d.x, d.y]}
          stroke={isSelected ? '#C9A84C' : PLAN_COLORS.door}
          strokeWidth={isSelected ? 3 : 1.5}
          hitStrokeWidth={16}
        />
      </Group>
    )
  }

  const { hinge, leafEnd } = doorLeafPoints(door, wall)
  const hingeCanvas = planToCanvas(hinge, transform)
  const leafCanvas = planToCanvas(leafEnd, transform)
  const radius = Math.hypot(leafCanvas.x - hingeCanvas.x, leafCanvas.y - hingeCanvas.y)
  const rotation = (Math.atan2(leafCanvas.y - hingeCanvas.y, leafCanvas.x - hingeCanvas.x) * 180) / Math.PI
  const swingSign = door.swing === 'out' ? -1 : 1

  return (
    <Group onClick={onSelect} onTap={onSelect}>
      <Line
        points={[hingeCanvas.x, hingeCanvas.y, leafCanvas.x, leafCanvas.y]}
        stroke={isSelected ? '#C9A84C' : PLAN_COLORS.door}
        strokeWidth={isSelected ? 3 : 2}
        hitStrokeWidth={16}
      />
      <Arc
        x={hingeCanvas.x}
        y={hingeCanvas.y}
        innerRadius={0}
        outerRadius={radius}
        angle={90 * swingSign}
        rotation={rotation - (swingSign > 0 ? 0 : 90)}
        stroke={isSelected ? '#C9A84C' : PLAN_COLORS.doorArc}
        strokeWidth={isSelected ? 2 : 1}
        hitStrokeWidth={16}
      />
    </Group>
  )
}

function WindowSymbol({
  window,
  wall,
  transform,
  isSelected,
  onSelect,
}: {
  window: WindowOpening
  wall: WallSegment
  transform: ReturnType<typeof createPlanTransform>
  isSelected: boolean
  onSelect: () => void
}) {
  const { start, end } = windowMarkPoints(window, wall)
  const normal = wallNormal(wall)
  const inset = 0.06
  const marks = [start, end]

  const mid = planToCanvas(
    { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 },
    transform,
  )

  return (
    <Group onClick={onSelect} onTap={onSelect}>
      <Line
        points={[
          planToCanvas(start, transform).x,
          planToCanvas(start, transform).y,
          planToCanvas(end, transform).x,
          planToCanvas(end, transform).y,
        ]}
        stroke={isSelected ? '#C9A84C' : PLAN_COLORS.window}
        strokeWidth={isSelected ? 5 : 3}
        lineCap="round"
        hitStrokeWidth={16}
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
        x={mid.x - 12}
        y={mid.y - 18}
        text="W"
        fontSize={9}
        fill={isSelected ? '#C9A84C' : PLAN_COLORS.window}
        listening={false}
      />
    </Group>
  )
}

export default function FloorPlanCanvas({
  plan,
  onPlanUpdate,
  onAddDoor,
  onAddWindow,
  onDeleteElement,
  onUpdateWall,
  onUpdateDoor,
  onUpdateWindow,
  onRemoveFurniture,
  fillHeight = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(720)
  const [containerHeight, setContainerHeight] = useState(560)
  const [selectedElement, setSelectedElement] = useState<CanvasSelection | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedElement?.type !== 'furniture') return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      e.preventDefault()
      onRemoveFurniture(selectedElement.id)
      setSelectedElement(null)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedElement, onRemoveFurniture])

  const architectureSelection =
    selectedElement && selectedElement.type !== 'furniture' ? selectedElement : null

  const selectedFurniture =
    selectedElement?.type === 'furniture'
      ? plan.furniture.find(item => item.id === selectedElement.id)
      : undefined

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setContainerWidth(width)
      if (fillHeight && height > 0) setContainerHeight(height)
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [fillHeight])

  const canvasHeight = fillHeight ? containerHeight : CANVAS_H

  const transform = useMemo(
    () => createPlanTransform(plan, containerWidth, canvasHeight),
    [plan, containerWidth, canvasHeight],
  )

  const bounds = useMemo(() => getPlanBounds(plan), [plan])

  const activeFurniture = useMemo(
    () => plan.furniture.filter(item => item.status === 'active'),
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
    onPlanUpdate(nextPlan)
  }

  const wallById = new Map(plan.walls.map(wall => [wall.id, wall]))

  return (
    <div className={fillHeight ? 'h-full flex flex-col' : 'space-y-4'}>
      <div
        ref={containerRef}
        className={`relative overflow-hidden ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={{ backgroundColor: PLAN_COLORS.canvasBg }}
      >
        <ArchitectureToolbar
          plan={plan}
          selected={architectureSelection}
          onClearSelection={() => setSelectedElement(null)}
          onAddDoor={onAddDoor}
          onAddWindow={onAddWindow}
          onDeleteElement={onDeleteElement}
          onUpdateWall={onUpdateWall}
          onUpdateDoor={onUpdateDoor}
          onUpdateWindow={onUpdateWindow}
        />

        {selectedFurniture && (
          <div className="absolute top-2 left-2 right-2 z-10 bg-white p-3 sm:p-4 rounded-xl shadow-md border border-zinc-200 max-h-[45vh] overflow-y-auto space-y-3 sm:top-4 sm:right-4 sm:left-auto sm:w-56 sm:max-h-none">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Furniture</h3>
              <button
                type="button"
                onClick={() => setSelectedElement(null)}
                className="text-xs text-zinc-400 hover:text-zinc-600"
              >
                Close
              </button>
            </div>
            <p className="text-sm font-medium text-zinc-900">{selectedFurniture.name}</p>
            <p className="text-xs text-zinc-500">{selectedFurniture.category}</p>
            {selectedFurniture.price !== undefined && (
              <p className="text-xs font-semibold text-amber-600">
                {selectedFurniture.price.toLocaleString()} DZD
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                onRemoveFurniture(selectedFurniture.id)
                setSelectedElement(null)
              }}
              className="w-full px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-md text-xs font-bold hover:bg-red-100"
            >
              Remove from room
            </button>
            <p className="text-[10px] text-zinc-400">Or press Delete / Backspace</p>
          </div>
        )}

        <Stage
          width={containerWidth}
          height={canvasHeight}
          onMouseDown={e => {
            if (e.target === e.target.getStage()) setSelectedElement(null)
          }}
          onTouchStart={e => {
            if (e.target === e.target.getStage()) setSelectedElement(null)
          }}
        >
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

            {plan.walls.map(wall => {
              const start = planToCanvas(wall.start, transform)
              const end = planToCanvas(wall.end, transform)

              return (
                <Line
                  key={`hit-${wall.id}`}
                  points={[start.x, start.y, end.x, end.y]}
                  stroke="transparent"
                  strokeWidth={wallStrokeWidth(wall, transform.scale)}
                  hitStrokeWidth={24}
                  onClick={() => setSelectedElement({ type: 'wall', id: wall.id })}
                  onTap={() => setSelectedElement({ type: 'wall', id: wall.id })}
                />
              )
            })}

            {plan.walls.flatMap(wall => {
              const segments = splitWallSegments(wall, plan.doors, plan.windows)
              const isSelected =
                selectedElement?.type === 'wall' && selectedElement.id === wall.id
              const color = isSelected
                ? '#C9A84C'
                : wall.kind === 'exterior'
                  ? PLAN_COLORS.wallExterior
                  : PLAN_COLORS.wallInterior
              const stroke = wallStrokeWidth(wall, transform.scale)

              return segments.map((segment, index) => {
                const start = planToCanvas(segment.start, transform)
                const end = planToCanvas(segment.end, transform)
                return (
                  <Line
                    key={`${wall.id}-${index}`}
                    points={[start.x, start.y, end.x, end.y]}
                    stroke={color}
                    strokeWidth={isSelected ? stroke + 1 : stroke}
                    lineCap="square"
                    listening={false}
                  />
                )
              })
            })}

            {plan.doors.map(door => {
              const wall = wallById.get(door.wallId)
              if (!wall) return null
              return (
                <DoorSymbol
                  key={door.id}
                  door={door}
                  wall={wall}
                  transform={transform}
                  isSelected={
                    selectedElement?.type === 'door' && selectedElement.id === door.id
                  }
                  onSelect={() => setSelectedElement({ type: 'door', id: door.id })}
                />
              )
            })}

            {plan.windows.map(window => {
              const wall = wallById.get(window.wallId)
              if (!wall) return null
              return (
                <WindowSymbol
                  key={window.id}
                  window={window}
                  wall={wall}
                  transform={transform}
                  isSelected={
                    selectedElement?.type === 'window' && selectedElement.id === window.id
                  }
                  onSelect={() => setSelectedElement({ type: 'window', id: window.id })}
                />
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
                isSelected={selectedElement?.type === 'furniture' && selectedElement.id === item.id}
                onSelect={() => setSelectedElement({ type: 'furniture', id: item.id })}
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

      {!fillHeight && (
        <>
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
        {plan.metadata?.needsWallDimensions && (
          <span className="text-amber-600 font-medium">Enter wall lengths (m)</span>
        )}
        {plan.source === 'scanner' && !plan.metadata?.needsWallDimensions && (
          <span className="text-amber-600 font-medium">Scanned plan</span>
        )}
        <span className="text-zinc-400">Click walls · doors · windows · furniture to edit</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {activeFurniture.map(item => {
          const color = COLORS[item.category] ?? '#5B9BD5'
          const isSelected =
            selectedElement?.type === 'furniture' && selectedElement.id === item.id
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedElement({ type: 'furniture', id: item.id })}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setSelectedElement({ type: 'furniture', id: item.id })
                }
              }}
              className={`flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5 shadow-sm cursor-pointer transition-colors ${
                isSelected
                  ? 'border-amber-400 ring-1 ring-amber-200'
                  : 'border-zinc-200 hover:border-zinc-300'
              }`}
            >
              <div
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-zinc-700">{item.name}</span>
              <span className="text-xs text-zinc-400">{item.category}</span>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  onRemoveFurniture(item.id)
                  if (selectedElement?.type === 'furniture' && selectedElement.id === item.id) {
                    setSelectedElement(null)
                  }
                }}
                className="ml-1 text-zinc-400 hover:text-red-600 text-sm leading-none"
                aria-label={`Remove ${item.name}`}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
        </>
      )}
    </div>
  )
}

function FurnitureShape({
  item,
  transform,
  bounds,
  isSelected,
  onSelect,
  onMove,
}: {
  item: PlacedFurniture
  transform: ReturnType<typeof createPlanTransform>
  bounds: ReturnType<typeof getPlanBounds>
  isSelected: boolean
  onSelect: () => void
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
      onClick={onSelect}
      onTap={onSelect}
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
        fill={color + (isSelected ? '55' : '33')}
        stroke={isSelected ? '#C9A84C' : color}
        strokeWidth={isSelected ? 2.5 : 1.5}
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
