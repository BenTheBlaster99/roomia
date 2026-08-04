import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { MOCK_CATALOG } from '@/lib/mock-catalog'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'
import {
  PhotoHero,
  PhotoPaths,
  PhotoSettleSection,
} from '@/components/marketing/LandingMotion'

export default async function LandingPage() {
  const [{ data: styles }, { data: presets, count: presetCount }] = await Promise.all([
    supabase.from('styles').select('id, name, tagline, main_color, accent_color'),
    supabase
      .from('room_presets')
      .select('id, name, room_type, style_id, room_config', { count: 'exact' })
      .order('style_id')
      .limit(4),
  ])

  const catalogCount = MOCK_CATALOG.filter(i => i.available).length
  const featuredPresets = presets ?? []

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />
      <PhotoHero />
      <PhotoSettleSection />
      <PhotoPaths />

      <section className="border-y border-[var(--rm-text)]/8 bg-[var(--rm-primary)] px-5 py-10 text-[var(--rm-surface)] md:px-6">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 md:grid-cols-4">
          {[
            { value: String(styles?.length ?? 5), label: 'Design styles' },
            { value: String(presetCount ?? 10), label: 'Room presets' },
            { value: String(catalogCount), label: 'Catalog pieces' },
            { value: 'AI', label: 'Photo + 3D render' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="rm-display text-3xl font-bold tracking-tight md:text-4xl">{value}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--rm-surface)]/65">
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {featuredPresets.length > 0 && (
        <section className="px-5 py-20 md:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="rm-display text-3xl font-bold tracking-tight md:text-4xl">
                  Start from a preset
                </h2>
                <p className="mt-2 text-[var(--rm-muted)]">Architect-curated rooms, ready in studio.</p>
              </div>
              <Link
                href="/rooms"
                className="shrink-0 text-sm font-semibold text-[var(--rm-primary)] hover:underline"
              >
                View all →
              </Link>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {featuredPresets.map(preset => {
                const colors = STYLE_CARD_COLORS[preset.style_id ?? ''] ?? {
                  main: '#E8E4E0',
                  accent: '#9CA3AF',
                }
                const wall = preset.room_config?.wallColor ?? colors.main

                return (
                  <Link
                    key={preset.id}
                    href={`/studio?preset=${preset.id}`}
                    className="group overflow-hidden rm-panel transition-transform hover:-translate-y-1"
                  >
                    <div
                      className="relative aspect-[4/3]"
                      style={{
                        background: `linear-gradient(155deg, ${wall} 0%, ${colors.accent}99 100%)`,
                      }}
                    >
                      <span className="absolute bottom-3 left-3 text-[10px] font-bold uppercase tracking-wider text-[var(--rm-ink)]/80">
                        {preset.room_type}
                      </span>
                    </div>
                    <div className="p-4">
                      <div className="truncate text-sm font-bold group-hover:text-[var(--rm-primary)]">
                        {preset.name}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--rm-muted)]">Open in studio →</div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-5 py-20 md:px-6">
        <div className="mx-auto max-w-6xl">
          <h2 className="rm-display text-3xl font-bold tracking-tight md:text-4xl">
            Styles with a point of view
          </h2>
          <p className="mt-3 max-w-lg text-[var(--rm-muted)]">
            Five curated directions — every preset and catalog piece is tagged.
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {styles?.map(style => (
              <Link
                key={style.id}
                href="/rooms"
                className="group rm-panel p-5 transition-colors hover:border-[var(--rm-primary)]/30"
              >
                <div className="mb-4 flex h-10 overflow-hidden rounded-lg">
                  <div className="flex-1" style={{ backgroundColor: style.main_color }} />
                  <div className="w-10" style={{ backgroundColor: style.accent_color }} />
                </div>
                <div className="rm-display text-lg font-bold group-hover:text-[var(--rm-primary)]">
                  {style.name}
                </div>
                <div className="mt-1 text-sm text-[var(--rm-muted)]">{style.tagline}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-5 py-24 md:px-6">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="rm-display text-4xl font-bold tracking-tight md:text-5xl">
            Your space.
            <br />
            Your rules.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[var(--rm-muted)]">
            Free to explore. No account needed. Design today — quote when you&apos;re ready.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/configure" className="rm-btn-primary px-10 py-3.5 text-base">
              Start designing
            </Link>
            <Link href="/marketplace" className="rm-btn-secondary px-10 py-3.5 text-base">
              Browse catalog
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
