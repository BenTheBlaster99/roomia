import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { catalogForPreset } from '../lib/mock-catalog.ts'
import { placeFurnitureInRoom } from '../lib/preset-layout.ts'
import {
  DEFAULT_ROOM_DIMS,
  STYLE_NAMES,
  STYLE_PRESENTATION,
  STYLE_SLUG,
} from '../lib/style-room-presentation.ts'

const PRIORITY: Record<string, string[]> = {
  'Living Room': ['Sofa', 'Coffee Table', 'Chair', 'Rug', 'Light', 'TV Unit'],
  Bedroom: ['Bed', 'Wardrobe', 'Side Table', 'Rug', 'Light', 'Chair'],
}

function loadEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync('.env.local', 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => line.split('=').map(s => s.trim()))
      .map(([k, ...v]) => [k, v.join('=')]),
  )
}

function pickItems(
  catalog: ReturnType<typeof catalogForPreset>,
  roomType: string,
  max = 6,
) {
  const order = PRIORITY[roomType] ?? []
  const picked: typeof catalog = []

  for (const cat of order) {
    const item = catalog.find(i => i.category === cat && !picked.some(p => p.id === i.id))
    if (item) picked.push(item)
    if (picked.length >= max) return picked
  }

  for (const item of catalog) {
    if (picked.length >= max) break
    if (!picked.some(p => p.id === item.id)) picked.push(item)
  }

  return picked
}

async function main() {
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_SECRET_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.error(`
Missing Supabase credentials.

Add to .env.local:
  NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co   (you already have this)
  SUPABASE_SERVICE_ROLE_KEY=eyJ...                    (service role — see below)

Where to find the service role key:
  Supabase Dashboard → your project → Project Settings → API
  → "Project API keys" → service_role (secret)

⚠ Never commit this key or use it in client/browser code. Scripts only.
`)
    process.exit(1)
  }

  const supabase = createClient(url, key)
  const roomTypes = ['Living Room', 'Bedroom'] as const
  const rows = []

  for (const styleName of STYLE_NAMES) {
    for (const roomType of roomTypes) {
      const catalog = catalogForPreset(styleName, roomType)
      const selected = pickItems(catalog, roomType, 6)

      if (selected.length < 4) {
        console.warn(`⚠ Only ${selected.length} items for ${styleName} ${roomType}`)
      }

      const dims = DEFAULT_ROOM_DIMS[roomType]
      const presentation = STYLE_PRESENTATION[styleName]
      const roomConfig = { ...dims, ...presentation }
      const furniture = placeFurnitureInRoom(selected, dims).map(
        ({ id: _id, ...rest }) => rest,
      )

      rows.push({
        name: `${styleName} ${roomType}`,
        room_type: roomType,
        style_id: STYLE_SLUG[styleName],
        budget_tier: 'comfortable',
        thumbnail_url: null,
        room_config: roomConfig,
        furniture,
      })

      console.log(`✓ ${styleName} ${roomType} — ${selected.length} items, ${furniture.length} placed`)
    }
  }

  const { error: deleteError } = await supabase
    .from('room_presets')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  if (deleteError && !deleteError.message.includes('does not exist')) {
    console.warn('Clear existing presets:', deleteError.message)
  }

  const { data, error } = await supabase.from('room_presets').insert(rows).select('id, name')
  if (error) throw error

  console.log(`\nInserted ${data?.length ?? rows.length} room presets.`)
  data?.forEach(row => console.log(`  ${row.name} → ${row.id}`))
  console.log('\nOpen /rooms to browse, or /studio?preset=<id>')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
