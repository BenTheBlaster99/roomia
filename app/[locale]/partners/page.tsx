import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

export default async function PartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('partners')

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav
        ctaHref="mailto:partners@roomia.dz?subject=Partnership Inquiry"
        ctaLabel={t('cta')}
      />

      <section className="relative min-h-[70svh] overflow-hidden">
        <HaikeiBackdrop variant="hero" />
        <div className="rm-page relative flex min-h-[70svh] flex-col justify-end pb-16 pt-24 md:justify-center">
          <p className="rm-rise text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="rm-rise rm-rise-delay-1 rm-display mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-[var(--rm-ink)] md:text-6xl">
            {t('title1')}
            <br />
            {t('title2')}
          </h1>
          <p className="rm-rise rm-rise-delay-2 mt-6 max-w-xl text-base leading-relaxed text-[var(--rm-muted)] md:text-lg">
            {t('lead')}
          </p>
          <div className="rm-rise rm-rise-delay-3 mt-9">
            <a
              href="mailto:partners@roomia.dz?subject=Partnership Inquiry"
              className="rm-btn-accent px-8 py-3.5 text-base"
            >
              {t('cta')}
            </a>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] py-20">
        <div className="rm-page">
          <h2 className="rm-display text-3xl font-bold tracking-tight">{t('how')}</h2>
          <ol className="mt-12 space-y-0 divide-y divide-[var(--rm-text)]/10">
            {[
              { n: '01', title: t('s1t'), desc: t('s1d') },
              { n: '02', title: t('s2t'), desc: t('s2d') },
              { n: '03', title: t('s3t'), desc: t('s3d') },
              { n: '04', title: t('s4t'), desc: t('s4d') },
            ].map(({ n, title, desc }) => (
              <li key={n} className="grid gap-3 py-8 sm:grid-cols-[4rem_1fr] sm:gap-8">
                <span className="font-mono text-sm text-[var(--rm-accent)]">{n}</span>
                <div>
                  <h3 className="rm-display text-xl font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--rm-muted)]">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="py-20">
        <div className="rm-page">
          <h2 className="rm-display text-3xl font-bold tracking-tight">{t('why')}</h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {[
              { title: t('w1t'), desc: t('w1d') },
              { title: t('w2t'), desc: t('w2d') },
              { title: t('w3t'), desc: t('w3d') },
            ].map(({ title, desc }) => (
              <div key={title}>
                <div className="mb-3 h-1 w-10 bg-[var(--rm-primary)]" />
                <h3 className="rm-display text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--rm-muted)]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-primary)] py-16 text-[var(--rm-surface)]">
        <div className="rm-page">
          <h2 className="rm-display text-2xl font-bold">{t('who')}</h2>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[var(--rm-surface)]/80">
            {[
              'Furniture stores',
              'Lighting brands',
              'Home décor',
              'Textiles',
              'Kitchen & dining',
              'Local manufacturers',
              'Online shops',
            ].map(tag => (
              <span key={tag} className="border-b border-[var(--rm-surface)]/25 pb-0.5">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden py-24">
        <HaikeiBackdrop variant="band" />
        <div className="rm-page relative text-center">
          <h2 className="rm-display text-3xl font-bold tracking-tight md:text-4xl">
            {t('endTitle')}
          </h2>
          <p className="mt-4 text-[var(--rm-muted)]">{t('endBody')}</p>
          <a
            href="mailto:partners@roomia.dz?subject=Partnership Inquiry"
            className="rm-btn-primary mt-8 px-10 py-3.5"
          >
            {t('cta')}
          </a>
          <p className="mt-8 text-sm">
            <Link href="/" className="font-semibold text-[var(--rm-primary)] hover:underline">
              {t('back')}
            </Link>
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
