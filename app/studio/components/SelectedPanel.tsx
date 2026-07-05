'use client'

import { useStudioStore } from '@/store/useStudioStore'

export default function SelectedPanel() {
  const { selectedId, items, removeItem, duplicateItem, addToCart, selectItem } = useStudioStore()

  const item = items.find(i => i.id === selectedId)
  if (!item) return null

  return (
    <div className="absolute top-4 left-4 w-56 bg-white/95 backdrop-blur border border-zinc-200 rounded-2xl p-4 space-y-3 shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold text-sm text-zinc-900">{item.name}</div>
          <div className="text-xs text-zinc-500">{item.category}</div>
        </div>
        <button
          onClick={() => selectItem(null)}
          className="text-zinc-400 hover:text-zinc-800 transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="text-sm font-bold text-amber-700">{item.price.toLocaleString()} DZD</div>

      <p className="text-xs text-zinc-500 bg-stone-50 rounded-lg px-2 py-1.5 border border-zinc-100">
        Drag the gold ring on the floor to rotate. Delete key to remove.
      </p>

      <div className="text-xs text-zinc-500 space-y-0.5">
        <div>
          W: {item.dimensions.width}m · D: {item.dimensions.depth}m · H: {item.dimensions.height}m
        </div>
        {item.notes && <div className="italic">{item.notes}</div>}
      </div>

      <div className="space-y-1.5 pt-1 border-t border-zinc-200">
        <button
          onClick={() => {
            addToCart({
              furnitureId: item.furnitureId,
              name: item.name,
              category: item.category,
              price: item.price,
            })
          }}
          className="w-full py-2 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition-colors"
        >
          + Add to Cart
        </button>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => duplicateItem(item.id)}
            className="py-1.5 bg-stone-100 hover:bg-stone-200 rounded-lg text-xs text-zinc-700 transition-colors"
          >
            Copy
          </button>
          <button
            onClick={() => removeItem(item.id)}
            className="py-1.5 bg-red-50 hover:bg-red-100 rounded-lg text-xs text-red-600 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}
