'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { isStyleId } from '@/lib/style-details'
import {
  composerHrefFromQuiz,
  QUIZ_QUESTIONS,
  quizStyleHero,
  scoreQuiz,
  type QuizAnswers,
  type QuizOption,
  type QuizQuestion,
} from '@/lib/quiz'

function pickedIds(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export default function QuizFlow() {
  const t = useTranslations('quiz')
  const tHome = useTranslations('home')
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<QuizAnswers>({})
  const advancing = useRef(false)

  const question = QUIZ_QUESTIONS[step]
  const done = step >= QUIZ_QUESTIONS.length
  const result = done ? scoreQuiz(answers) : null
  const hero = result ? quizStyleHero(result.primary) : undefined
  const runnerHero = result?.runnerUp ? quizStyleHero(result.runnerUp) : undefined
  const selected = question ? pickedIds(answers[question.id]) : []
  const maxSelect = question?.maxSelect ?? 1

  function setPicked(questionId: string, ids: string[]) {
    setAnswers(current => ({ ...current, [questionId]: maxSelect > 1 ? ids : ids[0] ?? '' }))
  }

  function pick(option: QuizOption) {
    if (!question || advancing.current) return
    if (maxSelect > 1) {
      const already = selected.includes(option.id)
      const next = already
        ? selected.filter(id => id !== option.id)
        : selected.length >= maxSelect
          ? selected
          : [...selected, option.id]
      setPicked(question.id, next)
      return
    }
    advancing.current = true
    setPicked(question.id, [option.id])
    window.setTimeout(() => {
      advancing.current = false
      setStep(current => current + 1)
    }, 280)
  }

  function nextMulti() {
    if (selected.length === 0) return
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

  function optionLabel(current: QuizQuestion, option: QuizOption) {
    return t(`opt.${current.id}.${option.id}`)
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
                <img src={hero} alt="" className="aspect-[4/3] w-full object-cover" />
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
                {isStyleId(result.runnerUp) ? (
                  <Link href={`/styles/${result.runnerUp}`} className="font-semibold text-[#f4efe4] underline">
                    {tHome(`styleName.${result.runnerUp}`)}
                  </Link>
                ) : (
                  <span className="font-semibold text-[#f4efe4]">{tHome(`styleName.${result.runnerUp}`)}</span>
                )}
              </p>
            ) : null}

            <div className="mt-8 flex flex-col gap-3">
              <a href={composerHrefFromQuiz(result)} className="rm-quiz-card justify-center">
                <span className="rm-quiz-card-label text-center">{t('ctaComposer')}</span>
              </a>
              {isStyleId(result.primary) ? (
                <Link href={`/styles/${result.primary}`} className="rm-quiz-card justify-center">
                  <span className="rm-quiz-card-label text-center">{t('ctaStyles')}</span>
                </Link>
              ) : null}
              <button type="button" onClick={restart} className="rm-quiz-restart">
                {t('restart')}
              </button>
            </div>
          </div>
        ) : question ? (
          <>
            <div className="rm-quiz-stage">
              <h2 className="rm-quiz-question">{t(question.titleKey)}</h2>
              {question.hintKey ? <p className="rm-quiz-hint">{t(question.hintKey)}</p> : null}
              <div
                className={
                  question.layout === 'visual'
                    ? question.options.length === 3
                      ? 'rm-quiz-visual rm-quiz-visual-3'
                      : 'rm-quiz-visual'
                    : 'rm-quiz-list'
                }
              >
                {question.options.map(option => {
                  const on = selected.includes(option.id)
                  return question.layout === 'visual' ? (
                    <button
                      key={option.id}
                      type="button"
                      className={on ? 'rm-quiz-visual-card is-on' : 'rm-quiz-visual-card'}
                      onClick={() => pick(option)}
                    >
                      {option.image ? <img src={option.image} alt="" /> : null}
                      {on ? <span className="rm-quiz-check" aria-hidden>✓</span> : null}
                      {option.swatches ? (
                        <span className="rm-quiz-swatches">
                          {option.swatches.map(hex => (
                            <i key={hex} style={{ background: hex }} />
                          ))}
                        </span>
                      ) : null}
                      <span className="rm-quiz-visual-label">{optionLabel(question, option)}</span>
                    </button>
                  ) : (
                    <button
                      key={option.id}
                      type="button"
                      className={on ? 'rm-quiz-card is-on' : 'rm-quiz-card'}
                      onClick={() => pick(option)}
                    >
                      <span className={on ? 'rm-quiz-card-dot is-on' : 'rm-quiz-card-dot'}>
                        {on ? '✓' : ''}
                      </span>
                      <span className="rm-quiz-card-label">{optionLabel(question, option)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <footer className="rm-quiz-footer">
              {maxSelect > 1 ? (
                <button
                  type="button"
                  className="rm-quiz-next"
                  disabled={selected.length === 0}
                  onClick={nextMulti}
                >
                  {t('continue')}
                </button>
              ) : null}
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
