'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useStudioStore } from '@/store/useStudioStore'
import { MOCK_CATALOG, type CatalogItem } from '@/lib/mock-catalog'
import { CATEGORIES_BY_ROOM, CATEGORY_COLORS } from '@/lib/studio-constants'
import CartDrawer from '@/components/CartDrawer'

const ROOM_FILTERS = ['All', 'Living Room', 'Bedroom']
const STYLE_FILTERS = [
  'All',
  'Industrial',
  'Maximalism',
  'Minimalism',
  'Traditional Algerian',
  'Mediterranean Coastal',
]
const BUDGET_FILTERS = ['All', 'tight', 'comfortable', 'premium'] as const

function getBudgetTier(price: number): 'tight' | 'comfortable' | 'premium' {
  if (price < 50000) return 'tight'
  if (price <= 150000) return 'comfortable'
  return 'premium'
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

export default function MarketplacePage() {
  const router = useRouter()
  const addItemFromCatalog = useStudioStore(s => s.addItemFromCatalog)
  const addToCart = useStudioStore(s => s.addToCart)
  const toggleCart = useStudioStore(s => s.toggleCart)
  const cart = useStudioStore(s => s.cart)
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0)

  const [room, setRoom] = useState('All')
  const [style, setStyle] = useState('All')
  const [category, setCategory] = useState<string | null>(null)
  const [budget, setBudget] = useState<(typeof BUDGET_FILTERS)[number]>('All')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [search, setSearch] = useState('')

  const availableCategories = useMemo(() => {
    if (room === 'All') {
      return Array.from(
        new Set([...CATEGORIES_BY_ROOM['Living Room'], ...CATEGORIES_BY_ROOM['Bedroom']]),
      )
    }
    return CATEGORIES_BY_ROOM[room] ?? []
  }, [room])

  const filtered = useMemo(() => {
    return MOCK_CATALOG.filter(item => {
      const matchRoom = room === 'All' || item.room.includes(room)
      const matchStyle = style === 'All' || item.style === style
      const matchCategory = !category || item.category === category
      const matchBudget = budget === 'All' || getBudgetTier(item.price) === budget
      const matchStock = !inStockOnly || item.available
      const matchSearch =
        !search ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.category.toLowerCase().includes(search.toLowerCase()) ||
        item.style.toLowerCase().includes(search.toLowerCase())
      return matchRoom && matchStyle && matchCategory && matchBudget && matchStock && matchSearch
    })
  }, [room, style, category, budget, inStockOnly, search])

  function handleAddToStudio(item: CatalogItem) {
    addItemFromCatalog(item)
    router.push('/studio')
  }

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 sticky top-0 bg-white z-20">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-xl font-bold text-amber-600 tracking-tight">
            roomia
          </Link>
          <div className="hidden sm:flex items-center gap-4 text-sm">
            <Link href="/rooms" className="text-zinc-500 hover:text-zinc-900 transition-colors">
              Presets
            </Link>
            <span className="text-amber-700 font-medium">Catalog</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleCart}
            className="flex items-center gap-2 text-xs px-4 py-2 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 transition-colors"
          >
            🛒 Cart
            {cartCount > 0 && (
              <span className="bg-white text-amber-600 text-xs px-1.5 py-0.5 rounded-full font-bold">
                {cartCount}
              </span>
            )}
          </button>
          <Link
            href="/studio"
            className="px-4 py-2 border border-zinc-200 rounded-lg text-xs text-zinc-700 hover:border-amber-400 hover:text-amber-700 transition-all bg-white"
          >
            Open Studio →
          </Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8 flex gap-8">
        <aside className="w-56 flex-shrink-0 space-y-6 hidden md:block">
          <div>
            <h1 className="text-xl font-bold mb-1">Marketplace</h1>
            <p className="text-xs text-zinc-500">{filtered.length} pieces found</p>
          </div>

          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-xs
                       text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />

          <FilterGroup title="Room">
            {ROOM_FILTERS.map(r => (
              <FilterChip
                key={r}
                active={room === r}
                onClick={() => {
                  setRoom(r)
                  setCategory(null)
                }}
              >
                {r}
              </FilterChip>
            ))}
          </FilterGroup>

          <FilterGroup title="Style">
            {STYLE_FILTERS.map(s => (
              <FilterChip key={s} active={style === s} onClick={() => setStyle(s)}>
                {s}
              </FilterChip>
            ))}
          </FilterGroup>

          <FilterGroup title="Category">
            <FilterChip active={!category} onClick={() => setCategory(null)}>
              All
            </FilterChip>
            {availableCategories.map(c => (
              <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
                {c}
              </FilterChip>
            ))}
          </FilterGroup>

          <FilterGroup title="Budget">
            {BUDGET_FILTERS.map(b => (
              <FilterChip key={b} active={budget === b} onClick={() => setBudget(b)}>
                {b === 'All' ? 'All' : b.charAt(0).toUpperCase() + b.slice(1)}
              </FilterChip>
            ))}
          </FilterGroup>

          <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={e => setInStockOnly(e.target.checked)}
              className="accent-amber-500"
            />
            In stock only
          </label>
        </aside>

        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-zinc-200 p-3 z-20">
          <select
            value={room}
            onChange={e => {
              setRoom(e.target.value)
              setCategory(null)
            }}
            className="w-full bg-stone-50 border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-900"
          >
            {ROOM_FILTERS.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-zinc-500 text-sm">
              No furniture matches your filters
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20 md:pb-0">
              {filtered.map(item => (
                <ProductCard
                  key={item.id}
                  item={item}
                  onAddToCart={() =>
                    addToCart({
                      furnitureId: item.id,
                      name: item.name,
                      category: item.category,
                      price: item.price,
                    })
                  }
                  onAddToStudio={() => handleAddToStudio(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <CartDrawer />
    </div>
  )
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
        active
          ? 'bg-amber-500 text-white font-bold'
          : 'bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
      }`}
    >
      {children}
    </button>
  )
}

function ProductCard({
  item,
  onAddToCart,
  onAddToStudio,
}: {
  item: CatalogItem
  onAddToCart: () => void
  onAddToStudio: () => void
}) {
  const tier = getBudgetTier(item.price)
  const color = CATEGORY_COLORS[item.category] ?? '#888'

  return (
    <div
      className={`bg-white border border-zinc-200 rounded-2xl overflow-hidden shadow-sm
                  hover:border-amber-200 hover:shadow transition-all ${!item.available ? 'opacity-60' : ''}`}
    >
      <div
        className="h-36 flex items-center justify-center text-4xl relative"
        style={{ background: `linear-gradient(135deg, ${color}33, ${color}11)` }}
      >
        {getCategoryEmoji(item.category)}
        {!item.available && (
          <span className="absolute top-2 right-2 text-xs bg-white/90 text-zinc-500 px-2 py-0.5 rounded-full border border-zinc-200">
            Out of stock
          </span>
        )}
        <span className="absolute top-2 left-2 text-xs bg-white/90 text-amber-700 px-2 py-0.5 rounded-full capitalize border border-zinc-200">
          {tier}
        </span>
      </div>

      <div className="p-4 space-y-2">
        <div>
          <div className="font-bold text-sm">{item.name}</div>
          <div className="text-xs text-zinc-500">
            {item.category} · {item.style}
          </div>
        </div>
        <div className="text-sm font-bold text-amber-700">{item.price.toLocaleString()} DZD</div>
        {item.notes && <p className="text-xs text-zinc-500 line-clamp-2">{item.notes}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onAddToCart}
            disabled={!item.available}
            className="flex-1 py-2 bg-stone-100 hover:bg-stone-200 disabled:opacity-30
                       disabled:cursor-not-allowed rounded-lg text-xs text-zinc-700 transition-colors"
          >
            + Cart
          </button>
          <button
            onClick={onAddToStudio}
            disabled={!item.available}
            className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-30
                       disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-colors"
          >
            Add to Studio
          </button>
        </div>
      </div>
    </div>
  )
}
