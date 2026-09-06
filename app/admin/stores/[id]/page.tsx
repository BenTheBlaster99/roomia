'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import StaffGate from '../../StaffGate'

const CATEGORIES = [
  'Sofa',
  'Chair',
  'Bed',
  'Coffee Table',
  'Dining Table',
  'Side Table',
  'TV Unit',
  'Wardrobe',
  'Bookshelf',
  'Rug',
  'Light',
  'Curtains',
]

type StoreRow = {
  id: string
  name: string
  city: string | null
  logo_url: string | null
  quartier: string | null
  whatsapp: string | null
  maps_url: string | null
}

type ItemRow = {
  id: string
  name: string
  category: string | null
  image_url: string | null
  price: number | null
  featured: boolean
}

type ImageRow = { id: string; url: string; kind: string }

function FileDrop({
  label,
  hint,
  required,
  multiple,
  files,
  onChange,
  resetKey,
}: {
  label: string
  hint: string
  required?: boolean
  multiple?: boolean
  files: File[]
  onChange: (files: File[]) => void
  resetKey: number
}) {
  return (
    <label className="block cursor-pointer">
      <span className="mb-1.5 block text-sm font-medium text-[var(--rm-muted)]">{label}</span>
      <span className="flex min-h-[7.5rem] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-4 py-5 text-center transition hover:border-[var(--rm-primary)]/35">
        <span className="text-sm font-semibold text-[var(--rm-ink)]">
          {files.length === 0 ? 'Cliquer pour choisir' : files.length === 1 ? files[0].name : `${files.length} fichiers`}
        </span>
        <span className="mt-1 text-xs text-[var(--rm-muted)]">{hint}</span>
      </span>
      <input
        key={resetKey}
        type="file"
        accept="image/*"
        required={required}
        multiple={multiple}
        className="sr-only"
        onChange={e => onChange(Array.from(e.target.files ?? []))}
      />
    </label>
  )
}

function StoreProducts() {
  const params = useParams<{ id: string }>()
  const storeId = params.id
  const [store, setStore] = useState<StoreRow | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [images, setImages] = useState<Record<string, ImageRow[]>>({})
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Sofa')
  const [price, setPrice] = useState('')
  const [featuredNew, setFeaturedNew] = useState(false)
  const [hero, setHero] = useState<File | null>(null)
  const [extras, setExtras] = useState<File[]>([])
  const [resetKey, setResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const heroPreview = useMemo(() => (hero ? URL.createObjectURL(hero) : null), [hero])
  useEffect(() => {
    return () => {
      if (heroPreview) URL.revokeObjectURL(heroPreview)
    }
  }, [heroPreview])

  async function load() {
    const { data: storeRow, error: storeErr } = await supabase
      .from('stores')
      .select('id, name, city, logo_url, quartier, whatsapp, maps_url')
      .eq('id', storeId)
      .single()
    if (storeErr) {
      setError(storeErr.message)
      return
    }
    setStore(storeRow as StoreRow)

    const { data: itemRows, error: itemErr } = await supabase
      .from('furniture_items')
      .select('id, name, category, image_url, price, featured')
      .eq('store_id', storeId)
      .order('name')
    if (itemErr) {
      setError(itemErr.message)
      return
    }
    const list = ((itemRows ?? []) as ItemRow[]).map(row => ({ ...row, featured: Boolean(row.featured) }))
    setItems(list)

    if (list.length === 0) {
      setImages({})
      return
    }
    const { data: imgRows } = await supabase
      .from('furniture_images')
      .select('id, url, kind, furniture_id')
      .in(
        'furniture_id',
        list.map(i => i.id),
      )
      .order('sort_order')
    const map: Record<string, ImageRow[]> = {}
    for (const row of imgRows ?? []) {
      const fid = String((row as { furniture_id: string }).furniture_id)
      map[fid] = map[fid] ?? []
      map[fid].push({ id: row.id, url: row.url, kind: row.kind })
    }
    setImages(map)
  }

  useEffect(() => {
    void load()
  }, [storeId])

  async function uploadFile(path: string, file: File): Promise<string> {
    const { error: upErr } = await supabase.storage.from('catalog').upload(path, file, { upsert: true })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('catalog').getPublicUrl(path)
    return data.publicUrl
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!hero) {
      setError('Il faut une photo principale (fond nettoyé).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data: item, error: insErr } = await supabase
        .from('furniture_items')
        .insert({
          name: name.trim(),
          category,
          room: 'Living Room',
          store_id: storeId,
          price: Number(price.replace(/\s/g, '')) || 0,
          featured: featuredNew,
        })
        .select('id')
        .single()
      if (insErr || !item) throw insErr ?? new Error('Insert failed')

      const ext = hero.name.split('.').pop() || 'jpg'
      const heroPath = `${storeId}/${item.id}/hero.${ext}`
      const heroUrl = await uploadFile(heroPath, hero)

      await supabase.from('furniture_items').update({ image_url: heroUrl }).eq('id', item.id)
      await supabase.from('furniture_images').insert({
        furniture_id: item.id,
        url: heroUrl,
        storage_path: heroPath,
        kind: 'hero',
        sort_order: 0,
      })

      let i = 1
      for (const file of extras) {
        const eext = file.name.split('.').pop() || 'jpg'
        const path = `${storeId}/${item.id}/extra-${i}.${eext}`
        const url = await uploadFile(path, file)
        await supabase.from('furniture_images').insert({
          furniture_id: item.id,
          url,
          storage_path: path,
          kind: 'extra',
          sort_order: i,
        })
        i += 1
      }

      setName('')
      setPrice('')
      setFeaturedNew(false)
      setHero(null)
      setExtras([])
      setResetKey(k => k + 1)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec')
    } finally {
      setBusy(false)
    }
  }

  const featuredCount = items.filter(i => i.featured).length

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    if (!store) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase
      .from('stores')
      .update({
        city: store.city,
        quartier: store.quartier,
        whatsapp: store.whatsapp,
        maps_url: store.maps_url,
      })
      .eq('id', storeId)
    setBusy(false)
    if (err) setError(err.message)
  }

  async function onLogo(file: File) {
    const ext = file.name.split('.').pop() || 'png'
    const path = `${storeId}/logo.${ext}`
    const { error: upErr } = await supabase.storage.from('catalog').upload(path, file, { upsert: true })
    if (upErr) {
      setError(upErr.message)
      return
    }
    const { data } = supabase.storage.from('catalog').getPublicUrl(path)
    const logo_url = `${data.publicUrl}?v=${Date.now()}`
    const { error: err } = await supabase.from('stores').update({ logo_url }).eq('id', storeId)
    if (err) setError(err.message)
    else setStore(s => (s ? { ...s, logo_url } : s))
  }

  async function toggleFeatured(item: ItemRow, next: boolean) {
    if (next && featuredCount >= 4 && !item.featured) {
      setError('Maximum 4 pièces à la une (grille 2×2).')
      return
    }
    const { error: err } = await supabase.from('furniture_items').update({ featured: next }).eq('id', item.id)
    if (err) setError(err.message)
    else setItems(list => list.map(row => (row.id === item.id ? { ...row, featured: next } : row)))
  }

  return (
    <div className="space-y-8">
      <div>
        <a href="/admin" className="text-sm font-semibold text-[var(--rm-primary)]">
          ‹ Tous les magasins
        </a>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-ink)]">
          {store?.name ?? '…'}
        </h1>
        <p className="mt-1 text-sm text-[var(--rm-muted)]">
          {store?.city ?? 'Ville non indiquée'}
          {' · '}
          {items.length} pièce{items.length === 1 ? '' : 's'}
          {' · '}
          {featuredCount}/4 à la une
        </p>
      </div>

      {store ? (
        <form
          onSubmit={saveProfile}
          className="rounded-3xl border border-[var(--rm-text)]/8 bg-white p-5 shadow-[0_20px_50px_-40px_rgba(20,32,28,0.45)]"
        >
          <h2 className="text-sm font-bold text-[var(--rm-ink)]">Fiche magasin (catalogue public)</h2>
          <div className="mt-4 flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-bg)]">
              {store.logo_url ? (
                <img src={store.logo_url} alt="" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-[var(--rm-muted)]">Logo</div>
              )}
            </div>
            <label className="text-sm font-semibold text-[var(--rm-primary)]">
              Changer le logo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void onLogo(file)
                }}
              />
            </label>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Quartier</span>
              <input
                value={store.quartier ?? ''}
                onChange={e => setStore({ ...store, quartier: e.target.value })}
                placeholder="El Mouradia"
                className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Ville</span>
              <input
                value={store.city ?? ''}
                onChange={e => setStore({ ...store, city: e.target.value })}
                placeholder="Alger"
                className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">WhatsApp</span>
              <input
                value={store.whatsapp ?? ''}
                onChange={e => setStore({ ...store, whatsapp: e.target.value })}
                placeholder="0550 00 00 00"
                className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Google Maps</span>
              <input
                value={store.maps_url ?? ''}
                onChange={e => setStore({ ...store, maps_url: e.target.value })}
                placeholder="Lien Maps ou adresse"
                className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
              />
            </label>
          </div>
          <button type="submit" disabled={busy} className="rm-btn-secondary mt-4 text-sm">
            Enregistrer la fiche
          </button>
        </form>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <form
          onSubmit={onCreate}
          className="h-fit space-y-4 rounded-3xl border border-[var(--rm-text)]/8 bg-white p-5 shadow-[0_20px_50px_-40px_rgba(20,32,28,0.45)]"
        >
          <h2 className="text-sm font-bold text-[var(--rm-ink)]">Nouvelle pièce</h2>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Nom</span>
            <input
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Sofa 01"
              className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Catégorie</span>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Prix (DA)</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="90000"
              className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--rm-ink)]">
            <input
              type="checkbox"
              checked={featuredNew}
              onChange={e => setFeaturedNew(e.target.checked)}
              disabled={!featuredNew && featuredCount >= 4}
            />
            À la une (grille 2×2)
          </label>
          <FileDrop
            label="Photo principale"
            hint="Fond nettoyé — c’est l’identité du generate"
            required
            files={hero ? [hero] : []}
            resetKey={resetKey}
            onChange={files => setHero(files[0] ?? null)}
          />
          {heroPreview ? (
            <img src={heroPreview} alt="" className="h-28 w-full rounded-xl object-contain bg-[var(--rm-bg)]" />
          ) : null}
          <FileDrop
            label="Autres angles"
            hint="Optionnel — pour plus tard (3D)"
            multiple
            files={extras}
            resetKey={resetKey}
            onChange={setExtras}
          />
          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          ) : null}
          <button type="submit" disabled={busy} className="rm-btn-primary w-full text-sm">
            {busy ? 'Envoi…' : 'Ajouter la pièce'}
          </button>
        </form>

        {items.length === 0 ? (
          <div className="flex min-h-[20rem] items-center justify-center rounded-3xl border border-dashed border-[var(--rm-text)]/15 bg-white/70 px-6 text-center">
            <div>
              <p className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--rm-ink)]">
                Pas encore de pièces
              </p>
              <p className="mt-2 text-sm text-[var(--rm-muted)]">
                Hero + extras à gauche. Les extras restent stockés, le generate n’utilise que le hero.
              </p>
            </div>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map(item => (
              <li
                key={item.id}
                className="overflow-hidden rounded-2xl border border-[var(--rm-text)]/8 bg-white"
              >
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="aspect-square w-full bg-[var(--rm-bg)] object-contain" />
                ) : (
                  <div className="aspect-square bg-[var(--rm-secondary)]" />
                )}
                <div className="p-3">
                  <p className="font-semibold text-[var(--rm-ink)]">{item.name}</p>
                  <p className="text-xs text-[var(--rm-muted)]">
                    {item.category}
                    {' · '}
                    {(images[item.id] ?? []).length} photo{(images[item.id] ?? []).length === 1 ? '' : 's'}
                  </p>
                  <label className="mt-2 flex items-center gap-2 text-xs font-medium text-[var(--rm-ink)]">
                    <input
                      type="checkbox"
                      checked={item.featured}
                      onChange={e => void toggleFeatured(item, e.target.checked)}
                      disabled={!item.featured && featuredCount >= 4}
                    />
                    À la une
                  </label>
                  <label className="mt-2 block text-[11px] font-medium text-[var(--rm-muted)]">
                    Prix (DA)
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      defaultValue={item.price && item.price > 0 ? item.price : ''}
                      placeholder="Sur demande"
                      className="mt-1 w-full rounded-lg border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-2 py-1.5 text-sm text-[var(--rm-ink)] outline-none ring-[var(--rm-primary)] focus:ring-2"
                      onBlur={e => {
                        const n = Number(e.target.value.replace(/\s/g, '')) || 0
                        void supabase.from('furniture_items').update({ price: n }).eq('id', item.id)
                      }}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function AdminStorePage() {
  return (
    <StaffGate>
      <StoreProducts />
    </StaffGate>
  )
}
