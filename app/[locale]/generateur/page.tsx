import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

export default async function GenerateurPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('generateur')

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="/room-composer" ctaLabel={t('composerCta')} />

      <section className="relative overflow-hidden">
        <HaikeiBackdrop variant="hero" />
        <div className="rm-page relative py-20 md:py-28">
          <p className="rm-rise text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="rm-rise rm-rise-delay-1 rm-display mt-4 text-4xl font-bold tracking-tight text-[var(--rm-ink)] md:text-6xl">
            {t('title')}
          </h1>
          <p className="rm-rise rm-rise-delay-2 mt-5 max-w-xl text-lg text-[var(--rm-muted)]">
            {t('sub')}
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] py-16">
        <div className="rm-page grid gap-6 md:grid-cols-2">
          <a
            href="/room-composer"
            className="group rm-panel block p-8 transition-transform hover:-translate-y-1"
          >
            <span className="font-mono text-xs text-[var(--rm-accent)]">01</span>
            <h2 className="rm-display mt-3 text-2xl font-bold group-hover:text-[var(--rm-primary)]">
              {t('composerTitle')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--rm-muted)]">
              {t('composerDesc')}
            </p>
            <span className="mt-6 inline-block text-sm font-semibold text-[var(--rm-primary)]">
              {t('composerCta')} →
            </span>
          </a>

          <Link
            href="/quiz"
            className="group rm-panel block p-8 transition-transform hover:-translate-y-1"
          >
            <span className="font-mono text-xs text-[var(--rm-accent)]">02</span>
            <h2 className="rm-display mt-3 text-2xl font-bold group-hover:text-[var(--rm-primary)]">
              {t('quizTitle')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--rm-muted)]">
              {t('quizDesc')}
            </p>
            <span className="mt-6 inline-block text-sm font-semibold text-[var(--rm-primary)]">
              {t('quizCta')} →
            </span>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
