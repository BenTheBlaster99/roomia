import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('contact')

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />

      <section className="relative overflow-hidden">
        <HaikeiBackdrop variant="hero" />
        <div className="relative mx-auto max-w-3xl px-5 pb-16 pt-20 md:px-6 md:pt-28">
          <p className="rm-rise text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="rm-rise rm-rise-delay-1 rm-display mt-4 text-4xl font-bold tracking-tight text-[var(--rm-ink)] md:text-6xl">
            {t('title')}
          </h1>
          <p className="rm-rise rm-rise-delay-2 mt-6 max-w-xl text-lg leading-relaxed text-[var(--rm-muted)]">
            {t('body')}
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-5 py-16 md:px-6">
        <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
          <div id="launch" className="rm-panel scroll-mt-28 p-8">
            <h2 className="rm-display text-2xl font-bold tracking-tight">{t('launchTitle')}</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--rm-muted)]">{t('launchBody')}</p>
            <a
              href="mailto:contact@room-ia.com?subject=Launch%20notification"
              className="rm-btn-primary mt-6 inline-flex"
            >
              {t('launchCta')}
            </a>
          </div>
          <div className="rm-panel p-8">
            <h2 className="rm-display text-2xl font-bold tracking-tight">{t('emailTitle')}</h2>
            <a
              href="mailto:contact@room-ia.com"
              className="mt-4 inline-block text-sm font-bold text-[var(--rm-primary)] hover:underline"
            >
              contact@room-ia.com
            </a>
            <div className="mt-8">
              <Link href="/generateur" className="text-sm font-semibold text-[var(--rm-primary)] hover:underline">
                {t('tryAi')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
