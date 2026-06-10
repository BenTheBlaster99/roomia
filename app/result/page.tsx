import { supabase } from '@/lib/supabase'
import type { Style, FurnitureItem, MoodboardImage, BudgetRange } from '@/types'
import EmailCapture from '@/components/EmailCapture'
import Link from 'next/link'

const CATEGORY_EMOJI: Record<string, string> = {
  'Sofa': '🛋️',
  'Bed': '🛏️',
  'Chair': '🪑',
  'Coffee Table': '☕',
  'Dining Table': '🍽️',
  'Light': '💡',
}

interface Props {
  searchParams: Promise<{
    room: string
    style: string
    budget: string
    width: string
    length: string
  }>
}

export default async function ResultPage({ searchParams }: Props) {
  const { room, style, budget, width, length } = await searchParams
  const area = (parseFloat(width) * parseFloat(length)).toFixed(1)

  const [styleRes, furnitureRes, moodboardRes, budgetRes] = await Promise.all([
    supabase.from('styles').select('*').eq('id', style).single(),
    supabase
      .from('furniture_items')
      .select('*')
      .eq('style_id', style)
      .ilike('room', `%${room}%`)
      .eq('budget_tier', budget),
    supabase
      .from('moodboard_images')
      .select('*')
      .eq('style_id', style)
      .eq('room', room),
    supabase.from('budget_ranges').select('*').eq('room', room).single(),
  ])

  const styleData = styleRes.data as Style
  const furniture = furnitureRes.data as FurnitureItem[]
  const moodboard = moodboardRes.data as MoodboardImage[]
  const budgetData = budgetRes.data as BudgetRange

  const total = furniture?.reduce((sum, item) => sum + item.price, 0) ?? 0

  const budgetLabels = {
    tight: budgetData?.tight,
    comfortable: budgetData?.comfortable,
    premium: budgetData?.premium,
  } as const
  const budgetLabel = budgetLabels[budget as keyof typeof budgetLabels]

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 sticky top-0 bg-white z-10">
        <span className="text-xl font-bold text-amber-600">roomia</span>
        <Link href="/configure" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
          Start over
        </Link>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-10">

        {/* ── Style header ── */}
        <div className="rounded-2xl overflow-hidden border border-zinc-200 bg-white shadow-sm">
          <div className="h-2" style={{ backgroundColor: styleData?.accent_color }} />
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full border-2 border-zinc-200 flex-shrink-0"
                style={{ backgroundColor: styleData?.main_color }}
              />
              <div>
                <h1 className="text-2xl font-bold">{styleData?.name}</h1>
                <p className="text-sm text-zinc-500">{styleData?.tagline}</p>
              </div>
            </div>
            <p className="text-sm text-zinc-600 leading-relaxed">{styleData?.description}</p>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'room', label: room },
                { key: 'dimensions', label: `${width}m × ${length}m · ${area}m²` },
                { key: 'budget', label: `${budget} budget` },
              ].map(({ key, label }) => (
                <span key={key} className="text-xs bg-stone-100 text-zinc-600 px-3 py-1 rounded-full capitalize">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Moodboard ── */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
            Moodboard
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {moodboard?.slice(0, 4).map((img, i) => (
              <div
                key={img.id}
                className="aspect-square rounded-xl border border-zinc-200 flex flex-col
                           justify-end p-4 overflow-hidden relative shadow-sm"
                style={{
                  background: i % 2 === 0
                    ? `linear-gradient(135deg, ${styleData?.main_color}44, ${styleData?.accent_color}22)`
                    : `linear-gradient(135deg, ${styleData?.accent_color}22, ${styleData?.main_color}44)`,
                }}
              >
                <p className="text-xs text-zinc-700 leading-relaxed line-clamp-3">
                  {img.description}
                </p>
                <p className="text-xs text-amber-700 mt-1.5 font-medium">
                  {img.search_keyword}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-400 mt-3 text-center">
            Final moodboard images coming with partner content
          </p>
        </div>

        {/* ── Furniture list ── */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
            Your Furniture — {furniture?.length ?? 0} pieces
          </h2>
          <div className="space-y-2">
            {furniture?.map(item => (
              <div
                key={item.id}
                className="flex items-center gap-4 p-4 bg-white rounded-xl border border-zinc-200
                           hover:border-zinc-300 transition-colors shadow-sm"
              >
                <div
                  className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center text-2xl"
                  style={{ backgroundColor: styleData?.main_color + '33' }}
                >
                  {CATEGORY_EMOJI[item.category] ?? '🪑'}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{item.name}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{item.category}</div>
                  {item.notes && (
                    <div className="text-xs text-zinc-600 mt-0.5 truncate">{item.notes}</div>
                  )}
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-amber-600">
                    {item.price.toLocaleString()} DZD
                  </div>
                  {item.partner_link ? (
                    <a
                      href={item.partner_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-zinc-500 hover:text-amber-600 transition-colors"
                    >
                      View product →
                    </a>
                  ) : (
                    <span className="text-xs text-zinc-400">Partner soon</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Budget summary ── */}
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-5">
            Budget Summary
          </h2>
          <div className="space-y-2 mb-5">
            {furniture?.map(item => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-zinc-600">{item.name}</span>
                <span className="text-zinc-800">{item.price.toLocaleString()} DZD</span>
              </div>
            ))}
          </div>
          <div className="border-t border-zinc-200 pt-4 flex justify-between items-center">
            <span className="font-bold text-sm">Estimated Total</span>
            <span className="text-2xl font-bold text-amber-600">
              {total.toLocaleString()} DZD
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            {room} · {budget} range: {budgetLabel}
          </p>
        </div>

        {/* ── Actions ── */}
        <div className="space-y-3 pb-10">
          <EmailCapture
            room={room}
            styleId={style}
            styleName={styleData?.name ?? ''}
            budget={budget}
            width={width}
            length={length}
            furniture={furniture ?? []}
            total={total}
          />

          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              `Check out my ${styleData?.name} ${room} design on Roomia 🏠\n${process.env.NEXT_PUBLIC_BASE_URL}/result?room=${encodeURIComponent(room)}&style=${style}&budget=${budget}&width=${width}&length=${length}`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 border border-zinc-200
                       rounded-xl text-sm text-zinc-600 hover:border-green-500
                       hover:text-green-600 transition-all bg-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Share on WhatsApp
          </a>

          <Link
            href={`/plan?room=${encodeURIComponent(room)}&style=${style}&budget=${budget}&width=${width}&length=${length}`}
            className="w-full block text-center py-3 border border-zinc-200 rounded-xl text-sm
                       text-zinc-600 hover:border-amber-500 hover:text-amber-600 transition-all bg-white"
          >
            🗺️ Arrange furniture in my room
          </Link>

          <Link
            href={`/room3d?room=${encodeURIComponent(room)}&style=${style}&budget=${budget}&width=${width}&length=${length}`}
            className="w-full block text-center py-3 border border-zinc-200 rounded-xl text-sm
                       text-zinc-600 hover:border-amber-500 hover:text-amber-600 transition-all bg-white"
          >
            🧊 View room in 3D
          </Link>

          <a
            href="mailto:contact@roomia.dz"
            className="w-full block text-center py-3 border border-zinc-200 rounded-xl text-sm
                       text-zinc-600 hover:border-amber-500 hover:text-amber-600 transition-all bg-white"
          >
            Book a free consultation with our designer
          </a>

          <Link
            href="/configure"
            className="w-full block text-center py-3 text-sm text-zinc-500
                       hover:text-zinc-800 transition-colors"
          >
            ← Design another room
          </Link>
        </div>

      </div>
    </div>
  )
}
