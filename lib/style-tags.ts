import type { StyleId } from '@/lib/style-details'
import { isStyleId } from '@/lib/style-details'
import { supabase } from '@/lib/supabase'

const LEGACY_SLUG_TO_STYLES: Record<string, StyleId[]> = {
  industrial: ['industrial', 'bauhaus'],
  maximalism: ['maximalism', 'glamour'],
  minimalism: ['minimalism', 'japandi'],
  traditional_algerian: ['rustic', 'exotic'],
  mediterranean_coastal: ['scandinavian', 'cottagecore'],
}

const DISPLAY_STYLE_TO_STYLES: Record<string, StyleId[]> = {
  Industrial: ['industrial', 'bauhaus'],
  Maximalism: ['maximalism', 'glamour'],
  Minimalism: ['minimalism', 'japandi'],
  'Traditional Algerian': ['rustic', 'exotic'],
  'Mediterranean Coastal': ['scandinavian', 'cottagecore'],
}

export function styleIdsFromLegacySlug(slug: string | null | undefined): StyleId[] {
  if (!slug) return []
  if (isStyleId(slug)) return [slug]
  return LEGACY_SLUG_TO_STYLES[slug] ?? []
}

export function styleIdsFromDisplayStyle(style: string | null | undefined): StyleId[] {
  if (!style) return []
  return DISPLAY_STYLE_TO_STYLES[style] ?? []
}

export async function fetchFurnitureStyleTags(): Promise<Map<string, StyleId[]>> {
  const { data, error } = await supabase.from('furniture_style_tags').select('furniture_id, style_id')
  const map = new Map<string, StyleId[]>()
  if (error || !data) return map
  for (const row of data as { furniture_id: string; style_id: string }[]) {
    if (!isStyleId(row.style_id)) continue
    const list = map.get(row.furniture_id) ?? []
    if (!list.includes(row.style_id)) list.push(row.style_id)
    map.set(row.furniture_id, list)
  }
  return map
}
