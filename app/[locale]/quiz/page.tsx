import { getTranslations, setRequestLocale } from 'next-intl/server'
import QuizFlow from './QuizFlow'

export default async function QuizPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div className="min-h-svh bg-[#1a2f26] text-[#f4efe4]">
      <QuizFlow />
    </div>
  )
}
