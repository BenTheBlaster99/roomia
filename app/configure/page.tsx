'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import RoomScanner from '@/components/RoomScanner'
import { DEFAULT_HEIGHT } from '@/lib/design-params'
import type { ConfigState } from '@/types'

export default function ConfiguratorPage() {
  const router = useRouter()
  const [config, setConfig] = useState<ConfigState>({
    room: null,
    width: '',
    length: '',
    height: DEFAULT_HEIGHT,
    styleId: null,
    budgetTier: null,
  })

  function canProceed() {
    const w = parseFloat(config.width)
    const l = parseFloat(config.length)
    const h = parseFloat(config.height)
    return Number.isFinite(w) && w >= 1 && Number.isFinite(l) && l >= 1 && Number.isFinite(h) && h >= 2
  }

  function openStudio() {
    if (!canProceed()) return

    const params = new URLSearchParams({
      create: '1',
      width: config.width,
      length: config.length,
      height: config.height,
    })
    router.push(`/studio?${params.toString()}`)
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--rm-bg)] text-[var(--rm-text)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-between border-b border-[var(--rm-text)]/10 bg-[var(--rm-surface)] px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--rm-primary)]"
        >
          roomia
        </Link>
        <Link href="/studio" className="text-sm text-[var(--rm-muted)] hover:text-[var(--rm-primary)]">
          Skip to studio →
        </Link>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-lg space-y-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">
              Étape unique
            </p>
            <h1 className="rm-display mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Définissez votre pièce
            </h1>
            <p className="mt-2 text-sm text-[var(--rm-muted)]">
              Entrez largeur, longueur et hauteur — ou scannez un plan. Ensuite le studio 3D
              s&apos;ouvre avec ces dimensions. Pas d&apos;autre étape obligatoire.
            </p>
          </div>

          <div className="space-y-4 rounded-[1.25rem] border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-5">
            <p className="text-sm font-medium text-[var(--rm-text)]">Dimensions (mètres)</p>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Largeur (m)', key: 'width', placeholder: 'ex. 4' },
                { label: 'Longueur (m)', key: 'length', placeholder: 'ex. 5' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="mb-1.5 block text-xs text-[var(--rm-muted)]">{label}</label>
                  <input
                    type="number"
                    min="1"
                    step="0.1"
                    placeholder={placeholder}
                    value={config[key as keyof ConfigState] as string}
                    onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-4 py-2.5 text-[var(--rm-text)] placeholder:text-[var(--rm-muted)] focus:border-[var(--rm-primary)] focus:outline-none"
                  />
                </div>
              ))}
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-[var(--rm-muted)]">
                Hauteur sous plafond (m)
              </label>
              <input
                type="number"
                min="2"
                step="0.1"
                placeholder="ex. 2.8"
                value={config.height}
                onChange={e => setConfig(c => ({ ...c, height: e.target.value }))}
                className="w-full rounded-lg border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-4 py-2.5 text-[var(--rm-text)] placeholder:text-[var(--rm-muted)] focus:border-[var(--rm-primary)] focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-[var(--rm-muted)]">
                Appartements algériens typiques : 2,7–2,8 m.
              </p>
            </div>

            {canProceed() && (
              <p className="text-xs text-[var(--rm-primary)]">
                Surface :{' '}
                {(parseFloat(config.width) * parseFloat(config.length)).toFixed(1)} m² · volume
                utile prêt pour le studio
              </p>
            )}
          </div>

          <div className="rounded-[1.25rem] border border-dashed border-[var(--rm-text)]/15 bg-[var(--rm-surface)]/60 p-5">
            <p className="text-sm font-medium">Optionnel — scanner un plan</p>
            <p className="mt-1 text-xs text-[var(--rm-muted)]">
              Si le scan est flou, gardez les chiffres manuels ci-dessus. Le studio n&apos;a besoin
              que de W × L × H fiables.
            </p>
            <div className="mt-4">
              <RoomScanner
                width={config.width}
                length={config.length}
                height={config.height}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end border-t border-[var(--rm-text)]/10 bg-[var(--rm-surface)] px-4 py-4 sm:px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={openStudio}
          disabled={!canProceed()}
          className="rm-btn-primary w-full px-8 py-3 text-sm sm:w-auto disabled:cursor-not-allowed disabled:opacity-30"
        >
          Ouvrir le studio 3D →
        </button>
      </div>
    </div>
  )
}
