import NextLink from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { supabase } from '@/lib/supabase'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'
import type { RoomPresetRow } from '@/types/room-preset'
import PageHero from '@/components/site/PageHero'
import SiteFooter from '@/components/site/SiteFooter'
import SiteHeader from '@/components/site/SiteHeader'

// 16 Nov: restyled to the brand but not linked: room presets for the earlier 3D configurator.
const FALLBACK_COLORS = { main: 'var(--brand-paper)', accent: 'var(--brand-blue-line)' }

export default async function RoomsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('rooms')

  const { data: presets, error } = await supabase
    .from('room_presets')
    .select('id, name, room_type, style_id, budget_tier, thumbnail_url, room_config')
    .order('style_id')
    .order('room_type')

  if (error) {
    return (
      <div className="site-page">
        <SiteHeader />
        <main>
          <PageHero title={t('title')} lead={t('error')} />
          <section className="site-section">
            <div className="site-wrap">
              <p className="site-text" style={{ color: 'var(--brand-danger)' }}>
                {error.message}
              </p>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    )
  }

  const rows = (presets ?? []) as Pick<
    RoomPresetRow,
    'id' | 'name' | 'room_type' | 'style_id' | 'budget_tier' | 'thumbnail_url' | 'room_config'
  >[]

  return (
    <div className="site-page">
      <SiteHeader />

      <main>
        <PageHero title={t('title')} lead={t('sub')}>
          <NextLink href="/studio?create=1" className="site-btn site-btn--gold site-btn--lg">
            {t('custom')}
          </NextLink>
        </PageHero>

        <section className="site-section is-paper">
          <div className="site-wrap">
            {rows.length === 0 ? (
              <div className="site-card">
                <p className="site-text">{t('empty')}</p>
              </div>
            ) : (
              <div className="site-grid site-grid--4">
                {rows.map(preset => {
                  const colors = STYLE_CARD_COLORS[preset.style_id ?? ''] ?? FALLBACK_COLORS
                  const wall = preset.room_config?.wallColor ?? colors.main

                  return (
                    <NextLink key={preset.id} href={`/studio?preset=${preset.id}`} className="site-card" style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
                      <div
                        style={{
                          position: 'relative',
                          aspectRatio: '4 / 3',
                          display: 'flex',
                          alignItems: 'flex-end',
                          padding: 16,
                          background: preset.thumbnail_url
                            ? `url(${preset.thumbnail_url}) center/cover`
                            : `linear-gradient(145deg, ${wall} 0%, color-mix(in srgb, ${colors.accent} 53%, transparent) 100%)`,
                        }}
                      >
                        <span className="site-eyebrow" style={{ padding: '4px 8px', borderRadius: 6, background: 'var(--brand-white)', color: 'var(--brand-blue-deep)' }}>
                          {preset.room_type}
                        </span>
                      </div>
                      <div style={{ padding: 18, display: 'grid', gap: 4 }}>
                        <h2 className="site-h3">{preset.name}</h2>
                        <p className="site-text" style={{ fontSize: 14, textTransform: 'capitalize' }}>
                          {preset.budget_tier} · {t('open')}
                        </p>
                      </div>
                    </NextLink>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
