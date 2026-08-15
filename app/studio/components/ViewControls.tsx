'use client'

import { useStudioStore, type ViewMode } from '@/store/useStudioStore'

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: 'perspective', label: '3D' },
  { mode: 'capture', label: 'Photo' },
  { mode: 'top', label: 'Haut' },
  { mode: 'front', label: 'Face' },
  { mode: 'back', label: 'Arrière' },
  { mode: 'left', label: 'Gauche' },
  { mode: 'right', label: 'Droite' },
]

export default function ViewControls() {
  const { viewMode, setViewMode } = useStudioStore()

  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-surface)]/95 p-1 shadow-md backdrop-blur">
        {VIEWS.map(v => (
          <button
            key={v.mode}
            type="button"
            onClick={() => setViewMode(v.mode)}
            title={v.mode === 'capture' ? 'Vue photo (niveau des yeux)' : v.label}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all sm:px-3 ${
              viewMode === v.mode
                ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                : 'text-[var(--rm-muted)] hover:bg-[var(--rm-secondary)] hover:text-[var(--rm-text)]'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="hidden rounded-full bg-black/45 px-3 py-1 text-[10px] text-white/85 sm:block">
        Glisser = orbit · Clic droit = pan · Molette = zoom · Mobile : 1 doigt = meuble · 2 doigts = orbit/zoom
      </p>
    </div>
  )
}
