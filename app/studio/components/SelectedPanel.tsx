'use client'

import { useStudioStore } from '@/store/useStudioStore'

const SNAP_DEG = [0, 45, 90, 135, 180, 225, 270, 315] as const

export default function SelectedPanel() {
  const {
    selectedId,
    items,
    removeItem,
    duplicateItem,
    addToCart,
    selectItem,
    rotateItemBy,
    setItemRotation,
  } = useStudioStore()

  const item = items.find(i => i.id === selectedId)
  if (!item) return null

  const deg = ((item.rotationY * 180) / Math.PI) % 360
  const degDisplay = Math.round(deg < 0 ? deg + 360 : deg)

  return (
    <div className="absolute top-4 left-4 z-20 w-56 space-y-3 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-bold text-zinc-900">{item.name}</div>
          <div className="text-xs text-zinc-500">{item.category}</div>
        </div>
        <button
          type="button"
          onClick={() => selectItem(null)}
          className="text-lg leading-none text-zinc-400 transition-colors hover:text-zinc-800"
        >
          ×
        </button>
      </div>

      <div className="text-sm font-bold text-amber-700">{item.price.toLocaleString()} DZD</div>

      {item.category !== 'Light' && (
      <div className="space-y-2 rounded-lg border border-zinc-100 bg-stone-50 px-2 py-2">
        <div className="flex items-center justify-between text-xs text-zinc-600">
          <span>Orientation</span>
          <span className="font-mono tabular-nums">{degDisplay}°</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => rotateItemBy(item.id, -Math.PI / 2)}
            className="rounded-lg bg-white py-1.5 text-xs text-zinc-700 ring-1 ring-zinc-200 hover:bg-amber-50 hover:text-amber-800"
          >
            ↺ −90°
          </button>
          <button
            type="button"
            onClick={() => rotateItemBy(item.id, Math.PI / 2)}
            className="rounded-lg bg-white py-1.5 text-xs text-zinc-700 ring-1 ring-zinc-200 hover:bg-amber-50 hover:text-amber-800"
          >
            ↻ +90°
          </button>
          <button
            type="button"
            onClick={() => rotateItemBy(item.id, -Math.PI / 12)}
            className="rounded-lg bg-white py-1.5 text-xs text-zinc-700 ring-1 ring-zinc-200 hover:bg-amber-50"
          >
            −15°
          </button>
          <button
            type="button"
            onClick={() => rotateItemBy(item.id, Math.PI / 12)}
            className="rounded-lg bg-white py-1.5 text-xs text-zinc-700 ring-1 ring-zinc-200 hover:bg-amber-50"
          >
            +15°
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {SNAP_DEG.map(d => (
            <button
              key={d}
              type="button"
              title={`Face ${d}°`}
              onClick={() => setItemRotation(item.id, (d * Math.PI) / 180)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                degDisplay === d
                  ? 'bg-amber-500 text-white'
                  : 'bg-white text-zinc-500 ring-1 ring-zinc-200 hover:text-zinc-800'
              }`}
            >
              {d}°
            </button>
          ))}
        </div>
        <p className="text-[10px] text-zinc-500">
          Or drag the gold ring on the floor to aim freely.
        </p>
      </div>
      )}

      {item.category === 'Light' && (
        <p className="text-[10px] leading-relaxed text-zinc-500">
          Pendant — drag the lamp, or the gold disc on the floor, to slide it across the ceiling.
        </p>
      )}

      <div className="space-y-0.5 text-xs text-zinc-500">
        <div>
          W: {item.dimensions.width}m · D: {item.dimensions.depth}m · H: {item.dimensions.height}m
        </div>
        {item.notes && <div className="italic">{item.notes}</div>}
      </div>

      <div className="space-y-1.5 border-t border-zinc-200 pt-1">
        <button
          type="button"
          onClick={() => {
            addToCart({
              furnitureId: item.furnitureId,
              name: item.name,
              category: item.category,
              price: item.price,
            })
          }}
          className="w-full rounded-lg bg-amber-500 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-600"
        >
          + Add to Cart
        </button>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => duplicateItem(item.id)}
            className="rounded-lg bg-stone-100 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-stone-200"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => removeItem(item.id)}
            className="rounded-lg bg-red-50 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-100"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}
