import { supabase } from '@/lib/supabase'
import type { FurnitureItem } from '@/types'
import Link from 'next/link'
import Room3DCanvasLoader from './Room3DCanvasLoader'

const CATEGORY_COLORS: Record<string, string> = {
  'Sofa': '#4F84A6',
  'Bed': '#7C5C8A',
  'Chair': '#4CAF7D',
  'Coffee Table': '#C9A84C',
  'Dining Table': '#C9A84C',
  'Light': '#E8C97A',
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

export default async function Room3DPage({ searchParams }: Props) {
  const { room, style, budget, width, length } = await searchParams

  const { data: furniture } = await supabase
    .from('furniture_items')
    .select('*')
    .eq('style_id', style)
    .ilike('room', `%${room}%`)
    .eq('budget_tier', budget)

  const backHref = `/result?room=${encodeURIComponent(room)}&style=${style}&budget=${budget}&width=${width}&length=${length}`

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white">
        <span className="text-xl font-bold text-amber-600">roomia</span>
        <Link href={backHref} className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
          ← Back to results
        </Link>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold mb-1">3D Room View</h1>
          <p className="text-sm text-zinc-500">
            {room} · {width}m × {length}m · Orbit with mouse · Scroll to zoom
          </p>
        </div>

        <Room3DCanvasLoader
          furniture={(furniture ?? []) as FurnitureItem[]}
          width={parseFloat(width)}
          length={parseFloat(length)}
        />

        <div className="flex flex-wrap gap-2 pt-2">
          {furniture?.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-2 bg-white border border-zinc-200
                         rounded-lg px-3 py-1.5 shadow-sm"
            >
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: CATEGORY_COLORS[item.category] ?? '#888' }}
              />
              <span className="text-xs text-zinc-700">{item.name}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-zinc-400 text-center pb-6">
          Furniture shown with standard dimensions. Real 3D models coming with partner catalog.
        </p>
      </div>
    </div>
  )
}
