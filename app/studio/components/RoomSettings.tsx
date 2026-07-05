'use client'

import { FLOOR_MATERIALS, WALL_PRESETS } from '@/lib/studio-constants'
import { useStudioStore, type FloorMaterial } from '@/store/useStudioStore'

export default function RoomSettings() {
  const { roomSettingsOpen, setRoomSettingsOpen, room, setRoom } = useStudioStore()
  if (!roomSettingsOpen) return null

  return (
    <div
      className="absolute inset-0 bg-zinc-900/20 backdrop-blur-sm z-20 flex items-center justify-center"
      onClick={() => setRoomSettingsOpen(false)}
    >
      <div
        className="bg-white border border-zinc-200 rounded-2xl p-6 w-80 space-y-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-zinc-900">Room Settings</h2>
          <button
            onClick={() => setRoomSettingsOpen(false)}
            className="text-zinc-400 hover:text-zinc-800 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Dimensions</div>
          <div className="space-y-2">
            {[
              { label: 'Width (m)', key: 'width', min: 2, max: 15 },
              { label: 'Length (m)', key: 'length', min: 2, max: 20 },
              { label: 'Height (m)', key: 'height', min: 2.2, max: 4 },
            ].map(({ label, key, min, max }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <label className="text-xs text-zinc-600 w-20 flex-shrink-0">{label}</label>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step="0.1"
                  value={room[key as keyof typeof room] as number}
                  onChange={e => setRoom({ [key]: parseFloat(e.target.value) || min })}
                  className="flex-1 bg-stone-50 border border-zinc-200 rounded-lg px-3 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-amber-400"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            Floor area: {(room.width * room.length).toFixed(1)} m²
          </p>
        </div>

        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Floor Material</div>
          <div className="grid grid-cols-5 gap-2">
            {Object.entries(FLOOR_MATERIALS).map(([key, { label, color }]) => (
              <button
                key={key}
                onClick={() => setRoom({ floorMaterial: key as FloorMaterial })}
                title={label}
                className={`aspect-square rounded-lg border-2 transition-all ${
                  room.floorMaterial === key
                    ? 'border-amber-500 scale-110'
                    : 'border-zinc-200 hover:border-zinc-400'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-1">{FLOOR_MATERIALS[room.floorMaterial]?.label}</p>
        </div>

        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Wall Color</div>
          <div className="grid grid-cols-6 gap-2">
            {WALL_PRESETS.map(color => (
              <button
                key={color}
                onClick={() => setRoom({ wallColor: color })}
                className={`aspect-square rounded-lg border-2 transition-all ${
                  room.wallColor === color
                    ? 'border-amber-500 scale-110'
                    : 'border-zinc-200 hover:border-zinc-400'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-zinc-500">Custom:</span>
            <input
              type="color"
              value={room.wallColor}
              onChange={e => setRoom({ wallColor: e.target.value })}
              className="w-8 h-6 rounded cursor-pointer bg-transparent border-0"
            />
            <span className="text-xs text-zinc-500">{room.wallColor}</span>
          </div>
        </div>

        <button
          onClick={() => setRoomSettingsOpen(false)}
          className="w-full py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
