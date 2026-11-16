import { setRequestLocale } from 'next-intl/server'
import SiteFooter from '@/components/site/SiteFooter'
import SiteHeader from '@/components/site/SiteHeader'
import QuizFlow from './QuizFlow'

// 16 Nov: restyled to the brand but not linked: a consumer style quiz from the earlier product.

export default async function QuizPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div className="site-page">
      <SiteHeader />
      <main>
        <QuizFlow />
      </main>
      <SiteFooter />
    </div>
  )
}
