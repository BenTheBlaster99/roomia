import type { CatalogStore } from './catalog-data'
import { mapsHref, storePlaceLine, whatsappHref } from './catalog-data'

export default function StoreHeader({
  store,
  compact = false,
  pieceCount,
}: {
  store: CatalogStore
  compact?: boolean
  pieceCount?: number
}) {
  const place = storePlaceLine(store)
  const wa = whatsappHref(store.whatsapp)
  const maps = mapsHref(store.maps_url, [store.quartier, store.city, store.name].filter(Boolean).join(', '))
  const initial = store.name.trim().charAt(0).toUpperCase() || 'M'

  return (
    <div className={`flex gap-4 ${compact ? 'items-center' : 'items-start'}`}>
      <div
        className={`shrink-0 overflow-hidden rounded-2xl border border-[var(--rm-text)]/8 bg-white ${
          compact ? 'h-14 w-14' : 'h-20 w-20'
        }`}
      >
        {store.logo_url ? (
          <img src={store.logo_url} alt="" className="h-full w-full object-contain p-1.5" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--rm-primary)] font-[family-name:var(--font-display)] text-xl font-bold text-white">
            {initial}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h2
          className={`rm-display font-bold tracking-tight text-[var(--rm-ink)] ${
            compact ? 'text-xl' : 'text-3xl md:text-4xl'
          }`}
        >
          {store.name}
        </h2>
        <p className="mt-0.5 text-sm text-[var(--rm-muted)]">
          {[place, pieceCount != null ? `${pieceCount} pièce${pieceCount === 1 ? '' : 's'}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {(wa || maps) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-[#25D366]/15 px-3 py-1 text-xs font-semibold text-[#128C7E]"
              >
                WhatsApp
              </a>
            ) : null}
            {maps ? (
              <a
                href={maps}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-[var(--rm-secondary)] px-3 py-1 text-xs font-semibold text-[var(--rm-primary)]"
              >
                Itinéraire
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
