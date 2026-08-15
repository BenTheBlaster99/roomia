'use client'

import { useStudioStore } from '@/store/useStudioStore'

/** Shown when the room has no furniture yet (gate already closed). */
export default function StudioEmptyState() {
  const items = useStudioStore(s => s.items)
  const catalogOpen = useStudioStore(s => s.catalogOpen)
  const setCatalogOpen = useStudioStore(s => s.setCatalogOpen)
  const entryGateOpen = useStudioStore(s => s.entryGateOpen)

  if (entryGateOpen || items.length > 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="pointer-events-auto max-w-sm rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)]/95 px-5 py-4 text-center shadow-lg backdrop-blur">
        <p className="text-sm font-semibold text-[var(--rm-text)]">Pièce vide</p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--rm-muted)]">
          Ouvrez le catalogue pour placer un meuble. Sur mobile : un doigt déplace le meuble
          sélectionné ; deux doigts pour orbit / zoom.
        </p>
        {!catalogOpen && (
          <button
            type="button"
            onClick={() => setCatalogOpen(true)}
            className="rm-btn-primary mt-3 w-full px-4 py-2 text-xs"
          >
            Ouvrir le catalogue
          </button>
        )}
      </div>
    </div>
  )
}
