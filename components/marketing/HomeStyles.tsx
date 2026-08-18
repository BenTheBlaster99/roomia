'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { FEATURED_STYLE_IDS, StyleChip } from './StyleChip'

export default function HomeStyles() {
  const t = useTranslations('home')

  return (
    <section className="bg-[var(--rm-bg)] px-6 py-20 md:px-10 md:py-24">
      <div className="mx-auto max-w-[92rem]">
        <h2 className="rm-display text-center text-4xl font-bold tracking-tight text-[var(--rm-ink)] md:text-5xl lg:text-6xl">
          {t('stylesDiscover')}
        </h2>
        <p className="mt-10 text-sm font-medium text-[var(--rm-muted)] md:text-base">
          {t('stylesExplained')}
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-3 md:gap-5">
          {FEATURED_STYLE_IDS.map(id => (
            <StyleChip key={id} id={id} label={t(`styleName.${id}`)} />
          ))}
        </div>
        <div className="mt-8 flex justify-center">
          <Link href="/styles" className="rm-btn-primary px-8 py-3">
            {t('stylesSeeMore')}
          </Link>
        </div>
        <p className="mx-auto mt-16 max-w-xl text-center text-sm leading-relaxed text-[var(--rm-muted)] md:text-base">
          {t.rich('stylesQuizHint', {
            quiz: chunks => <em className="not-italic font-semibold tracking-wide">{chunks}</em>,
          })}
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/quiz" className="rm-btn-accent px-10 py-3.5 text-base">
            {t('stylesTakeQuiz')}
          </Link>
        </div>
      </div>
    </section>
  )
}
