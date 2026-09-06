'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import { supabase } from '@/lib/supabase'
import { formatDA } from '@/lib/format-da'
import type { CatalogItem, CatalogStore } from '../../catalog-data'
import StoreHeader from '../../StoreHeader'

type ImageRow = { url: string; kind: string; sort_order: number }

export default function ProductPage() {
  const params = useParams<{ slug: string; itemId: string }>()
  const [store, setStore] = useState<CatalogStore | null>(null)
  const [item, setItem] = useState<CatalogItem | null>(null)
  const [images, setImages] = useState<ImageRow[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: storeRow } = await supabase
        .from('stores')
        .select('id, name, slug, city, logo_url, quartier, whatsapp, maps_url')
        .eq('slug', params.slug)
        .maybeSingle()
      if (cancelled) return
      if (!storeRow) {
        setMissing(true)
        setLoading(false)
        return
      }
      setStore(storeRow as CatalogStore)

      const { data: itemRow } = await supabase
        .from('furniture_items')
        .select('id, name, category, image_url, price, featured, store_id')
        .eq('id', params.itemId)
        .eq('store_id', storeRow.id)
        .maybeSingle()
      if (cancelled) return
      if (!itemRow) {
        setMissing(true)
        setLoading(false)
        return
      }
      const piece = itemRow as CatalogItem
      setItem(piece)

      const { data: imgRows } = await supabase
        .from('furniture_images')
        .select('url, kind, sort_order')
        .eq('furniture_id', piece.id)
        .order('sort_order')
      if (cancelled) return
      const list = (imgRows ?? []) as ImageRow[]
      setImages(list)
      setActive(list.find(i => i.kind === 'hero')?.url ?? piece.image_url)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [params.slug, params.itemId])

  const thumbs = useMemo(() => {
    const urls = images.map(i => i.url)
    if (item?.image_url && !urls.includes(item.image_url)) urls.unshift(item.image_url)
    return [...new Set(urls)]
  }, [images, item?.image_url])

  const extrasCount = images.filter(i => i.kind === 'extra').length

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />
      <main className="rm-page pb-28 pt-10">
        <a href={`/catalog/${params.slug}`} className="text-sm font-semibold text-[var(--rm-primary)]">
          ‹ {store?.name ?? 'Magasin'}
        </a>

        {loading ? (
          <p className="mt-10 text-sm text-[var(--rm-muted)]">Chargement…</p>
        ) : missing || !item || !store ? (
          <p className="mt-10 text-sm text-[var(--rm-muted)]">Pièce introuvable.</p>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:items-start">
            <div className="overflow-hidden rounded-3xl border border-[var(--rm-text)]/8 bg-white">
              <div className="flex aspect-square items-center justify-center bg-[linear-gradient(180deg,#eef3ef_0%,#e3ebe6_100%)] p-6">
                {active ? (
                  <img src={active} alt={item.name} className="max-h-full max-w-full object-contain" />
                ) : null}
              </div>
              {thumbs.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto border-t border-[var(--rm-text)]/8 px-4 py-3">
                  {thumbs.map(url => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setActive(url)}
                      className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-[var(--rm-bg)] p-1 ${
                        active === url ? 'border-[var(--rm-primary)]' : 'border-transparent'
                      }`}
                    >
                      <img src={url} alt="" className="h-full w-full object-contain" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-8">
              <div>
                {item.category ? (
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">
                    {item.category}
                  </p>
                ) : null}
                <h1 className="rm-display mt-1 text-3xl font-bold tracking-tight text-[var(--rm-ink)]">{item.name}</h1>
                <p className="mt-2 text-xl font-bold text-[var(--rm-primary)]">{formatDA(item.price)}</p>
                {extrasCount > 0 ? (
                  <p className="mt-1 text-xs text-[var(--rm-muted)]">
                    {extrasCount} autre{extrasCount === 1 ? '' : 's'} angle{extrasCount === 1 ? '' : 's'}
                  </p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--rm-muted)]">Chez</p>
                <div className="mt-3">
                  <StoreHeader store={store} compact />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {item ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--rm-text)]/10 bg-[var(--rm-bg)]/95 py-3 backdrop-blur">
          <div className="rm-page">
            <a
              href={`/room-composer?item=${item.id}&store=${store?.slug ?? params.slug}`}
              className="rm-btn-primary flex w-full justify-center py-3 text-sm"
            >
              Voir dans ma pièce
            </a>
          </div>
        </div>
      ) : null}

      <div className="pb-20">
        <SiteFooter />
      </div>
    </div>
  )
}
