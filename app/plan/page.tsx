import { supabase } from '@/lib/supabase'
import { buildDesignPath, parseDesignParams } from '@/lib/design-params'
import type { FurnitureItem } from '@/types'
import Link from 'next/link'
import PlanCanvasLoader from './PlanCanvasLoader'

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function PlanPage({ searchParams }: Props) {
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
          <h1 className="text-xl font-bold mb-1">Floor Plan</h1>
          <p className="text-sm text-zinc-500">
            {room} · {width}m × {length}m · {height}m ceiling · Drag furniture to arrange
          </p>
        </div>

        <PlanCanvasLoader
          furniture={(furniture ?? []) as FurnitureItem[]}
          room={room}
          styleId={style}
          budgetTier={budget}
          width={parseFloat(width)}
          length={parseFloat(length)}
          height={parseFloat(height)}
        />

        <p className="text-xs text-zinc-400 text-center pb-6">
          Walls, doors, and windows render from your scanned or default room layout.
        </p>
      </div>
    </div>
  )
}
