'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Style, BudgetRange, Room, BudgetTier, ConfigState } from '@/types'

export default function ConfiguratorPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [config, setConfig] = useState<ConfigState>({
    room: null,
    width: '',
    length: '',
    styleId: null,
    budgetTier: null,
  })
  const [styles, setStyles] = useState<Style[]>([])
  const [budgetRanges, setBudgetRanges] = useState<BudgetRange[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (step === 2 && styles.length === 0) fetchStyles()
    if (step === 3 && config.room) fetchBudget()
  }, [step])

  async function fetchStyles() {
    setLoading(true)
    const { data } = await supabase.from('styles').select('*')
    if (data) setStyles(data)
    setLoading(false)
  }

  async function fetchBudget() {
    const { data } = await supabase
      .from('budget_ranges')
      .select('*')
      .eq('room', config.room)
    if (data) setBudgetRanges(data)
  }

  function canProceed() {
    if (step === 1) return config.room && config.width && config.length
    if (step === 2) return config.styleId !== null
    if (step === 3) return config.budgetTier !== null
  }

  function next() {
    if (step < 3) {
      setStep(s => s + 1)
    } else {
      const params = new URLSearchParams({
        room: config.room!,
        style: config.styleId!,
        budget: config.budgetTier!,
        width: config.width,
        length: config.length,
      })
      router.push(`/result?${params.toString()}`)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900 flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white">
        <span className="text-xl font-bold text-amber-600">roomia</span>
        <span className="text-sm text-zinc-500">Step {step} of 3</span>
      </div>

      {/* Progress */}
      <div className="w-full h-0.5 bg-zinc-200">
        <div
          className="h-0.5 bg-amber-400 transition-all duration-500"
          style={{ width: `${(step / 3) * 100}%` }}
        />
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {step === 1 && <StepRoom config={config} setConfig={setConfig} />}
        {step === 2 && <StepStyle config={config} setConfig={setConfig} styles={styles} loading={loading} />}
        {step === 3 && <StepBudget config={config} setConfig={setConfig} budgetRanges={budgetRanges} />}
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center px-6 py-5 border-t border-zinc-200 bg-white">
        <button
          onClick={() => setStep(s => s - 1)}
          className={step === 1 ? 'invisible' : 'text-sm text-zinc-500 hover:text-zinc-900 transition-colors'}
        >
          ← Back
        </button>
        <button
          onClick={next}
          disabled={!canProceed()}
          className="px-8 py-2.5 bg-amber-400 text-zinc-950 rounded-lg text-sm font-bold
                     disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-300 transition-all"
        >
          {step === 3 ? 'See My Design →' : 'Next →'}
        </button>
      </div>
    </div>
  )
}

// ── Step 1 — Room ────────────────────────────────────────────────────────────
function StepRoom({
  config,
  setConfig,
}: {
  config: ConfigState
  setConfig: React.Dispatch<React.SetStateAction<ConfigState>>
}) {
  return (
    <div className="w-full max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Which room are you designing?</h1>
        <p className="text-zinc-400 text-sm">We&apos;ll tailor everything to your space.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {(['Living Room', 'Bedroom'] as Room[]).map(room => (
          <button
            key={room}
            onClick={() => setConfig(c => ({ ...c, room }))}
            className={`p-6 rounded-xl border-2 text-left transition-all ${
              config.room === room
                ? 'border-amber-400 bg-amber-400/10'
                : 'border-zinc-200 hover:border-zinc-400 bg-white'
            }`}
          >
            <div className="text-2xl mb-2">{room === 'Living Room' ? '🛋️' : '🛏️'}</div>
            <div className="font-semibold text-sm">{room}</div>
          </button>
        ))}
      </div>

      {config.room && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Dimensions of your {config.room.toLowerCase()}
          </p>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Width (m)', key: 'width' },
              { label: 'Length (m)', key: 'length' },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="text-xs text-zinc-500 mb-1.5 block">{label}</label>
                <input
                  type="number"
                  placeholder="e.g. 4"
                  value={config[key as keyof ConfigState] as string}
                  onChange={e =>
                    setConfig(c => ({ ...c, [key]: e.target.value }))
                  }
                  className="w-full bg-white border border-zinc-200 rounded-lg px-4 py-2.5
                             text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500"
                />
              </div>
            ))}
          </div>
          {config.width && config.length && (
            <p className="text-xs text-amber-600">
              {(parseFloat(config.width) * parseFloat(config.length)).toFixed(1)} m²
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Step 2 — Style ───────────────────────────────────────────────────────────
function StepStyle({
  config,
  setConfig,
  styles,
  loading,
}: {
  config: ConfigState
  setConfig: React.Dispatch<React.SetStateAction<ConfigState>>
  styles: Style[]
  loading: boolean
}) {
  return (
    <div className="w-full max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Pick your style</h1>
        <p className="text-zinc-400 text-sm">This shapes everything — furniture, colors, atmosphere.</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-zinc-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {styles.map(style => (
            <button
              key={style.id}
              onClick={() => setConfig(c => ({ ...c, styleId: style.id }))}
              className={`w-full p-4 rounded-xl border-2 text-left flex items-center gap-4 transition-all ${
                config.styleId === style.id
                  ? 'border-amber-400 bg-amber-400/10'
                  : 'border-zinc-200 hover:border-zinc-400 bg-white'
              }`}
            >
              <div
                className="w-10 h-10 rounded-lg flex-shrink-0 border border-zinc-300"
                style={{ backgroundColor: style.main_color }}
              />
              <div className="flex-1">
                <div className="font-semibold text-sm">{style.name}</div>
                <div className="text-xs text-zinc-400 mt-0.5">{style.tagline}</div>
              </div>
              {config.styleId === style.id && (
                <span className="text-amber-600">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Step 3 — Budget ──────────────────────────────────────────────────────────
function StepBudget({
  config,
  setConfig,
  budgetRanges,
}: {
  config: ConfigState
  setConfig: React.Dispatch<React.SetStateAction<ConfigState>>
  budgetRanges: BudgetRange[]
}) {
  const range = budgetRanges[0]

  const tiers = [
    {
      id: 'tight' as BudgetTier,
      label: 'Tight',
      emoji: '💡',
      sub: 'Smart picks, real style',
      range: range?.tight ?? '—',
    },
    {
      id: 'comfortable' as BudgetTier,
      label: 'Comfortable',
      emoji: '✨',
      sub: 'Best balance of quality and price',
      range: range?.comfortable ?? '—',
    },
    {
      id: 'premium' as BudgetTier,
      label: 'Premium',
      emoji: '👑',
      sub: 'No compromises',
      range: range?.premium ?? '—',
    },
  ]

  return (
    <div className="w-full max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">What&apos;s your budget?</h1>
        <p className="text-zinc-400 text-sm">
          For your {config.room?.toLowerCase()} — {config.width}m × {config.length}m
        </p>
      </div>

      <div className="space-y-3">
        {tiers.map(tier => (
          <button
            key={tier.id}
            onClick={() => setConfig(c => ({ ...c, budgetTier: tier.id }))}
            className={`w-full p-5 rounded-xl border-2 text-left transition-all ${
              config.budgetTier === tier.id
                ? 'border-amber-400 bg-amber-400/10'
                : 'border-zinc-200 hover:border-zinc-400 bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">{tier.emoji}</span>
                <div>
                  <div className="font-semibold text-sm">{tier.label}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">{tier.sub}</div>
                </div>
              </div>
              <div className="text-sm font-medium text-amber-600 text-right flex-shrink-0">
                {tier.range}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
