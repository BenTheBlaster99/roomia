'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { STYLE_VISUALS, styleHero } from '@/lib/style-details'
import {
  composerHrefFromQuiz,
  QUIZ_QUESTIONS,
  scoreQuiz,
  type QuizAnswers,
  type QuizOption,
} from '@/lib/quiz'

export default function QuizFlow() {
  const t = useTranslations('quiz')
  const tHome = useTranslations('home')
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<QuizAnswers>({})

  const question = QUIZ_QUESTIONS[step]
  const done = step >= QUIZ_QUESTIONS.length
  const result = done ? scoreQuiz(answers) : null
  const hero = result ? styleHero(STYLE_VISUALS[result.primary]) : null
  const runnerHero = result?.runnerUp ? styleHero(STYLE_VISUALS[result.runnerUp]) : null

  function pick(option: QuizOption) {
    const nextAnswers = { ...answers, [question.id]: option.id }
    setAnswers(nextAnswers)
    setStep(current => current + 1)
  }

  function back() {
    if (step === 0) {
      router.back()
      return
    }
    setStep(current => current - 1)
  }

  function restart() {
    setAnswers({})
    setStep(0)
  }

  return (
    <section className="rm-quiz">
      <div className="rm-grain pointer-events-none absolute inset-0 opacity-30" />
      <div className="rm-page relative flex min-h-svh flex-col pb-[max(1.2rem,env(safe-area-inset-bottom))] pt-[max(0.7rem,env(safe-area-inset-top))]">
        <header className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center">
          <button
            type="button"
            onClick={back}
            className="flex h-10 w-10 items-center justify-center text-[#f4efe4]"
            aria-label={t('back')}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden>
              <path d="M15 5 8 12l7 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="rm-quiz-kicker">{t('title')}</h1>
          <span />
        </header>

        {result ? (
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-1 pt-6">
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-[#d4b483]">
              {t('resultEyebrow')}
            </p>
            <h2 className="rm-quiz-question">{t('resultTitle')}</h2>
            <p className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-[#f4efe4]/75">
              {t('resultSub')}
            </p>

            {hero ? (
              <div className="mt-6 overflow-hidden rounded-[1.4rem] bg-[#e7ddd1]">
                <img src={hero.src} alt="" className="aspect-[4/3] w-full object-cover" />
                <div className="px-5 py-4 text-[#1a2f26]">
                  <p className="font-[family-name:var(--font-display)] text-2xl font-bold">
                    {tHome(`styleName.${result.primary}`)}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed">{t(`styleBlurb.${result.primary}`)}</p>
                </div>
              </div>
            ) : null}

            {result.runnerUp && runnerHero ? (
              <p className="mt-4 text-center text-sm text-[#f4efe4]/70">
                {t('alsoClose')}{' '}
                <Link href={`/styles/${result.runnerUp}`} className="font-semibold text-[#f4efe4] underline">
                  {tHome(`styleName.${result.runnerUp}`)}
                </Link>
              </p>
            ) : null}

            <div className="mt-8 flex flex-col gap-3">
              <a href={composerHrefFromQuiz(result)} className="rm-quiz-card justify-center">
                <span className="rm-quiz-card-label text-center">{t('ctaComposer')}</span>
              </a>
              <Link href={`/styles/${result.primary}`} className="rm-quiz-card justify-center">
                <span className="rm-quiz-card-label text-center">{t('ctaStyles')}</span>
              </Link>
              <button type="button" onClick={restart} className="pt-1 text-sm font-semibold text-[#f4efe4]/70">
                {t('restart')}
              </button>
            </div>
          </div>
        ) : question ? (
          <>
            <div className="flex flex-1 flex-col">
              <h2 className="rm-quiz-question">{t(question.titleKey)}</h2>
              <div
                className={
                  question.layout === 'visual'
                    ? 'rm-quiz-visual mt-6'
                    : 'mt-7 flex flex-col gap-3.5'
                }
              >
                {question.options.map(option =>
                  question.layout === 'visual' ? (
                    <button
                      key={option.id}
                      type="button"
                      className="rm-quiz-visual-card"
                      onClick={() => pick(option)}
                    >
                      {option.image ? <img src={option.image} alt="" /> : null}
                      <span className="rm-quiz-visual-label">{t(`opt.${question.id}.${option.id}`)}</span>
                    </button>
                  ) : (
                    <button key={option.id} type="button" className="rm-quiz-card" onClick={() => pick(option)}>
                      <span className="rm-quiz-card-dot" />
                      <span className="rm-quiz-card-label">{t(`opt.${question.id}.${option.id}`)}</span>
                    </button>
                  ),
                )}
              </div>
            </div>
            <footer className="mt-auto pt-6">
              <div
                className="rm-quiz-dots"
                style={{ gridTemplateColumns: `repeat(${QUIZ_QUESTIONS.length}, minmax(0, 1fr))` }}
                aria-hidden
              >
                {QUIZ_QUESTIONS.map((_, index) => (
                  <span key={index} className={index <= step ? 'is-on' : undefined} />
                ))}
              </div>
              <p className="rm-quiz-count">
                {t('stepOf', { current: step + 1, total: QUIZ_QUESTIONS.length })}
              </p>
            </footer>
          </>
        ) : null}
      </div>
    </section>
  )
}
