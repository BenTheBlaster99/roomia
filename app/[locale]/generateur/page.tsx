import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import PageHero from '@/components/site/PageHero'
import SiteFooter from '@/components/site/SiteFooter'
import SiteHeader from '@/components/site/SiteHeader'

// 16 Nov: restyled to the brand but not linked: the AI room-photo tools belong to the earlier consumer product.
export default async function GenerateurPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('generateur')

  const cards = [
    { n: '01', href: '/room-composer', title: t('composerTitle'), desc: t('composerDesc'), cta: t('composerCta'), intl: false },
    { n: '02', href: '/room-composer?mode=kitchen', title: t('kitchenTitle'), desc: t('kitchenDesc'), cta: t('kitchenCta'), intl: false },
    { n: '03', href: '/quiz', title: t('quizTitle'), desc: t('quizDesc'), cta: t('quizCta'), intl: true },
  ]

  return (
    <div className="site-page">
      <SiteHeader />

      <main>
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('sub')} />

        <section className="site-section is-paper">
          <div className="site-wrap">
            <div className="site-grid site-grid--3">
              {cards.map(card => {
                const body = (
                  <>
                    <span className="site-num">{card.n}</span>
                    <h2 className="site-h3">{card.title}</h2>
                    <p className="site-text">{card.desc}</p>
                    <span className="site-card-go">{card.cta} →</span>
                  </>
                )
                return card.intl ? (
                  <Link key={card.n} href={card.href} className="site-card">
                    {body}
                  </Link>
                ) : (
                  <a key={card.n} href={card.href} className="site-card">
                    {body}
                  </a>
                )
              })}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
