import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import { STYLE_IDS, StyleChip } from '@/components/marketing/StyleChip'

export default async function StylesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('home')

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />

      <main className="px-6 py-16 md:px-10 md:py-24">
        <div className="mx-auto max-w-[92rem]">
          <h1 className="rm-display mx-auto max-w-4xl text-center text-3xl font-bold tracking-tight text-[var(--rm-ink)] md:text-5xl">
            {t('stylesExpandedTitle')}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-center text-sm leading-relaxed text-[var(--rm-muted)] md:text-base">
            {t.rich('stylesExpandedSub', {
              quiz: chunks => <em className="not-italic font-semibold tracking-wide">{chunks}</em>,
            })}
          </p>
          <div className="mt-8 flex justify-center">
            <Link href="/quiz" className="rm-btn-primary px-12 py-3.5 text-base">
              {t('stylesTakeQuiz')}
            </Link>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 md:gap-5">
            {STYLE_IDS.map(id => (
              <StyleChip key={id} id={id} label={t(`styleName.${id}`)} />
            ))}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
