'use client'

import { useMemo, useState } from 'react'
import type { CatalogItem } from '@/lib/mock-catalog'
import { formatDA } from '@/lib/format-da'

const TABS = ['All', 'Sofa', 'Chair', 'Bed', 'Tables', 'Rug', 'Light'] as const
type Tab = (typeof TABS)[number]

function matchesTab(item: CatalogItem, tab: Tab) {
  if (tab === 'All') return true
  if (tab === 'Tables') {
    return ['Coffee Table', 'Dining Table', 'Side Table', 'TV Unit'].includes(item.category)
  }
  return item.category === tab
}

function storeLabel(item: CatalogItem): string {
  return item.storeName ?? (item.fromDatabase ? 'Roomia' : 'Roomia')
}

export default function ComposerCatalog({
  items,
  pendingId,
  preferredStoreId,
  preferredStoreName,
  preferredStyleId,
  preferredStyleName,
  hint,
  onPick,
}: {
  items: CatalogItem[]
  pendingId: string | null
  preferredStoreId?: string | null
  preferredStoreName?: string | null
  preferredStyleId?: string | null
  preferredStyleName?: string | null
  hint?: string
  onPick: (item: CatalogItem) => void
}) {
  const visual = items.filter(i => i.imageUrl)
  const pool = visual.length > 0 ? visual : items
  const tabs = TABS.filter(tab => tab === 'All' || pool.some(i => matchesTab(i, tab)))
  const [tab, setTab] = useState<Tab>('All')
  const shown = pool.filter(i => matchesTab(i, tab))

  const groups = useMemo(() => {
    const kit: CatalogItem[] = []
    const preferred: CatalogItem[] = []
    const others = new Map<string, CatalogItem[]>()
    const loose: CatalogItem[] = []

    for (const item of shown) {
      if (preferredStyleId && item.styleIds?.includes(preferredStyleId)) {
        kit.push(item)
        continue
      }
      if (preferredStoreId && item.storeId === preferredStoreId) {
        preferred.push(item)
        continue
      }
      if (item.storeName && item.storeId) {
        const list = others.get(item.storeName) ?? []
        list.push(item)
        others.set(item.storeName, list)
        continue
      }
      loose.push(item)
    }

    const sections: { title: string; accent?: boolean; items: CatalogItem[] }[] = []
    if (kit.length) {
      sections.push({
        title: preferredStyleName ? `Ce style · ${preferredStyleName}` : 'Ce style',
        accent: true,
        items: kit,
      })
    }
    if (preferred.length) {
      sections.push({
        title: preferredStoreName ?? preferred[0].storeName ?? 'Ce magasin',
        accent: !kit.length,
        items: preferred,
      })
    }
    for (const [name, list] of [...others.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      sections.push({ title: name, items: list })
    }
    if (loose.length) sections.push({ title: kit.length ? 'Autres pièces' : 'Autres pièces', items: loose })
    return sections
  }, [shown, preferredStoreId, preferredStoreName, preferredStyleId, preferredStyleName])

  return (
    <aside className="flex max-h-[70vh] min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--rm-text)]/8 bg-white lg:max-h-[calc(100vh-8rem)]">
      <div className="border-b border-[var(--rm-text)]/8 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">Catalogue</p>
        <p className="mt-0.5 text-xs text-[var(--rm-muted)]">
          {hint ?? 'Choisis une pièce, puis tape la photo.'}
        </p>
        <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
          {tabs.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                tab === t
                  ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                  : 'bg-[var(--rm-secondary)] text-[var(--rm-muted)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--rm-muted)]">Aucune pièce dans cet onglet.</p>
        ) : (
          groups.map(group => (
            <section key={group.title} className="mb-3">
              <p
                className={`px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                  group.accent ? 'text-[var(--rm-accent)]' : 'text-[var(--rm-muted)]'
                }`}
              >
                {group.title}
              </p>
              <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                {group.items.map(item => {
                  const active = pendingId === item.id
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onPick(item)}
                        className={`w-full overflow-hidden rounded-xl border text-left transition ${
                          active
                            ? 'border-[var(--rm-primary)] ring-2 ring-[var(--rm-primary)]/25'
                            : 'border-[var(--rm-text)]/8 hover:border-[var(--rm-primary)]/30'
                        }`}
                      >
                        <div className="flex aspect-square items-center justify-center bg-[linear-gradient(180deg,#eef3ef_0%,#e3ebe6_100%)] p-1.5">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
                          ) : (
                            <div className="h-full w-full rounded-lg bg-[var(--rm-secondary)]" />
                          )}
                        </div>
                        <div className="px-2 py-1.5">
                          <p className="truncate text-[11px] font-semibold text-[var(--rm-ink)]">{item.name}</p>
                          <p
                            className={`truncate text-[10px] font-medium ${
                              preferredStoreId && item.storeId === preferredStoreId
                                ? 'text-[var(--rm-accent)]'
                                : 'text-[var(--rm-muted)]'
                            }`}
                          >
                            {storeLabel(item)}
                          </p>
                          {item.price > 0 ? (
                            <p className="truncate text-[10px] text-[var(--rm-muted)]">{formatDA(item.price)}</p>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  )
}
