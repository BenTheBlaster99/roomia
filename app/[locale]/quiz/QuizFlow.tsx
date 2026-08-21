'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { StyleId } from '@/lib/style-details'

const TOTAL_STEPS = 6

type DensityAnswer = 'empty' | 'chosen' | 'rich'

const DENSITY_TO_STYLE: Record<DensityAnswer, StyleId> = {
  empty: 'minimalism',
  chosen: 'japandi',
  rich: 'maximalism',
}

function IconBranch() {
  return (
    <svg viewBox="0 0 32 32" className="h-[1.65rem] w-[1.65rem]" fill="none" aria-hidden>
      <path d="M16 27V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M16 11c3-3 7-3.5 9-2M16 15c-3-2.6-7-3-9-1.6M16 18c3.2-2.4 7.2-2.2 9.2-.6M16 22c-3.1-2-6.8-2.1-8.8-.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M22 8.5c.2 1.4-.4 2.6-1.5 3.2M9.8 13c.6 1.3 1.7 2 3 2.1M23.4 16.2c.1 1.4-.7 2.6-1.9 3M9.6 20.3c.7 1.2 1.9 1.8 3.2 1.7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconVase() {
  return (
    <svg viewBox="0 0 32 32" className="h-[1.65rem] w-[1.65rem]" fill="none" aria-hidden>
      <path d="M16 6.5v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 8.5c2.2-1.8 4.8-1.6 6 .2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M12.2 14.2h7.6c.4 1.8.3 3.3-.4 4.8-.9 2.1-2.2 4.6-3.4 6.5-.3.5-.9.8-1.5.8s-1.2-.3-1.5-.8c-1.2-1.9-2.5-4.4-3.4-6.5-.7-1.5-.8-3-.4-4.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChair() {
  return (
    <svg viewBox="0 0 32 32" className="h-[1.65rem] w-[1.65rem]" fill="none" aria-hidden>
      <path
        d="M8.5 14.5c0-3.4 3.2-6 7.5-6s7.5 2.6 7.5 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M8.5 14.5h15v4.2a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V14.5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 20.7V26M21 20.7V26M9.5 26h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export default function QuizFlow() {
  const t = useTranslations('quiz')
  const tHome = useTranslations('home')
  const router = useRouter()
  const [picked, setPicked] = useState<DensityAnswer | null>(null)

  const styleId = picked ? DENSITY_TO_STYLE[picked] : null

  return (
    <section className="rm-quiz">
      <div className="rm-grain pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative flex min-h-svh flex-col px-5 pb-[max(1.2rem,env(safe-area-inset-bottom))] pt-[max(0.7rem,env(safe-area-inset-top))]">
        <header className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center">
          <button
            type="button"
            onClick={() => (picked ? setPicked(null) : router.back())}
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

        {styleId ? (
          <div className="flex flex-1 flex-col items-center px-2 pt-8 text-center">
            <h2 className="rm-quiz-question">{t('resultTitle')}</h2>
            <p className="mt-3 max-w-sm text-sm text-[#f4efe4]/75">{t('resultDraft')}</p>
            <p className="rm-quiz-kicker mt-10">{tHome(`styleName.${styleId}`)}</p>
            <div className="mt-8 flex w-full max-w-sm flex-col gap-3">
              <Link href={`/styles/${styleId}`} className="rm-quiz-card justify-center">
                <span className="rm-quiz-card-label text-center">{t('ctaStyles')}</span>
              </Link>
              <button type="button" onClick={() => setPicked(null)} className="pt-2 text-sm font-semibold text-[#f4efe4]/70">
                {t('restart')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <Question
              title={t('q1Title')}
              options={[
                { id: 'empty', label: t('q1Empty'), icon: <IconBranch /> },
                { id: 'chosen', label: t('q1Chosen'), icon: <IconVase /> },
                { id: 'rich', label: t('q1Rich'), icon: <IconChair /> },
              ]}
              onPick={id => setPicked(id as DensityAnswer)}
            />
            <footer className="mt-auto pt-6">
              <div className="rm-quiz-dots" aria-hidden>
                {Array.from({ length: TOTAL_STEPS }, (_, index) => (
                  <span key={index} className={index === 0 ? 'is-on' : undefined} />
                ))}
              </div>
              <p className="rm-quiz-count">1 / {TOTAL_STEPS}</p>
            </footer>
          </>
        )}
      </div>
    </section>
  )
}

function Question({
  title,
  options,
  onPick,
}: {
  title: string
  options: { id: string; label: string; icon?: ReactNode }[]
  onPick: (id: string) => void
}) {
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="rm-quiz-question">{title}</h2>
      <div className="mt-7 flex flex-col gap-3.5">
        {options.map(option => (
          <button key={option.id} type="button" className="rm-quiz-card" onClick={() => onPick(option.id)}>
            <span className="rm-quiz-card-icon">{option.icon}</span>
            <span className="rm-quiz-card-label">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
