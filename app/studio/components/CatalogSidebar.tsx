'use client'

import { useMemo } from 'react'
import { useStudioStore } from '@/store/useStudioStore'
import { MOCK_CATALOG } from '@/lib/mock-catalog'
import { CATEGORIES_BY_ROOM, CATEGORY_COLORS } from '@/lib/studio-constants'

export default function CatalogSidebar() {
  const {
    activeRoom, setActiveRoom, activeCategory, setActiveCategory,
    searchQuery, setSearchQuery, addItemFromCatalog,
    preFilterStyle, setPreFilterStyle,
  } = useStudioStore()

  const categories = CATEGORIES_BY_ROOM[activeRoom] ?? []

  const filtered = useMemo(() => {
    return MOCK_CATALOG.filter(item => {
      const matchRoom = item.room.includes(activeRoom)
      const matchCat = !activeCategory || item.category === activeCategory
      const matchSearch = !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase())
      const matchPreStyle = !preFilterStyle || item.style === preFilterStyle
      return matchRoom && matchCat && matchSearch && matchPreStyle
    })
  }, [activeRoom, activeCategory, searchQuery, preFilterStyle])

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
                className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-lg"
                style={{ backgroundColor: (CATEGORY_COLORS[item.category] ?? '#888') + '33' }}
              >
                {getCategoryEmoji(item.category)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-zinc-900 truncate">{item.name}</div>
                <div className="text-xs text-zinc-500">{item.category}</div>
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
