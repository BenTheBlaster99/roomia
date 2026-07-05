import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'
import type { RoomPresetRow } from '@/types/room-preset'

export const metadata = {
  title: 'Room Presets — Roomia',
}

export default async function RoomsPage() {
  const { data: presets, error } = await supabase
    .from('room_presets')
    .select('id, name, room_type, style_id, budget_tier, thumbnail_url, room_config')
    .order('style_id')
    .order('room_type')

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 px-6 py-16">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Room presets</h1>
          <p className="text-zinc-600 mb-6">
            Could not load presets. Run <code className="text-sm bg-zinc-200 px-1 rounded">supabase/room_presets.sql</code> in Supabase, then{' '}
            <code className="text-sm bg-zinc-200 px-1 rounded">npm run generate-presets</code>.
          </p>
          <p className="text-sm text-red-600">{error.message}</p>
          <Link href="/configure" className="inline-block mt-8 text-amber-600 font-medium hover:underline">
            ← Start from scratch
          </Link>
        </div>
      </div>
    )
  }

  const rows = (presets ?? []) as Pick<
    RoomPresetRow,
    'id' | 'name' | 'room_type' | 'style_id' | 'budget_tier' | 'thumbnail_url' | 'room_config'
  >[]

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900">
      <nav className="flex items-center justify-between px-6 py-5 border-b border-zinc-200 bg-white">
        <Link href="/" className="text-xl font-bold text-amber-600 tracking-tight">
          roomia
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/marketplace" className="hidden sm:inline text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
            Catalog
          </Link>
          <Link
            href="/configure"
            className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold hover:bg-amber-600 transition-all"
          >
            Custom room
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Curated room presets</h1>
          <p className="text-zinc-600 max-w-xl">
            Pick a styled living room or bedroom — open it in the 3D studio and customize from there.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center">
            <p className="text-zinc-600 mb-4">No presets yet.</p>
            <p className="text-sm text-zinc-500">
              Run <code className="bg-zinc-100 px-1 rounded">npm run generate-presets</code> after applying{' '}
              <code className="bg-zinc-100 px-1 rounded">supabase/room_presets.sql</code>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {rows.map(preset => {
              const colors = STYLE_CARD_COLORS[preset.style_id ?? ''] ?? {
                main: '#E8E4E0',
                accent: '#9CA3AF',
              }
              const wall = preset.room_config?.wallColor ?? colors.main

              return (
                <Link
                  key={preset.id}
                  href={`/studio?preset=${preset.id}`}
                  className="group block rounded-2xl overflow-hidden border border-zinc-200 bg-white shadow-sm hover:shadow-md hover:border-amber-300 transition-all"
                >
                  <div
                    className="aspect-[4/3] relative flex items-end p-4"
                    style={{
                      background: preset.thumbnail_url
                        ? `url(${preset.thumbnail_url}) center/cover`
                        : `linear-gradient(145deg, ${wall} 0%, ${colors.accent}88 100%)`,
                    }}
                  >
                    {!preset.thumbnail_url && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-30 text-6xl select-none">
                        {preset.room_type === 'Bedroom' ? '🛏' : '🛋'}
                      </div>
                    )}
                    <span className="relative text-xs font-medium uppercase tracking-wider text-zinc-800 bg-white/80 px-2 py-1 rounded">
                      {preset.room_type}
                    </span>
                  </div>
                  <div className="p-4">
                    <h2 className="font-semibold text-lg group-hover:text-amber-700 transition-colors">
                      {preset.name}
                    </h2>
                    <p className="text-sm text-zinc-500 mt-1 capitalize">
                      {preset.budget_tier} · Open in studio →
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
