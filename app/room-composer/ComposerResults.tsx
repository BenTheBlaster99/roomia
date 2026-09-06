'use client'

import { useState } from 'react'
import type { CatalogItem } from '@/lib/mock-catalog'
import { formatDA } from '@/lib/format-da'
import ImageLightbox from '@/components/ImageLightbox'
import { LOOKS, type LookId } from './looks'

export type SlotPair = {
  id: string
  itemA: CatalogItem
  itemB: CatalogItem | null
}

export type LookResult = {
  look: LookId
  src: string
  items: CatalogItem[]
}

function storeOf(item: CatalogItem) {
  return item.storeName ?? 'Catalogue Roomia'
}

function catalogHref(item: CatalogItem) {
  return item.storeSlug ? `/catalog/${item.storeSlug}/${item.id}` : null
}

function PieceCard({
  item,
  active,
  emptyLabel,
}: {
  item: CatalogItem | null
  active?: boolean
  emptyLabel?: string
}) {
  if (!item) {
    return (
      <div className="flex min-h-[4.5rem] items-center rounded-xl border border-dashed border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 text-xs text-[var(--rm-muted)]">
        {emptyLabel ?? 'Pas encore choisi'}
      </div>
    )
  }

  const href = catalogHref(item)
  const inner = (
    <>
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(180deg,#eef3ef_0%,#e3ebe6_100%)] p-1">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--rm-ink)]">{item.name}</p>
        <p className="truncate text-[11px] font-medium text-[var(--rm-accent)]">{storeOf(item)}</p>
        <p className="truncate text-[11px] text-[var(--rm-muted)]">{formatDA(item.price)}</p>
      </div>
    </>
  )

  const cls = `flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left ${
    active
      ? 'border-[var(--rm-primary)] bg-white shadow-[0_8px_24px_-18px_rgba(20,32,28,0.55)]'
      : 'border-[var(--rm-text)]/8 bg-white/70'
  }`

  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    )
  }
  return <div className={cls}>{inner}</div>
}

export default function ComposerResults({
  results,
  selectedLook,
  slots,
  onSelectLook,
  onEdit,
  onCompare,
  onReset,
}: {
  results: LookResult[]
  selectedLook: LookId | null
  slots: SlotPair[]
  onSelectLook: (look: LookId) => void
  onEdit: () => void
  onCompare: () => void
  onReset: () => void
}) {
  const selected = results.find(r => r.look === selectedLook) ?? results[0] ?? null
  const compared = results.length === 2
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const waText = selected
    ? [
        `Ma pièce avec Roomia — ${LOOKS[selected.look].label}`,
        ...selected.items.map(item => `• ${item.name} (${storeOf(item)})`),
        'https://www.room-ia.com',
      ].join('\n')
    : ''

  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">Résultat</p>
        <h2 className="rm-display mt-2 text-3xl font-bold tracking-tight text-[var(--rm-ink)] md:text-4xl">
          {compared ? 'Même pièce, deux sélections' : 'Ta proposition'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--rm-muted)]">
          {compared
            ? 'Chaque numéro est le même endroit. Choisis la version qui te parle.'
            : 'Les pièces placées, dans ta photo. Tu peux encore comparer une autre sélection aux mêmes points.'}
        </p>
      </header>

      <div className={`grid gap-5 ${compared ? 'lg:grid-cols-2' : ''}`}>
        {results.map(result => {
          const active = selected?.look === result.look
          return (
            <article
              key={result.look}
              className={`overflow-hidden rounded-[1.4rem] border bg-white transition ${
                active
                  ? 'border-[var(--rm-primary)] shadow-[0_22px_50px_-28px_rgba(31,77,61,0.55)]'
                  : 'border-[var(--rm-text)]/8 opacity-90 hover:opacity-100'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectLook(result.look)}
                className="relative block w-full text-left"
              >
                <img src={result.src} alt={LOOKS[result.look].label} className="w-full" />
                <span
                  className="absolute left-3 top-3 flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow"
                  style={{ background: LOOKS[result.look].pin }}
                >
                  {LOOKS[result.look].label}
                </span>
                {active ? (
                  <span className="absolute right-3 top-3 rounded-full bg-[var(--rm-primary)] px-2.5 py-1 text-[11px] font-bold text-white">
                    Choisie
                  </span>
                ) : null}
              </button>
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-semibold text-[var(--rm-ink)]">
                  {active ? 'Version retenue' : 'Appuie pour retenir celle-ci'}
                </p>
                <button
                  type="button"
                  onClick={() => setLightboxSrc(result.src)}
                  className="text-xs font-semibold text-[var(--rm-primary)]"
                >
                  Agrandir
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <section className="rounded-[1.4rem] border border-[var(--rm-text)]/8 bg-white p-4 md:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-muted)]">
          {compared ? 'Emplacement par emplacement' : 'Les pièces de cette version'}
        </p>
        <ul className="mt-4 space-y-4">
          {slots.map((slot, i) => (
            <li key={slot.id}>
              <p className="mb-2 text-xs font-semibold text-[var(--rm-ink)]">
                Point {i + 1}
                {slot.itemA.category ? ` · ${slot.itemA.category}` : ''}
              </p>
              {compared ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <PieceCard item={slot.itemA} active={selected?.look === 'a'} />
                  <span className="hidden text-center text-[10px] font-bold uppercase tracking-wider text-[var(--rm-muted)] sm:block">
                    ou
                  </span>
                  <PieceCard item={slot.itemB} active={selected?.look === 'b'} emptyLabel="Pas de remplaçant" />
                </div>
              ) : (
                <PieceCard item={slot.itemA} active />
              )}
            </li>
          ))}
        </ul>
      </section>

      {selected ? (
        <div className="sticky bottom-4 z-30">
          <div className="rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-bg)]/95 p-3 shadow-[0_18px_40px_-24px_rgba(20,32,28,0.65)] backdrop-blur">
            <a
              href={selected.src}
              download={`roomia-${LOOKS[selected.look].short}.jpg`}
              className="rm-btn-primary w-full py-3.5 text-sm"
            >
              Télécharger {LOOKS[selected.look].label}
            </a>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold">
              <button type="button" onClick={onEdit} className="text-[var(--rm-primary)]">
                Modifier les pièces
              </button>
              {!compared ? (
                <button type="button" onClick={onCompare} className="text-[var(--rm-primary)]">
                  Comparer une autre sélection
                </button>
              ) : null}
              <a
                href={`https://wa.me/?text=${encodeURIComponent(waText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--rm-ink)]"
              >
                Envoyer sur WhatsApp
              </a>
              <button type="button" onClick={onReset} className="text-[var(--rm-muted)]">
                Autre photo
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ImageLightbox src={lightboxSrc} alt="Look Roomia" onClose={() => setLightboxSrc(null)} />
    </div>
  )
}
