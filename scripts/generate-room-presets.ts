import { existsSync, readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { MOCK_CATALOG, type CatalogItem } from '../lib/mock-catalog.ts'
import { furnitureItemToCatalogItem } from '../lib/catalog-mapper.ts'
import { placeFurnitureInRoom } from '../lib/preset-layout.ts'
import {
  DEFAULT_ROOM_DIMS,
  STYLE_NAMES,
  STYLE_PRESENTATION,
  STYLE_SLUG,
} from '../lib/style-room-presentation.ts'
import type { FurnitureItem } from '../types/index.ts'

const PRIORITY: Record<string, string[]> = {
  'Living Room': ['Sofa', 'Coffee Table', 'Chair', 'Rug', 'Light', 'TV Unit'],
  Bedroom: ['Bed', 'Wardrobe', 'Side Table', 'Rug', 'Light', 'Chair'],
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#') && line.includes('='))
      .map(line => {
        const [k, ...rest] = line.split('=')
        return [k.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')]
      }),
  )
}

function loadEnv(): Record<string, string> {
  return {
    ...parseEnvFile('../furniture-3d-gen/.env'),
    ...parseEnvFile('.env'),
    ...parseEnvFile('.env.local'),
  }
}

function mergeCatalog(dbItems: CatalogItem[]): CatalogItem[] {
  const dbNames = new Set(dbItems.map(item => item.name))
  return [...dbItems, ...MOCK_CATALOG.filter(item => !dbNames.has(item.name))]
}

const SKIP_PRESET_NAMES = new Set(['Reed', 'Pebble'])
const FAKE_LOCAL_MODELS = new Set([
  '/models/generated-chair.glb',
  '/models/generated-bed.glb',
])

function catalogForPreset(all: CatalogItem[], style: string, roomType: string): CatalogItem[] {
  const inStyle = all.filter(
    item =>
      item.available &&
      item.style === style &&
      item.room.includes(roomType) &&
      !SKIP_PRESET_NAMES.has(item.name) &&
      !FAKE_LOCAL_MODELS.has(item.modelUrl ?? ''),
  )

  if (roomType !== 'Bedroom') return inStyle

  // Bedroom chairs: use Pure (real GLB) instead of Reed/Pebble fakes
  if (!inStyle.some(item => item.category === 'Chair')) {
    const pure = all.find(item => item.name === 'Pure' && item.available)
    if (pure) return [...inStyle, { ...pure, room: [...pure.room, 'Bedroom'] }]
  }
  return inStyle
}

async function fetchDbCatalog(url: string, anonKey: string): Promise<CatalogItem[]> {
  const supabase = createClient(url, anonKey)
  const { data, error } = await supabase
    .from('furniture_items')
    .select('*')
    .or('model_url.not.is.null,image_url.not.is.null')
    .order('name')
  if (error) {
    console.warn('Live catalog load failed, using mock only:', error.message)
    return []
  }
  return ((data ?? []) as FurnitureItem[]).map(row => furnitureItemToCatalogItem(row))
}

function pickItems(
  catalog: CatalogItem[],
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
  const dumpOnly = process.argv.includes('--dump')
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_SECRET_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY

  const dbItems = url && anon ? await fetchDbCatalog(url, anon) : []
  const allItems = mergeCatalog(dbItems)
  if (dbItems.length > 0) {
    console.log(`Using ${dbItems.length} live furniture_items + mock fillers`)
  }

  const roomTypes = ['Living Room', 'Bedroom'] as const
  const rows = []

  for (const styleName of STYLE_NAMES) {
    for (const roomType of roomTypes) {
      const catalog = catalogForPreset(allItems, styleName, roomType)
      const selected = pickItems(catalog, roomType, 6)

      if (selected.length < 4) {
        console.warn(`⚠ Only ${selected.length} items for ${styleName} ${roomType}`)
      }

      const dims = DEFAULT_ROOM_DIMS[roomType]
      const presentation = STYLE_PRESENTATION[styleName]
      const roomConfig = { ...dims, ...presentation }
      const furniture = placeFurnitureInRoom(selected, dims, roomType).map(
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

  if (dumpOnly) {
    const { writeFileSync, mkdirSync } = await import('fs')
    const { dirname } = await import('path')
    const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? '/tmp/roomia-presets.json'
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(rows, null, 2))
    console.log(`\nDumped ${rows.length} presets → ${out}`)
    console.log('Apply to DB with: npm run generate-presets  (needs SUPABASE_SERVICE_ROLE_KEY)')
    return
  }

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

Or dump JSON only:
  npx tsx scripts/generate-room-presets.ts --dump
`)
    process.exit(1)
  }

  const supabase = createClient(url, key)

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
