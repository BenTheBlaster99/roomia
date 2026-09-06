'use client'

import { useEffect, useState } from 'react'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import { supabase } from '@/lib/supabase'
import ProductCard from './ProductCard'
import StoreHeader from './StoreHeader'
import { previewFour, type CatalogItem, type CatalogStore } from './catalog-data'

export default function CatalogPage() {
  const [stores, setStores] = useState<CatalogStore[]>([])
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase
        .from('stores')
        .select('id, name, slug, city, logo_url, quartier, whatsapp, maps_url')
        .order('name'),
      supabase
        .from('furniture_items')
        .select('id, name, category, image_url, store_id, price, featured')
        .not('store_id', 'is', null)
        .order('name'),
    ]).then(([storesRes, itemsRes]) => {
      setStores((storesRes.data ?? []) as CatalogStore[])
      setItems((itemsRes.data ?? []) as CatalogItem[])
      setLoading(false)
    })
  }, [])

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />

      <main className="rm-page pb-20 pt-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">Partenaires</p>
        <h1 className="rm-display mt-2 text-4xl font-bold tracking-tight text-[var(--rm-ink)]">Catalogue</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--rm-muted)]">
          Quatre pièces à la une par magasin. Ouvre une pièce pour la voir dans ta photo.
        </p>

        {loading ? (
          <p className="mt-12 text-sm text-[var(--rm-muted)]">Chargement…</p>
        ) : stores.length === 0 ? (
          <p className="mt-12 text-sm text-[var(--rm-muted)]">Aucun magasin pour le moment.</p>
        ) : (
          stores.map(store => {
            const pieces = items.filter(i => i.store_id === store.id)
            const preview = previewFour(pieces)
            return (
              <section
                key={store.id}
                className="mt-14 border-t border-[var(--rm-text)]/10 pt-10 first:mt-12 first:border-t-0 first:pt-0"
              >
                <StoreHeader store={store} compact pieceCount={pieces.length} />

                {pieces.length === 0 ? (
                  <p className="mt-5 text-sm text-[var(--rm-muted)]">Pas encore de pièces.</p>
                ) : (
                  <>
                    <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                      {preview.map(item => (
                        <li key={item.id}>
                          <ProductCard item={item} href={`/catalog/${store.slug}/${item.id}`} />
                        </li>
                      ))}
                    </ul>
                    <a
                      href={`/catalog/${store.slug}`}
                      className="rm-btn-secondary mt-5 flex w-full items-center justify-center py-2.5 text-sm"
                    >
                      Voir plus de {store.name}
                    </a>
                  </>
                )}
              </section>
            )
          })
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
