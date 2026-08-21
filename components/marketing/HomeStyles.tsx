'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { FEATURED_STYLE_IDS, StyleChip } from './StyleChip'

export default function HomeStyles() {
  const t = useTranslations('home')

  return (
    <section className="flex h-full min-h-0 flex-col justify-center px-5 pb-12 md:px-10 lg:pb-8">
      <div className="mx-auto w-full max-w-[92rem]">
        <h2 className="rm-display text-left text-[1.85rem] font-bold tracking-tight text-[var(--rm-ink)] md:text-5xl lg:text-center lg:text-6xl">
          {t('stylesDiscover')}
        </h2>
        <p className="mt-6 text-sm font-medium text-[var(--rm-muted)] md:mt-10 md:text-base">
          {t('stylesExplained')}
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3 md:gap-5">
          {FEATURED_STYLE_IDS.map(id => (
            <StyleChip key={id} id={id} label={t(`styleName.${id}`)} />
          ))}
        </div>
        <div className="mt-8 flex justify-center">
          <Link href="/styles" className="rm-btn-primary w-full px-8 py-3 lg:w-auto">
            {t('stylesSeeMore')}
          </Link>
        </div>
        <p className="mx-auto mt-10 hidden max-w-xl text-center text-sm leading-relaxed text-[var(--rm-muted)] lg:block md:mt-14 md:text-base">
          {t.rich('stylesQuizHint', {
            quiz: chunks => <em className="not-italic font-semibold tracking-wide">{chunks}</em>,
          })}
        </p>
        <div className="mt-6 hidden justify-center lg:flex">
          <Link href="/quiz" className="rm-btn-accent px-10 py-3.5 text-base">
            {t('stylesTakeQuiz')}
          </Link>
        </div>
        <Link href="/quiz" className="rm-home-quiz lg:hidden">
          <span className="rm-home-quiz-mark">Quiz</span>
          <span className="rm-home-quiz-title">{t('quizTeaserTitle')}</span>
          <span className="rm-home-quiz-row">
            {t('quizTeaserBody')}
            <span aria-hidden>→</span>
          </span>
        </Link>
      </div>
    </section>
  )
}
