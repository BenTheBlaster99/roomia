'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { STYLE_CARD_COLORS, STYLE_NAMES, STYLE_SLUG, type StyleName } from '@/lib/style-room-presentation'

type RoomAnswer = 'living' | 'bedroom'
type BudgetAnswer = 'tight' | 'mid' | 'premium'
type VibeAnswer =
  | 'industrial'
  | 'maximalism'
  | 'minimalism'
  | 'traditional_algerian'
  | 'mediterranean_coastal'

const VIBE_TO_STYLE: Record<VibeAnswer, StyleName> = {
  industrial: 'Industrial',
  maximalism: 'Maximalism',
  minimalism: 'Minimalism',
  traditional_algerian: 'Traditional Algerian',
  mediterranean_coastal: 'Mediterranean Coastal',
}

const ROOM_TO_PARAM: Record<RoomAnswer, string> = {
  living: 'Living Room',
  bedroom: 'Bedroom',
}

function recommendStyle(vibe: VibeAnswer, budget: BudgetAnswer): StyleName {
  // Vibe is primary; budget only nudges edge cases toward softer or bolder options.
  let style = VIBE_TO_STYLE[vibe]
  if (budget === 'tight' && vibe === 'maximalism') style = 'Mediterranean Coastal'
  if (budget === 'premium' && vibe === 'minimalism') style = 'Maximalism'
  if (!STYLE_NAMES.includes(style)) style = 'Minimalism'
  return style
}

export default function QuizFlow() {
  const t = useTranslations('quiz')
  const [step, setStep] = useState(0)
  const [room, setRoom] = useState<RoomAnswer | null>(null)
  const [budget, setBudget] = useState<BudgetAnswer | null>(null)
  const [vibe, setVibe] = useState<VibeAnswer | null>(null)

  const result = useMemo(() => {
    if (!room || !budget || !vibe) return null
    const styleName = recommendStyle(vibe, budget)
    const slug = STYLE_SLUG[styleName]
    return { styleName, slug, room }
  }, [room, budget, vibe])

  const totalSteps = 3
  const progress = Math.min(100, ((step + (result ? 1 : 0)) / (totalSteps + 1)) * 100)

  function pickRoom(value: RoomAnswer) {
    setRoom(value)
    setStep(1)
  }

  function pickBudget(value: BudgetAnswer) {
    setBudget(value)
    setStep(2)
  }

  function pickVibe(value: VibeAnswer) {
    setVibe(value)
    setStep(3)
  }

  function restart() {
    setRoom(null)
    setBudget(null)
    setVibe(null)
    setStep(0)
  }

  const colors = result ? STYLE_CARD_COLORS[result.slug] : null
  const studioHref = result
    ? `/studio?create=1&style=${encodeURIComponent(result.slug)}&room=${encodeURIComponent(ROOM_TO_PARAM[result.room])}`
    : '/studio?create=1'

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 h-1 overflow-hidden rounded-full bg-[var(--rm-secondary)]">
        <div
          className="h-full rounded-full bg-[var(--rm-primary)] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {step === 0 && (
        <Question
          eyebrow={t('stepOf', { current: 1, total: totalSteps })}
          title={t('roomTitle')}
          options={[
            { id: 'living', label: t('roomLiving') },
            { id: 'bedroom', label: t('roomBedroom') },
          ]}
          onPick={id => pickRoom(id as RoomAnswer)}
        />
      )}

      {step === 1 && (
        <Question
          eyebrow={t('stepOf', { current: 2, total: totalSteps })}
          title={t('budgetTitle')}
          hint={t('budgetHint')}
          options={[
            { id: 'tight', label: t('budgetTight') },
            { id: 'mid', label: t('budgetMid') },
            { id: 'premium', label: t('budgetPremium') },
          ]}
          onPick={id => pickBudget(id as BudgetAnswer)}
          onBack={() => setStep(0)}
          backLabel={t('back')}
        />
      )}

      {step === 2 && (
        <Question
          eyebrow={t('stepOf', { current: 3, total: totalSteps })}
          title={t('vibeTitle')}
          options={[
            { id: 'industrial', label: t('vibeIndustrial') },
            { id: 'maximalism', label: t('vibeMaximalism') },
            { id: 'minimalism', label: t('vibeMinimalism') },
            { id: 'traditional_algerian', label: t('vibeTraditional') },
            { id: 'mediterranean_coastal', label: t('vibeCoastal') },
          ]}
          onPick={id => pickVibe(id as VibeAnswer)}
          onBack={() => setStep(1)}
          backLabel={t('back')}
        />
      )}

      {step === 3 && result && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('resultEyebrow')}
          </p>
          <h2 className="rm-display mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            {t('resultTitle')}
          </h2>
          <p className="mt-3 text-[var(--rm-muted)]">{t('resultSub')}</p>

          <div
            className="mt-8 overflow-hidden rm-panel"
            style={
              colors
                ? {
                    borderColor: `${colors.accent}55`,
                  }
                : undefined
            }
          >
            <div
              className="h-28"
              style={{
                background: colors
                  ? `linear-gradient(135deg, ${colors.main}, ${colors.accent})`
                  : 'var(--rm-secondary)',
              }}
            />
            <div className="p-6">
              <p className="rm-display text-2xl font-bold">{result.styleName}</p>
              <p className="mt-2 text-sm text-[var(--rm-muted)]">
                {t(`styleBlurb.${result.slug}` as 'styleBlurb.minimalism')}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={`/styles#${result.slug}`} className="rm-btn-primary text-sm">
                  {t('ctaStyles')}
                </Link>
                <a href={studioHref} className="rm-btn-secondary text-sm">
                  {t('ctaStudio')}
                </a>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={restart}
            className="mt-6 text-sm font-semibold text-[var(--rm-primary)] hover:underline"
          >
            {t('restart')}
          </button>
        </div>
      )}
    </div>
  )
}

function Question({
  eyebrow,
  title,
  hint,
  options,
  onPick,
  onBack,
  backLabel,
}: {
  eyebrow: string
  title: string
  hint?: string
  options: { id: string; label: string }[]
  onPick: (id: string) => void
  onBack?: () => void
  backLabel?: string
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
        {eyebrow}
      </p>
      <h2 className="rm-display mt-3 text-3xl font-bold tracking-tight md:text-4xl">{title}</h2>
      {hint && <p className="mt-3 text-sm text-[var(--rm-muted)]">{hint}</p>}

      <div className="mt-8 grid gap-3">
        {options.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onPick(opt.id)}
            className="rm-panel px-5 py-4 text-left text-sm font-semibold transition-transform hover:-translate-y-0.5 hover:border-[var(--rm-primary)]/35"
          >
            {opt.label}
          </button>
        ))}
      </div>

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-6 text-sm font-semibold text-[var(--rm-muted)] hover:text-[var(--rm-primary)]"
        >
          ← {backLabel}
        </button>
      )}
    </div>
  )
}
