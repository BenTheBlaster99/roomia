'use client'

import { useEffect, useMemo, useState } from 'react'
import { useStudioStore } from '@/store/useStudioStore'
import { MOCK_CATALOG, type CatalogItem, type CatalogMaterial } from '@/lib/mock-catalog'
import { fetchGeneratedCatalog } from '@/lib/studio-catalog'
import { furnitureItemToCatalogItem } from '@/lib/catalog-mapper'
import { CATEGORIES_BY_ROOM, CATEGORY_COLORS } from '@/lib/studio-constants'

type PriceMode = 'any' | 'below' | 'above' | 'between'

const MATERIAL_OPTIONS: CatalogMaterial[] = [
  'wood',
  'metal',
  'fabric',
  'leather',
  'glass',
  'marble',
  'rattan',
]

const MATERIAL_LABELS: Record<CatalogMaterial, string> = {
  wood: 'Wood',
  metal: 'Metal',
  fabric: 'Fabric',
  leather: 'Leather',
  glass: 'Glass',
  marble: 'Stone/marble',
  rattan: 'Rattan',
  other: 'Other',
}

function parseDa(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(/,/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function matchesPrice(
  price: number,
  mode: PriceMode,
  minRaw: string,
  maxRaw: string,
): boolean {
  if (mode === 'any') return true
  const min = parseDa(minRaw)
  const max = parseDa(maxRaw)
  if (mode === 'below') return max == null || price < max
  if (mode === 'above') return min == null || price > min
  // between
  if (min != null && price < min) return false
  if (max != null && price > max) return false
  return true
}

export default function CatalogSidebar() {
  const {
    activeRoom, setActiveRoom, activeCategory, setActiveCategory,
    searchQuery, setSearchQuery, addItemFromCatalog,
    preFilterStyle, setPreFilterStyle,
  } = useStudioStore()

  const [generatedItems, setGeneratedItems] = useState<CatalogItem[]>([])
  const [generatedStatus, setGeneratedStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [priceMode, setPriceMode] = useState<PriceMode>('any')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [materialFilter, setMaterialFilter] = useState<CatalogMaterial | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    setGeneratedStatus('loading')
    fetchGeneratedCatalog()
      .then(rows => {
        setGeneratedItems(rows.map(furnitureItemToCatalogItem))
        setGeneratedStatus(rows.length > 0 ? 'ready' : 'error')
      })
      .catch(err => {
        console.error('Generated catalog load failed:', err)
        setGeneratedStatus('error')
      })
  }, [])

  const categories = CATEGORIES_BY_ROOM[activeRoom] ?? []

  const catalog = useMemo(() => {
    const dbNames = new Set(generatedItems.map(item => item.name))
    const mockOnly = MOCK_CATALOG.filter(item => !dbNames.has(item.name))
    return [...generatedItems, ...mockOnly]
  }, [generatedItems])

  const availableMaterials = useMemo(() => {
    const set = new Set<CatalogMaterial>()
    for (const item of catalog) {
      if (item.material) set.add(item.material)
    }
    return MATERIAL_OPTIONS.filter(m => set.has(m))
  }, [catalog])

  const filtered = useMemo(() => {
    return catalog.filter(item => {
      const matchRoom = item.room.includes(activeRoom)
      const matchCat = !activeCategory || item.category === activeCategory
      const matchSearch = !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase())
      // Supabase AI pieces always show — don't hide behind style preset filter
      const matchPreStyle =
        item.fromDatabase || !preFilterStyle || item.style === preFilterStyle
      const matchPrice = matchesPrice(item.price, priceMode, priceMin, priceMax)
      const matchMaterial =
        !materialFilter || item.material === materialFilter
      return matchRoom && matchCat && matchSearch && matchPreStyle && matchPrice && matchMaterial
    })
  }, [
    catalog,
    activeRoom,
    activeCategory,
    searchQuery,
    preFilterStyle,
    priceMode,
    priceMin,
    priceMax,
    materialFilter,
  ])

  const filtersActive =
    priceMode !== 'any' || materialFilter != null

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex border-b border-zinc-200">
        {['Living Room', 'Bedroom'].map(r => (
          <button
            key={r}
            onClick={() => setActiveRoom(r)}
            className={`flex-1 py-3 text-xs font-medium transition-colors ${
              activeRoom === r
                ? 'text-amber-700 border-b-2 border-amber-500 bg-amber-50/50'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            {r === 'Living Room' ? '🛋️' : '🛏️'} {r}
          </button>
        ))}
      </div>

      {preFilterStyle && (
        <div className="px-3 pt-2 flex items-center justify-between bg-amber-50 border-b border-amber-100">
          <span className="text-xs text-amber-800 font-medium">Style: {preFilterStyle}</span>
          <button
            onClick={() => setPreFilterStyle(null)}
            className="text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            × clear
          </button>
        </div>
      )}

      {generatedStatus === 'loading' && (
        <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-100">
          Loading Supabase models…
        </div>
      )}
      {generatedStatus === 'error' && generatedItems.length === 0 && (
        <div className="px-3 py-2 text-xs text-red-600 border-b border-red-100 bg-red-50">
          Could not load Supabase models. Check browser console and RLS policies.
        </div>
      )}
      <div className="p-3">
        <input
          type="text"
          placeholder="Search furniture..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full bg-stone-50 border border-zinc-200 rounded-lg px-3 py-2
                     text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none
                     focus:border-amber-400 transition-colors"
        />
      </div>

      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
            !activeCategory
              ? 'bg-amber-500 text-white font-bold'
              : 'bg-stone-100 text-zinc-600 hover:bg-stone-200'
          }`}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
              activeCategory === cat
                ? 'bg-amber-500 text-white font-bold'
                : 'bg-stone-100 text-zinc-600 hover:bg-stone-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="border-b border-zinc-100 px-3 pb-3">
        <button
          type="button"
          onClick={() => setFiltersOpen(o => !o)}
          className="flex w-full items-center justify-between text-xs font-semibold text-zinc-700"
        >
          <span>
            Price & material
            {filtersActive && (
              <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                on
              </span>
            )}
          </span>
          <span className="text-zinc-400">{filtersOpen ? '−' : '+'}</span>
        </button>

        {filtersOpen && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Prix (DA)
              </label>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['any', 'Any'],
                    ['below', 'Below'],
                    ['above', 'Above'],
                    ['between', 'Between'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPriceMode(mode)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      priceMode === mode
                        ? 'bg-amber-500 text-white'
                        : 'bg-stone-100 text-zinc-600 hover:bg-stone-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {priceMode !== 'any' && (
                <div className="mt-2 flex items-center gap-2">
                  {(priceMode === 'above' || priceMode === 'between') && (
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Min DA"
                      value={priceMin}
                      onChange={e => setPriceMin(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-stone-50 px-2 py-1.5 text-xs focus:border-amber-400 focus:outline-none"
                    />
                  )}
                  {(priceMode === 'below' || priceMode === 'between') && (
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Max DA"
                      value={priceMax}
                      onChange={e => setPriceMax(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 bg-stone-50 px-2 py-1.5 text-xs focus:border-amber-400 focus:outline-none"
                    />
                  )}
                </div>
              )}
            </div>

            {availableMaterials.length > 0 && (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Material
                </label>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setMaterialFilter(null)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      !materialFilter
                        ? 'bg-amber-500 text-white'
                        : 'bg-stone-100 text-zinc-600 hover:bg-stone-200'
                    }`}
                  >
                    All
                  </button>
                  {availableMaterials.map(mat => (
                    <button
                      key={mat}
                      type="button"
                      onClick={() =>
                        setMaterialFilter(materialFilter === mat ? null : mat)
                      }
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        materialFilter === mat
                          ? 'bg-amber-500 text-white'
                          : 'bg-stone-100 text-zinc-600 hover:bg-stone-200'
                      }`}
                    >
                      {MATERIAL_LABELS[mat]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setPriceMode('any')
                  setPriceMin('')
                  setPriceMax('')
                  setMaterialFilter(null)
                }}
                className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-800"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-8">No furniture found</div>
        ) : (
          filtered.map(item => (
            <div
              key={item.id}
              className={`bg-stone-50 border rounded-xl p-3 flex items-center gap-3 transition-all cursor-pointer group ${
                item.available
                  ? 'border-zinc-200 hover:border-amber-300 hover:bg-white'
                  : 'border-zinc-200 opacity-50'
              }`}
              onClick={() => item.available && addItemFromCatalog(item)}
            >
              <div
                className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-lg overflow-hidden"
                style={
                  item.imageUrl
                    ? undefined
                    : { backgroundColor: (CATEGORY_COLORS[item.category] ?? '#888') + '33' }
                }
              >
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  getCategoryEmoji(item.category)
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-zinc-900 truncate">
                  {item.name}
                </div>
                <div className="text-xs text-zinc-500">
                  {item.category}
                  {item.material ? ` · ${MATERIAL_LABELS[item.material]}` : ''}
                </div>
                <div className="text-xs font-bold text-amber-700 mt-0.5">
                  {item.price.toLocaleString()} DZD
                </div>
              </div>

              <button
                className={`text-xs px-2 py-1 rounded-lg transition-colors flex-shrink-0 ${
                  item.available
                    ? 'bg-white border border-zinc-200 text-zinc-600 group-hover:bg-amber-500 group-hover:border-amber-500 group-hover:text-white font-bold'
                    : 'bg-stone-100 text-zinc-400 cursor-not-allowed'
                }`}
                disabled={!item.available}
              >
                {item.available ? '+' : '—'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function getCategoryEmoji(cat: string) {
  const map: Record<string, string> = {
    Sofa: '🛋️', Bed: '🛏️', Chair: '🪑',
    'Coffee Table': '☕', 'Dining Table': '🍽️', Light: '💡',
    Wardrobe: '🚪', 'TV Unit': '📺', Rug: '▭',
    'Side Table': '🪵', Bookshelf: '📚', Curtains: '🪟',
  }
  return map[cat] ?? '🪑'
}
