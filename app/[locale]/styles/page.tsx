import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import PageHero from '@/components/site/PageHero'
import SiteFooter from '@/components/site/SiteFooter'
import SiteHeader from '@/components/site/SiteHeader'
import { STYLE_IDS, StyleChip } from '@/components/marketing/StyleChip'

// 16 Nov: restyled to the brand but not linked: a consumer style library that leads to the style quiz.
export default async function StylesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('home')

  return (
    <div className="site-page">
      <SiteHeader />

      <main>
        <PageHero
          title={t('stylesExpandedTitle')}
          lead={t.rich('stylesExpandedSub', {
            quiz: chunks => <em style={{ fontStyle: 'normal', fontWeight: 600, letterSpacing: '0.04em' }}>{chunks}</em>,
          })}
        >
          <Link href="/quiz" className="site-btn site-btn--gold site-btn--lg">
            {t('stylesTakeQuiz')}
          </Link>
        </PageHero>

        <section className="site-section is-paper">
          <div className="site-wrap">
            <div className="site-grid site-grid--4">
              {STYLE_IDS.map(id => (
                <StyleChip key={id} id={id} label={t(`styleName.${id}`)} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
