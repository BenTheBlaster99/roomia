import { getTranslations, setRequestLocale } from 'next-intl/server'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'
import QuizFlow from './QuizFlow'

export default async function QuizPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('quiz')

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="/studio" ctaLabel={t('navStudio')} />

      <section className="relative overflow-hidden border-b border-[var(--rm-text)]/8">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-2xl px-5 py-14 md:px-6 md:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="rm-display mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-4 text-[var(--rm-muted)] md:text-lg">{t('sub')}</p>
        </div>
      </section>

      <main className="mx-auto max-w-2xl px-5 py-12 md:px-6 md:py-16">
        <QuizFlow />
      </main>

      <SiteFooter />
    </div>
  )
}
