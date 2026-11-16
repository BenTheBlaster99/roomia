import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import PageHero from '@/components/site/PageHero'
import RevealOnScroll from '@/components/site/RevealOnScroll'
import SiteFooter from '@/components/site/SiteFooter'
import SiteHeader from '@/components/site/SiteHeader'

const PARTNER_MAIL = 'mailto:partners@roomia.dz?subject=Partnership Inquiry'

// 16 Nov: restyled to the brand but not linked: it recruits furniture brands for the earlier marketplace idea.
export default async function PartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('partners')

  return (
    <div className="site-page">
      <SiteHeader />

      <main>
        <PageHero
          eyebrow={t('eyebrow')}
          title={
            <>
              {t('title1')}
              <br />
              <em>{t('title2')}</em>
            </>
          }
          lead={t('lead')}
        >
          <a href={PARTNER_MAIL} className="site-btn site-btn--gold site-btn--lg">
            {t('cta')}
          </a>
        </PageHero>

        <section className="site-section">
          <div className="site-wrap">
            <h2 className="site-h2" data-reveal="">
              {t('how')}
            </h2>
            <ol className="site-steps" data-reveal="1">
              {[
                { n: '01', title: t('s1t'), desc: t('s1d') },
                { n: '02', title: t('s2t'), desc: t('s2d') },
                { n: '03', title: t('s3t'), desc: t('s3d') },
                { n: '04', title: t('s4t'), desc: t('s4d') },
              ].map(({ n, title, desc }) => (
                <li key={n}>
                  <span className="site-num">{n}</span>
                  <div className="site-stack">
                    <h3 className="site-h3">{title}</h3>
                    <p className="site-text">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="site-section is-paper">
          <div className="site-wrap">
            <h2 className="site-h2" data-reveal="">
              {t('why')}
            </h2>
            <div className="site-grid site-grid--3">
              {[
                { title: t('w1t'), desc: t('w1d') },
                { title: t('w2t'), desc: t('w2d') },
                { title: t('w3t'), desc: t('w3d') },
              ].map(({ title, desc }, i) => (
                <article key={title} className="site-card" data-reveal={String(i + 1)}>
                  <h3 className="site-h3">{title}</h3>
                  <p className="site-text">{desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section is-blue">
          <div className="site-wrap">
            <h2 className="site-h2">{t('who')}</h2>
            <ul className="site-tags">
              {['Furniture stores', 'Lighting brands', 'Home décor', 'Textiles', 'Kitchen & dining', 'Local manufacturers', 'Online shops'].map(
                tag => (
                  <li key={tag}>{tag}</li>
                ),
              )}
            </ul>
          </div>
        </section>

        <section className="site-section">
          <div className="site-wrap">
            <div className="site-stack" data-reveal="">
              <h2 className="site-h2">{t('endTitle')}</h2>
              <p className="site-lead">{t('endBody')}</p>
              <div>
                <a href={PARTNER_MAIL} className="site-btn site-btn--primary site-btn--lg">
                  {t('cta')}
                </a>
              </div>
              <p>
                <Link href="/" className="site-link">
                  {t('back')}
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <RevealOnScroll />
    </div>
  )
}
