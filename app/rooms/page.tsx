import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'
import type { RoomPresetRow } from '@/types/room-preset'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

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
      <div className="min-h-screen bg-[var(--rm-bg)] px-6 py-16 text-[var(--rm-text)]">
        <SiteNav />
        <div className="mx-auto max-w-2xl text-center pt-16">
          <h1 className="rm-display text-2xl font-bold mb-4">Room presets</h1>
          <p className="text-[var(--rm-muted)] mb-6">
            Could not load presets. Run{' '}
            <code className="text-sm bg-[var(--rm-secondary)] px-1 rounded">supabase/room_presets.sql</code>{' '}
            in Supabase, then{' '}
            <code className="text-sm bg-[var(--rm-secondary)] px-1 rounded">npm run generate-presets</code>.
          </p>
          <p className="text-sm text-red-700">{error.message}</p>
          <Link href="/configure" className="inline-block mt-8 font-semibold text-[var(--rm-primary)] hover:underline">
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
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="/configure" ctaLabel="Custom room" />

      <section className="relative overflow-hidden border-b border-[var(--rm-text)]/8">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-6xl px-5 py-14 md:px-6">
          <h1 className="rm-display text-4xl font-bold tracking-tight md:text-5xl">
            Curated room presets
          </h1>
          <p className="mt-3 max-w-xl text-[var(--rm-muted)]">
            Pick a styled living room or bedroom — open it in the 3D studio and customize from there.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-12 md:px-6">
        {rows.length === 0 ? (
          <div className="rm-panel border-dashed p-12 text-center">
            <p className="text-[var(--rm-muted)] mb-4">No presets yet.</p>
            <p className="text-sm text-[var(--rm-muted)]">
              Run <code className="bg-[var(--rm-secondary)] px-1 rounded">npm run generate-presets</code> after
              applying <code className="bg-[var(--rm-secondary)] px-1 rounded">supabase/room_presets.sql</code>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
                  className="group rm-panel block overflow-hidden transition-transform hover:-translate-y-1"
                >
                  <div
                    className="relative aspect-[4/3] flex items-end p-4"
                    style={{
                      background: preset.thumbnail_url
                        ? `url(${preset.thumbnail_url}) center/cover`
                        : `linear-gradient(145deg, ${wall} 0%, ${colors.accent}88 100%)`,
                    }}
                  >
                    <span className="relative text-[10px] font-bold uppercase tracking-wider text-[var(--rm-ink)] bg-[var(--rm-surface)]/90 px-2 py-1 rounded">
                      {preset.room_type}
                    </span>
                  </div>
                  <div className="p-4">
                    <h2 className="rm-display text-lg font-bold group-hover:text-[var(--rm-primary)] transition-colors">
                      {preset.name}
                    </h2>
                    <p className="text-sm text-[var(--rm-muted)] mt-1 capitalize">
                      {preset.budget_tier} · Open in studio →
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
