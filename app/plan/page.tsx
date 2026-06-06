import { supabase } from '@/lib/supabase'
import type { FurnitureItem } from '@/types'
import Link from 'next/link'
import PlanCanvasLoader from './PlanCanvasLoader'

interface Props {
  searchParams: Promise<{
    room: string
    style: string
    budget: string
    width: string
    length: string
  }>
}

export default async function PlanPage({ searchParams }: Props) {
  const { room, style, budget, width, length } = await searchParams

  const { data: furniture } = await supabase
    .from('furniture_items')
    .select('*')
    .eq('style_id', style)
    .ilike('room', `%${room}%`)
    .eq('budget_tier', budget)

  const backHref = `/result?room=${encodeURIComponent(room)}&style=${style}&budget=${budget}&width=${width}&length=${length}`

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <span className="text-xl font-bold text-amber-400">roomia</span>
        <Link href={backHref} className="text-sm text-zinc-400 hover:text-white transition-colors">
          ← Back to results
        </Link>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-bold mb-1">Floor Plan</h1>
          <p className="text-sm text-zinc-400">
            {room} · {width}m × {length}m · Drag furniture to arrange your space
          </p>
        </div>

        <PlanCanvasLoader
          furniture={(furniture ?? []) as FurnitureItem[]}
          width={parseFloat(width)}
          length={parseFloat(length)}
        />

        <p className="text-xs text-zinc-700 text-center pb-6">
          Furniture sizes are approximate standard dimensions. Actual sizes may vary.
        </p>
      </div>
    </div>
  )
}
