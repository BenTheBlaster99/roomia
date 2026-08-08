import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

export default async function StylesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('stylesPage')

  const { data: styles } = await supabase
    .from('styles')
    .select('id, name, tagline, main_color, accent_color')
    .order('name')

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="/studio" ctaLabel={t('studio')} />

      <section className="relative overflow-hidden border-b border-[var(--rm-text)]/8">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="rm-display mt-3 text-4xl font-bold tracking-tight md:text-6xl">
            {t('title')}
          </h1>
          <p className="mt-4 max-w-xl text-[var(--rm-muted)] md:text-lg">{t('sub')}</p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-14 md:px-6">
        {!styles?.length ? (
          <p className="text-[var(--rm-muted)]">{t('empty')}</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {styles.map(style => (
              <article key={style.id} className="rm-panel overflow-hidden">
                <div className="flex h-28">
                  <div className="flex-[3]" style={{ backgroundColor: style.main_color }} />
                  <div className="flex-1" style={{ backgroundColor: style.accent_color }} />
                </div>
                <div className="p-6">
                  <h2 className="rm-display text-2xl font-bold">{style.name}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--rm-muted)]">
                    {style.tagline}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href="/rooms" className="rm-btn-primary text-sm">
                      {t('explore')}
                    </Link>
                    <a href="/studio" className="rm-btn-secondary text-sm">
                      {t('studio')}
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
