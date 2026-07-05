import type { FloorMaterial } from '../store/useStudioStore'

export const STYLE_NAMES = [
  'Industrial',
  'Maximalism',
  'Minimalism',
  'Traditional Algerian',
  'Mediterranean Coastal',
] as const

export type StyleName = (typeof STYLE_NAMES)[number]

export const STYLE_SLUG: Record<StyleName, string> = {
  Industrial: 'industrial',
  Maximalism: 'maximalism',
  Minimalism: 'minimalism',
  'Traditional Algerian': 'traditional_algerian',
  'Mediterranean Coastal': 'mediterranean_coastal',
}

export const SLUG_TO_STYLE: Record<string, StyleName> = Object.fromEntries(
  STYLE_NAMES.map(name => [STYLE_SLUG[name], name]),
) as Record<string, StyleName>

export const STYLE_PRESENTATION: Record<
  StyleName,
  { floorMaterial: FloorMaterial; wallColor: string }
> = {
  Industrial: { floorMaterial: 'concrete', wallColor: '#2F2F2F' },
  Maximalism: { floorMaterial: 'wood', wallColor: '#7C1D3A' },
  Minimalism: { floorMaterial: 'wood', wallColor: '#F5F0EB' },
  'Traditional Algerian': { floorMaterial: 'marble', wallColor: '#C9A07A' },
  'Mediterranean Coastal': { floorMaterial: 'tile', wallColor: '#FFFFFF' },
}

export const DEFAULT_ROOM_DIMS: Record<string, { width: number; length: number; height: number }> = {
  'Living Room': { width: 5, length: 6, height: 2.8 },
  Bedroom: { width: 4, length: 4.5, height: 2.8 },
}

export const STYLE_CARD_COLORS: Record<string, { main: string; accent: string }> = {
  industrial: { main: '#3C3C3C', accent: '#8B4A32' },
  maximalism: { main: '#0F4C5C', accent: '#6A1F2B' },
  minimalism: { main: '#FAF8F2', accent: '#DCCDB8' },
  traditional_algerian: { main: '#B65E3C', accent: '#1F4E79' },
  mediterranean_coastal: { main: '#D9C3A5', accent: '#4F84A6' },
}
