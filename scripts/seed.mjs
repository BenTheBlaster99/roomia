import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => line.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL in .env.local and SUPABASE_SECRET_KEY env var')
  process.exit(1)
}

const supabase = createClient(url, key)

const styles = [
  ['maximalism', 'Maximalism', 'Bold. Layered. Expressive.', 'Built on abundance and curated visual richness. Mixes patterns, textures, colors, and eras in a deliberate but visually dense composition. Focuses on storytelling through objects, art, and layered decor.', '#0F4C5C', '#6A1F2B', 'Patterned wallpaper, velvet, lacquered wood, silk and embroidered textiles, glass and mirrored surfaces, mixed metals'],
  ['minimalism', 'Minimalism', 'Calm. Clean. Spacious.', 'Based on the idea of less is more. Contains only necessary elements, emphasizing simplicity, functionality, and visual clarity with soft neutral tones.', '#FAF8F2', '#DCCDB8', 'Frameless or hidden-leg furniture, light wood, soft neutral tones, very little decoration'],
  ['industrial', 'Industrial', 'Raw. Bold. Utilitarian.', 'Exposes structural and mechanical elements instead of hiding them. Combines rough textures with functional furniture to create a strong, masculine, and urban atmosphere.', '#3C3C3C', '#8B4A32', 'Black steel-framed furniture, dark brown leather, factory-style chairs, open storage systems, metal and iron details'],
  ['traditional_algerian', 'Traditional Algerian', 'Ornate. Warm. Cultural.', 'Emphasizes craftsmanship, decorative details, and hospitality. Spaces often feel vibrant, intimate, and deeply rooted in heritage.', '#B65E3C', '#1F4E79', 'Carved wooden furniture, low seating, copper accessories, richly patterned fabrics, arches'],
  ['mediterranean_coastal', 'Mediterranean Coastal', 'Breezy. Natural. Sunlit.', 'Prioritizes natural light, earthy textures, and a relaxed atmosphere with organic materials and soft ocean-inspired colors. Interiors feel fresh, inviting, and connected to nature.', '#D9C3A5', '#4F84A6', 'Natural stone, rattan, linen, light wood, ceramics'],
].map(([id, name, tagline, description, main_color, accent_color, notes]) => ({
  id, name, tagline, description, main_color, accent_color, notes,
}))

const budgetRanges = [
  { room: 'Living Room', tight: 'under 100,000 DZD', comfortable: '100,000 – 350,000 DZD', premium: '350,000+ DZD', notes: 'Sofa, coffee table, rug, lighting, curtains' },
  { room: 'Bedroom', tight: 'under 150,000 DZD', comfortable: '150,000 – 300,000 DZD', premium: '300,000+ DZD', notes: 'Bed, wardrobe, night stands' },
]

async function seed() {
  const { error: stylesError } = await supabase.from('styles').upsert(styles)
  if (stylesError) throw stylesError

  const { error: budgetError } = await supabase.from('budget_ranges').upsert(budgetRanges)
  if (budgetError) throw budgetError

  const { count } = await supabase.from('styles').select('*', { count: 'exact', head: true })
  console.log(`Seeded ${count} styles and ${budgetRanges.length} budget ranges`)
}

seed().catch(err => {
  console.error(err)
  process.exit(1)
})
