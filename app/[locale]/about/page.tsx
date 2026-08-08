import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('about')

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />

      <section className="relative overflow-hidden">
        <HaikeiBackdrop variant="hero" />
        <div className="relative mx-auto max-w-3xl px-5 pb-20 pt-20 md:px-6 md:pt-28">
          <p className="rm-rise text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="rm-rise rm-rise-delay-1 rm-display mt-4 text-5xl font-bold tracking-tight text-[var(--rm-primary)] md:text-6xl">
            {t('title')}
          </h1>
          <p className="rm-rise rm-rise-delay-2 mt-6 text-xl leading-relaxed text-[var(--rm-ink)] md:text-2xl">
            {t('lead')}
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-5 py-16 md:px-6">
        <div className="mx-auto max-w-3xl space-y-6 text-base leading-relaxed text-[var(--rm-muted)]">
          <p>{t('p1')}</p>
          <p>{t('p2')}</p>
        </div>
      </section>

      <section className="px-5 py-20 md:px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="rm-display text-2xl font-bold tracking-tight md:text-3xl">{t('team')}</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            {[
              { name: 'Sarah', role: t('sarahRole'), desc: t('sarahDesc'), tone: 'var(--rm-accent)' },
              { name: 'Aimen', role: t('aimenRole'), desc: t('aimenDesc'), tone: 'var(--rm-primary)' },
            ].map(({ role, name, desc, tone }) => (
              <div key={name} className="border-t-2 pt-6" style={{ borderColor: tone }}>
                <div className="rm-display text-2xl font-bold">{name}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rm-muted)]">
                  {role}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[var(--rm-muted)]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-[var(--rm-text)]/8 px-5 py-20 md:px-6">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-3xl">
          <h2 className="rm-display text-2xl font-bold tracking-tight md:text-3xl">{t('why')}</h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--rm-muted)]">
            {t('whyBody')}
          </p>

          <div className="mt-12 rm-panel p-8">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rm-muted)]">
              {t('contact')}
            </h3>
            <p className="mt-3 text-sm text-[var(--rm-muted)]">{t('contactBody')}</p>
            <a
              href="mailto:contact@roomia.dz"
              className="mt-4 inline-block text-sm font-bold text-[var(--rm-primary)] hover:underline"
            >
              contact@roomia.dz →
            </a>
          </div>

          <div className="mt-10">
            <Link href="/generateur" className="rm-btn-primary px-10 py-3.5">
              {t('try')}
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
