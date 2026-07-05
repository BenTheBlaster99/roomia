'use client'

import { useStudioStore, type ViewMode } from '@/store/useStudioStore'

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: 'perspective', label: '3D' },
  { mode: 'top', label: 'Top' },
  { mode: 'front', label: 'Front' },
  { mode: 'back', label: 'Back' },
  { mode: 'left', label: 'Left' },
  { mode: 'right', label: 'Right' },
]

export default function ViewControls() {
  const { viewMode, setViewMode } = useStudioStore()

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/95 backdrop-blur border border-zinc-200 rounded-xl p-1 shadow-md">
      {VIEWS.map(v => (
        <button
          key={v.mode}
          onClick={() => setViewMode(v.mode)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            viewMode === v.mode
              ? 'bg-amber-500 text-white'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-stone-100'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
