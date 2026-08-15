'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'
import { useStudioStore } from '@/store/useStudioStore'
import type { RoomPresetRow } from '@/types/room-preset'

type PresetRow = Pick<
  RoomPresetRow,
  'id' | 'name' | 'room_type' | 'style_id' | 'budget_tier' | 'room_config'
>

/** French-first gate copy (studio tools are pre-i18n phase). */
const COPY = {
  title: 'Comment voulez-vous commencer ?',
  sub: 'Choisissez un preset curaté, ou créez votre propre pièce.',
  create: 'Créer le vôtre',
  createHint: 'Pièce vide prête à meubler',
  floorPlan: 'Scanner un plan',
  presets: 'Presets prêts à personnaliser',
  loading: 'Chargement des presets…',
  open: 'Ouvrir',
}

export default function StudioEntryGate({
  skipGate = false,
  onEnterBlank,
}: {
  skipGate?: boolean
  onEnterBlank: () => void
}) {
  const searchParams = useSearchParams()
  const [presets, setPresets] = useState<PresetRow[] | null>(null)

  const shouldSkip =
    skipGate ||
    Boolean(searchParams.get('preset')) ||
    searchParams.get('create') === '1' ||
    Boolean(searchParams.get('width')) ||
    Boolean(searchParams.get('length'))

  const [dismissed, setDismissed] = useState(shouldSkip)

  // Sync gate visibility immediately (avoid TopBar/dims chrome flashing under the gate)
  useEffect(() => {
    useStudioStore.getState().setEntryGateOpen(!dismissed)
    return () => {
      useStudioStore.getState().setEntryGateOpen(false)
    }
  }, [dismissed])

  useEffect(() => {
    if (dismissed) return
    let cancelled = false
    supabase
      .from('room_presets')
      .select('id, name, room_type, style_id, budget_tier, room_config')
      .order('style_id')
      .then(({ data }) => {
        if (!cancelled) setPresets((data as PresetRow[]) ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [dismissed])

  if (dismissed) return null

  return (
    <div className="absolute inset-0 z-[100] overflow-y-auto bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <div className="mx-auto max-w-5xl px-5 py-10 md:px-8">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--rm-primary)]"
        >
          roomia
        </Link>

        <h1 className="rm-display mt-8 text-3xl font-bold tracking-tight md:text-5xl">
          {COPY.title}
        </h1>
        <p className="mt-3 max-w-xl text-[var(--rm-muted)]">{COPY.sub}</p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setDismissed(true)
              useStudioStore.getState().setEntryGateOpen(false)
              onEnterBlank()
              const url = new URL(window.location.href)
              url.searchParams.set('create', '1')
              // Drop dimension query noise from configure redirect
              url.searchParams.delete('width')
              url.searchParams.delete('length')
              url.searchParams.delete('height')
              window.history.replaceState({}, '', url.toString())
            }}
            className="rm-panel p-6 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="rm-display text-xl font-bold">{COPY.create}</div>
            <p className="mt-2 text-sm text-[var(--rm-muted)]">{COPY.createHint}</p>
          </button>

          <Link
            href="/configure"
            className="rm-panel p-6 transition-transform hover:-translate-y-0.5"
          >
            <div className="rm-display text-xl font-bold">{COPY.floorPlan}</div>
            <p className="mt-2 text-sm text-[var(--rm-muted)]">
              Entrez les dimensions ou scannez un plan — puis ouvrez le studio
            </p>
          </Link>
        </div>

        <h2 className="rm-display mt-14 text-xl font-bold">{COPY.presets}</h2>
        <p className="mt-2 text-sm text-[var(--rm-muted)]">
          Pièces curatées — pas de mesures à saisir ici.
        </p>

        {presets === null ? (
          <p className="mt-4 text-sm text-[var(--rm-muted)]">{COPY.loading}</p>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {presets.map(preset => {
              const colors = STYLE_CARD_COLORS[preset.style_id ?? ''] ?? {
                main: '#E8E4E0',
                accent: '#9CA3AF',
              }
              const wall = preset.room_config?.wallColor ?? colors.main
              return (
                <a
                  key={preset.id}
                  href={`/studio?preset=${preset.id}`}
                  className="group rm-panel overflow-hidden transition-transform hover:-translate-y-0.5"
                >
                  <div
                    className="aspect-[4/3]"
                    style={{
                      background: `linear-gradient(145deg, ${wall} 0%, ${colors.accent}88 100%)`,
                    }}
                  />
                  <div className="p-4">
                    <div className="text-sm font-bold group-hover:text-[var(--rm-primary)]">
                      {preset.name}
                    </div>
                    <div className="mt-1 text-xs capitalize text-[var(--rm-muted)]">
                      {preset.room_type?.replace(/_/g, ' ')} · {COPY.open} →
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
