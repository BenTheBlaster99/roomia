import { getTranslations, setRequestLocale } from 'next-intl/server'
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

  const tools = [
    {
      href: '/room-composer',
      title: t('composerTitle'),
      desc: t('composerDesc'),
      cta: t('composerCta'),
    },
    {
      href: '/photo-studio',
      title: t('photoTitle'),
      desc: t('photoDesc'),
      cta: t('photoCta'),
    },
  ]

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="/room-composer" ctaLabel={t('composerCta')} />

      <section className="relative overflow-hidden">
        <HaikeiBackdrop variant="hero" />
        <div className="relative mx-auto max-w-4xl px-5 py-20 md:px-6 md:py-28">
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

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-5 py-16 md:px-6">
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
          {tools.map((tool, i) => (
            <a
              key={tool.href}
              href={tool.href}
              className="group rm-panel p-8 transition-transform hover:-translate-y-1"
            >
              <span className="font-mono text-xs text-[var(--rm-accent)]">
                0{i + 1}
              </span>
              <h2 className="rm-display mt-3 text-2xl font-bold group-hover:text-[var(--rm-primary)]">
                {tool.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--rm-muted)]">{tool.desc}</p>
              <span className="mt-6 inline-block text-sm font-semibold text-[var(--rm-primary)]">
                {tool.cta} →
              </span>
            </a>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
