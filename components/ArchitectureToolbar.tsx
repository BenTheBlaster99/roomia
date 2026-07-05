'use client'

import { useState } from 'react'
import { getWallById, getWallLength } from '@/lib/plan-edit'
import type { DoorHinge, DoorOpening, DoorSwing, FloorPlanData, WallSegment } from '@/types/floor-plan'

export type SelectedElement =
  | { type: 'wall'; id: string }
  | { type: 'door'; id: string }
  | { type: 'window'; id: string }

interface Props {
  plan: FloorPlanData
  selected: SelectedElement | null
  onClearSelection: () => void
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
}

const TOOLBAR_CLASS =
  'absolute top-2 left-2 right-2 z-10 bg-white p-3 sm:p-4 rounded-xl shadow-md border border-zinc-200 max-h-[45vh] overflow-y-auto space-y-3 sm:top-4 sm:left-4 sm:right-auto sm:w-56 sm:max-h-none'

function Field({
  label,
  value,
  onChange,
  step = 0.01,
  min = 0,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  step?: number
  min?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-zinc-50 border border-zinc-200 rounded-md px-2 py-1.5 text-sm text-zinc-900"
      />
    </label>
  )
}

function WallToolbar({
  wall,
  onClearSelection,
  onAddDoor,
  onAddWindow,
  onUpdateWall,
}: {
  wall: WallSegment
  onClearSelection: () => void
  onAddDoor: (wallId: string, offset?: number, width?: number) => void
  onAddWindow: (wallId: string, offset?: number, width?: number) => void
  onUpdateWall: Props['onUpdateWall']
}) {
  const [thickness, setThickness] = useState(String(wall.thickness))
  const [length, setLength] = useState(getWallLength(wall).toFixed(2))

  return (
    <div className={TOOLBAR_CLASS}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">Wall</h3>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-xs text-zinc-400 hover:text-zinc-600"
        >
          Close
        </button>
      </div>

      <Field
        label="Thickness (m)"
        value={thickness}
        onChange={setThickness}
        step={0.01}
        min={0.05}
      />
      <Field label="Length (m)" value={length} onChange={setLength} step={0.1} min={0.5} />

      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Type
        <select
          value={wall.kind}
          onChange={e =>
            onUpdateWall(wall.id, { kind: e.target.value as 'exterior' | 'interior' })
          }
          className="bg-zinc-50 border border-zinc-200 rounded-md px-2 py-1.5 text-sm text-zinc-900"
        >
          <option value="exterior">Exterior</option>
          <option value="interior">Interior</option>
        </select>
      </label>

      <button
        type="button"
        onClick={() => {
          const t = parseFloat(thickness)
          const l = parseFloat(length)
          onUpdateWall(wall.id, {
            ...(Number.isFinite(t) && t > 0 ? { thickness: t } : {}),
            ...(Number.isFinite(l) && l > 0 ? { length: l } : {}),
          })
        }}
        className="w-full px-3 py-2 bg-amber-500 text-white rounded-md text-xs font-bold hover:bg-amber-600"
      >
        Apply wall changes
      </button>

      <div className="flex gap-2 pt-1 border-t border-zinc-100">
        <button
          type="button"
          onClick={() => onAddDoor(wall.id)}
          className="flex-1 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 rounded-md text-xs font-medium"
        >
          + Door
        </button>
        <button
          type="button"
          onClick={() => onAddWindow(wall.id)}
          className="flex-1 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 rounded-md text-xs font-medium"
        >
          + Window
        </button>
      </div>
    </div>
  )
}

function DoorToolbar({
  doorId,
  door,
  onClearSelection,
  onDeleteElement,
  onUpdateDoor,
}: {
  doorId: string
  door: DoorOpening
  onClearSelection: () => void
  onDeleteElement: Props['onDeleteElement']
  onUpdateDoor: Props['onUpdateDoor']
}) {
  const [offset, setOffset] = useState(String(door.offset))
  const [width, setWidth] = useState(String(door.width))

  return (
    <div className={TOOLBAR_CLASS}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">Door</h3>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-xs text-zinc-400 hover:text-zinc-600"
        >
          Close
        </button>
      </div>

      <Field label="Offset along wall (m)" value={offset} onChange={setOffset} step={0.05} />
      <Field label="Width (m)" value={width} onChange={setWidth} step={0.05} min={0.6} />

      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Hinge
        <select
          value={door.hinge}
          onChange={e => onUpdateDoor(doorId, { hinge: e.target.value as DoorHinge })}
          className="bg-zinc-50 border border-zinc-200 rounded-md px-2 py-1.5 text-sm"
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </label>

      <button
        type="button"
        onClick={() => {
          const o = parseFloat(offset)
          const w = parseFloat(width)
          onUpdateDoor(doorId, {
            ...(Number.isFinite(o) ? { offset: o } : {}),
            ...(Number.isFinite(w) && w > 0 ? { width: w } : {}),
          })
        }}
        className="w-full px-3 py-2 bg-amber-500 text-white rounded-md text-xs font-bold hover:bg-amber-600"
      >
        Apply door changes
      </button>

      <button
        type="button"
        onClick={() => {
          onDeleteElement('door', doorId)
          onClearSelection()
        }}
        className="w-full px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md text-xs font-medium"
      >
        Delete door
      </button>
    </div>
  )
}

function WindowToolbar({
  windowId,
  window,
  onClearSelection,
  onDeleteElement,
  onUpdateWindow,
}: {
  windowId: string
  window: { offset: number; width: number; sillHeight: number }
  onClearSelection: () => void
  onDeleteElement: Props['onDeleteElement']
  onUpdateWindow: Props['onUpdateWindow']
}) {
  const [offset, setOffset] = useState(String(window.offset))
  const [width, setWidth] = useState(String(window.width))
  const [sillHeight, setSillHeight] = useState(String(window.sillHeight))

  return (
    <div className={TOOLBAR_CLASS}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">Window</h3>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-xs text-zinc-400 hover:text-zinc-600"
        >
          Close
        </button>
      </div>

      <Field label="Offset along wall (m)" value={offset} onChange={setOffset} step={0.05} />
      <Field label="Width (m)" value={width} onChange={setWidth} step={0.05} min={0.4} />
      <Field label="Sill height (m)" value={sillHeight} onChange={setSillHeight} step={0.05} />

      <button
        type="button"
        onClick={() => {
          const o = parseFloat(offset)
          const w = parseFloat(width)
          const s = parseFloat(sillHeight)
          onUpdateWindow(windowId, {
            ...(Number.isFinite(o) ? { offset: o } : {}),
            ...(Number.isFinite(w) && w > 0 ? { width: w } : {}),
            ...(Number.isFinite(s) && s >= 0 ? { sillHeight: s } : {}),
          })
        }}
        className="w-full px-3 py-2 bg-amber-500 text-white rounded-md text-xs font-bold hover:bg-amber-600"
      >
        Apply window changes
      </button>

      <button
        type="button"
        onClick={() => {
          onDeleteElement('window', windowId)
          onClearSelection()
        }}
        className="w-full px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md text-xs font-medium"
      >
        Delete window
      </button>
    </div>
  )
}

export default function ArchitectureToolbar({
  plan,
  selected,
  onClearSelection,
  onAddDoor,
  onAddWindow,
  onDeleteElement,
  onUpdateWall,
  onUpdateDoor,
  onUpdateWindow,
}: Props) {
  if (!selected) return null

  if (selected.type === 'wall') {
    const wall = getWallById(plan, selected.id)
    if (!wall) return null
    return (
      <WallToolbar
        key={selected.id}
        wall={wall}
        onClearSelection={onClearSelection}
        onAddDoor={onAddDoor}
        onAddWindow={onAddWindow}
        onUpdateWall={onUpdateWall}
      />
    )
  }

  if (selected.type === 'door') {
    const door = plan.doors.find(d => d.id === selected.id)
    if (!door) return null
    return (
      <DoorToolbar
        key={selected.id}
        doorId={selected.id}
        door={door}
        onClearSelection={onClearSelection}
        onDeleteElement={onDeleteElement}
        onUpdateDoor={onUpdateDoor}
      />
    )
  }

  const window = plan.windows.find(w => w.id === selected.id)
  if (!window) return null

  return (
    <WindowToolbar
      key={selected.id}
      windowId={selected.id}
      window={window}
      onClearSelection={onClearSelection}
      onDeleteElement={onDeleteElement}
      onUpdateWindow={onUpdateWindow}
    />
  )
}
