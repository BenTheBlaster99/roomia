import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'
import type { RoomPresetRow } from '@/types/room-preset'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

export default async function RoomsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('rooms')
  const tNav = await getTranslations('nav')

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
          <h1 className="rm-display text-2xl font-bold mb-4">{t('title')}</h1>
          <p className="text-[var(--rm-muted)] mb-6">{t('error')}</p>
          <p className="text-sm text-red-700">{error.message}</p>
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
      <SiteNav ctaHref="/studio?create=1" ctaLabel={tNav('ctaCustom')} />

      <section className="relative overflow-hidden border-b border-[var(--rm-text)]/8">
        <HaikeiBackdrop variant="band" />
        <div className="rm-page relative py-14">
          <h1 className="rm-display text-4xl font-bold tracking-tight md:text-5xl">{t('title')}</h1>
          <p className="mt-3 max-w-xl text-[var(--rm-muted)]">{t('sub')}</p>
          <div className="mt-6">
            <a href="/studio?create=1" className="rm-btn-primary text-sm">
              {t('custom')}
            </a>
          </div>
        </div>
      </section>

      <main className="rm-page py-12">
        {rows.length === 0 ? (
          <div className="rm-panel border-dashed p-12 text-center">
            <p className="text-[var(--rm-muted)]">{t('empty')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map(preset => {
              const colors = STYLE_CARD_COLORS[preset.style_id ?? ''] ?? {
                main: '#E8E4E0',
                accent: '#9CA3AF',
              }
              const wall = preset.room_config?.wallColor ?? colors.main

              return (
                <a
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
                      {preset.budget_tier} · {t('open')}
                    </p>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
