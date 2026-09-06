'use client'

import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { slugify } from '@/lib/slugify'
import StaffGate from './StaffGate'

type StoreRow = {
  id: string
  name: string
  slug: string
  city: string | null
  notes: string | null
}

function StoresHome() {
  const [stores, setStores] = useState<StoreRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error: err } = await supabase.from('stores').select('id, name, slug, city, notes').order('name')
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    const list = (data ?? []) as StoreRow[]
    setStores(list)
    if (list.length > 0) {
      const { data: items } = await supabase.from('furniture_items').select('store_id').in(
        'store_id',
        list.map(s => s.id),
      )
      const next: Record<string, number> = {}
      for (const row of items ?? []) {
        const id = String((row as { store_id: string }).store_id)
        next[id] = (next[id] ?? 0) + 1
      }
      setCounts(next)
    } else {
      setCounts({})
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const slug = slugify(name)
    const { error: err } = await supabase.from('stores').insert({ name: name.trim(), slug, city: city.trim() || null })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setName('')
    setCity('')
    await load()
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">Catalogue 2D</p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-ink)]">
          Magasins partenaires
        </h1>
        <p className="mt-1 max-w-xl text-sm text-[var(--rm-muted)]">
          Crée le magasin, puis ajoute les pièces. Noms placeholder OK — la photo principale est celle du generate.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-white px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--rm-muted)]">Magasins</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--rm-ink)]">
            {loading ? '—' : stores.length}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-white px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--rm-muted)]">Pièces</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--rm-ink)]">
            {loading ? '—' : Object.values(counts).reduce((a, b) => a + b, 0)}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-white px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--rm-muted)]">Accès</p>
          <p className="mt-1 text-sm font-semibold text-[var(--rm-ink)]">Jack &amp; Sarah</p>
        </div>
      </div>

      <form
        onSubmit={onCreate}
        className="rounded-3xl border border-[var(--rm-text)]/8 bg-white p-5 shadow-[0_20px_50px_-40px_rgba(20,32,28,0.45)] md:p-6"
      >
        <h2 className="text-sm font-bold text-[var(--rm-ink)]">Nouveau magasin</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem_auto]">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Nom du magasin</span>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ex. Mobilier El Bahdja"
              className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Ville</span>
            <input
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="Alger"
              className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
            />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={busy} className="rm-btn-primary w-full px-5 py-2.5 text-sm sm:w-auto">
              {busy ? 'Création…' : 'Créer'}
            </button>
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        ) : null}
      </form>

      {loading ? (
        <p className="text-sm text-[var(--rm-muted)]">Chargement…</p>
      ) : stores.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[var(--rm-text)]/15 bg-white/70 px-6 py-14 text-center">
          <p className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--rm-ink)]">
            Aucun magasin encore
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--rm-muted)]">
            Crée le premier au-dessus, puis ouvre-le pour coller les photos nettoyées.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {stores.map(store => (
            <li key={store.id}>
              <a
                href={`/admin/stores/${store.id}`}
                className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--rm-text)]/8 bg-white px-5 py-4 transition hover:border-[var(--rm-primary)]/25 hover:shadow-[0_16px_40px_-32px_rgba(20,32,28,0.5)]"
              >
                <span>
                  <span className="block font-semibold text-[var(--rm-ink)]">{store.name}</span>
                  <span className="mt-0.5 block text-sm text-[var(--rm-muted)]">
                    {store.city ?? 'Ville non indiquée'}
                    {' · '}
                    {counts[store.id] ?? 0} pièce{(counts[store.id] ?? 0) === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-[var(--rm-primary)]">Ajouter des pièces →</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AdminPage() {
  return (
    <StaffGate>
      <StoresHome />
    </StaffGate>
  )
}
