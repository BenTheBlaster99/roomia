'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import { supabase } from '@/lib/supabase'
import ProductCard from '../ProductCard'
import StoreHeader from '../StoreHeader'
import type { CatalogItem, CatalogStore } from '../catalog-data'

export default function StoreCatalogPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const [store, setStore] = useState<CatalogStore | null>(null)
  const [items, setItems] = useState<CatalogItem[]>([])
  const [filter, setFilter] = useState('Tous')
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: storeRow } = await supabase
        .from('stores')
        .select('id, name, slug, city, logo_url, quartier, whatsapp, maps_url')
        .eq('slug', slug)
        .maybeSingle()
      if (cancelled) return
      if (!storeRow) {
        setMissing(true)
        setLoading(false)
        return
      }
      setStore(storeRow as CatalogStore)
      const { data: itemRows } = await supabase
        .from('furniture_items')
        .select('id, name, category, image_url, price, featured')
        .eq('store_id', storeRow.id)
        .order('name')
      if (cancelled) return
      setItems((itemRows ?? []) as CatalogItem[])
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [slug])

  const categories = useMemo(() => {
    const set = new Set(items.map(i => i.category).filter((c): c is string => Boolean(c)))
    return ['Tous', ...Array.from(set).sort()]
  }, [items])

  const visible = filter === 'Tous' ? items : items.filter(i => i.category === filter)

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />

      <main className="rm-page pb-20 pt-10">
        <a href="/catalog" className="text-sm font-semibold text-[var(--rm-primary)]">
          ‹ Tous les magasins
        </a>

        {loading ? (
          <p className="mt-10 text-sm text-[var(--rm-muted)]">Chargement…</p>
        ) : missing || !store ? (
          <p className="mt-10 text-sm text-[var(--rm-muted)]">Magasin introuvable.</p>
        ) : (
          <>
            <div className="mt-8">
              <StoreHeader store={store} pieceCount={items.length} />
            </div>

            {items.length === 0 ? (
              <p className="mt-10 text-sm text-[var(--rm-muted)]">Pas encore de pièces.</p>
            ) : (
              <>
                {categories.length > 2 ? (
                  <div className="mt-8 flex gap-2 overflow-x-auto pb-1">
                    {categories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setFilter(cat)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                          filter === cat
                            ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                            : 'bg-white text-[var(--rm-muted)]'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                ) : null}

                <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {visible.map(item => (
                    <li key={item.id}>
                      <ProductCard item={item} href={`/catalog/${store.slug}/${item.id}`} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
