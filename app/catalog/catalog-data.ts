export type CatalogStore = {
  id: string
  name: string
  slug: string
  city: string | null
  logo_url: string | null
  quartier: string | null
  whatsapp: string | null
  maps_url: string | null
}

export type CatalogItem = {
  id: string
  name: string
  category: string | null
  image_url: string | null
  price: number | null
  featured?: boolean
  store_id?: string
}

export function previewFour<T extends { featured?: boolean }>(items: T[]): T[] {
  const starred = items.filter(i => i.featured)
  const rest = items.filter(i => !i.featured)
  return [...starred, ...rest].slice(0, 4)
}

export function whatsappHref(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  let digits = raw.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('0') && digits.length >= 9) digits = `213${digits.slice(1)}`
  return `https://wa.me/${digits}`
}

export function mapsHref(
  mapsUrl: string | null | undefined,
  fallbackQuery: string | null | undefined,
): string | null {
  const raw = mapsUrl?.trim()
  if (raw?.startsWith('http')) return raw
  const q = raw || fallbackQuery?.trim()
  if (!q) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

export function storePlaceLine(store: Pick<CatalogStore, 'city' | 'quartier'>): string | null {
  const parts = [store.quartier, store.city].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
