import { supabase } from '@/lib/supabase'
import { buildDesignPath, parseDesignParams } from '@/lib/design-params'
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
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function Room3DPage({ searchParams }: Props) {
  const design = parseDesignParams(await searchParams)
  const { room, style, budget, width, length, height } = design

  const { data: furniture } = await supabase
    .from('furniture_items')
    .select('*')
    .eq('style_id', style)
    .ilike('room', `%${room}%`)
    .eq('budget_tier', budget)

  const backHref = buildDesignPath('/result', design)

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
            {room} · {width}m × {length}m × {height}m · Orbit with mouse · Scroll to zoom
          </p>
        </div>

        <Room3DCanvasLoader
          furniture={(furniture ?? []) as FurnitureItem[]}
          room={room}
          styleId={style}
          budgetTier={budget}
          width={parseFloat(width)}
          length={parseFloat(length)}
          height={parseFloat(height)}
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
          Walls and furniture render from the same floor plan data as the 2D view.
        </p>
      </div>
    </div>
  )
}
