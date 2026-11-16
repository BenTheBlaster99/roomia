'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { loadStudioDesign, type SavedStudioDesign } from '@/lib/studio-design-storage'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'
import { useStudioStore } from '@/store/useStudioStore'
import type { RoomPresetRow } from '@/types/room-preset'
import StudioRoomImport from './StudioRoomImport'
import DesktopNav from './DesktopNav'
import Icon from './Icon'
import { FURNITURE_TOOLS } from '../studio-flags'

type PresetRow = Pick<
  RoomPresetRow,
  'id' | 'name' | 'room_type' | 'style_id' | 'budget_tier' | 'room_config'
>

/** French-first gate copy (studio tools are pre-i18n phase). */
const COPY = {
  title: 'Comment voulez-vous commencer ?',
  sub: 'Importez votre projet pour obtenir plans, photos et visite 360°, ou partez d’un preset ou d’une pièce vide.',
  create: 'Pièce vide',
  createHint: 'Partez d’une pièce vide prête à meubler',
  importSketch: 'Importer une pièce SketchUp',
  importOutputs: ['Visite 360° plein jour', 'Plan 2D coté et plan 3D', 'Photos IA jour, soirée ou nuit', 'Vidéo'],
  importHint:
    'Format conseillé : GLB, exporté depuis SketchUp (un seul fichier, textures incluses, bien plus léger). Un export COLLADA (.dae) fonctionne aussi, mais seulement s’il fait moins de 450 Mo ; ajoutez le .skp dans un zip pour récupérer les textures.',
  resume: 'Reprendre',
  resumeHint: 'Dernière sauvegarde dans ce navigateur',
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
  const [saved, setSaved] = useState<SavedStudioDesign | null>(null)

  const shouldSkip =
    skipGate ||
    Boolean(searchParams.get('preset')) ||
    searchParams.get('create') === '1' ||
    searchParams.get('saved') === '1' ||
    Boolean(searchParams.get('scene')) ||
    Boolean(searchParams.get('width')) ||
    Boolean(searchParams.get('length'))

  const [dismissed, setDismissed] = useState(shouldSkip)

  useEffect(() => {
    // the browser's saved design exists only after the first paint (the server cannot read it)
    queueMicrotask(() => setSaved(loadStudioDesign()))
  }, [])

  // Sync gate visibility immediately (avoid TopBar/dims chrome flashing under the gate)
  useEffect(() => {
    useStudioStore.getState().setEntryGateOpen(!dismissed)
    return () => {
      useStudioStore.getState().setEntryGateOpen(false)
    }
  }, [dismissed])

  useEffect(() => {
    if (dismissed || !FURNITURE_TOOLS) return
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

  const enterImported = () => {
    setDismissed(true)
    useStudioStore.getState().setEntryGateOpen(false)
    onEnterBlank()
    const url = new URL(window.location.href)
    url.searchParams.set('create', '1')
    url.searchParams.delete('saved')
    url.searchParams.delete('width')
    url.searchParams.delete('length')
    url.searchParams.delete('height')
    window.history.replaceState({}, '', url.toString())
  }

  // 16 Nov redesign: a new project is the architect's SketchUp model, by the extension or as a file; the furniture-room
  // starts (empty room, plan scan, presets) only with FURNITURE_TOOLS
  if (!FURNITURE_TOOLS)
    return (
      <div className="absolute inset-0 z-[100] overflow-y-auto bg-[var(--brand-paper)]">
        <DesktopNav />
        <main className="mx-auto max-w-5xl px-5 pb-16 pt-12 sm:px-8">
          <h1 className="ui-title text-[34px]">
            Nouveau <em>projet</em>
          </h1>
          <p className="mt-2 max-w-2xl text-[16px] text-[var(--brand-ink-soft)]">
            Votre modèle SketchUp devient une visite 360°, des photos réalistes, un plan 2D coté, un plan 3D et une vidéo. Vous n’avez rien à régler.
          </p>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <section className="ui-card flex flex-col p-7">
              <span className="ui-chip ui-chip--gold mb-4 self-start">Conseillé</span>
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-blue)] text-white">
                <Icon name="sketchup" size={23} />
              </span>
              <h2 className="text-[20px] font-bold text-[var(--brand-ink)]">Depuis SketchUp</h2>
              <ol className="mt-3 grid gap-2 text-[14.5px] leading-relaxed text-[var(--brand-ink-soft)]">
                <li>1. Enregistrez vos vues : Fenêtre → Scènes → +.</li>
                <li>
                  2. Menu <b>Extensions → Roomia → Envoyer à Roomia</b>.
                </li>
                <li>3. Le projet s’ouvre ici, avec vos vues.</li>
              </ol>
              <div className="mt-auto pt-6">
                <button type="button" className="ui-btn ui-btn--ghost" onClick={() => void window.roomiaDesktop?.installSketchup?.()}>
                  <Icon name="sketchup" size={17} />
                  Installer l’extension SketchUp
                </button>
              </div>
            </section>
            <section className="ui-card flex flex-col p-7">
              <span className="mb-4 mt-[42px] flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-blue-tint)] text-[var(--brand-blue)]">
                <Icon name="folder" size={23} />
              </span>
              <h2 className="text-[20px] font-bold text-[var(--brand-ink)]">Ouvrir un fichier 3D</h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--brand-ink-soft)]">
                Un export <b>.glb</b> de SketchUp (un seul fichier, textures comprises, le plus léger). Un <b>.dae</b> marche aussi jusqu’à 450 Mo ; mettez le .skp
                dans un .zip avec lui pour garder les textures.
              </p>
              <div className="mt-auto pt-6">
                <StudioRoomImport className="ui-btn ui-btn--primary" label="Choisir un fichier 3D" onImported={enterImported} />
              </div>
            </section>
          </div>
        </main>
      </div>
    )

  return (
    <div className="absolute inset-0 z-[100] overflow-y-auto bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <div className="rm-page py-10">
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
          {saved && (
            <button
              type="button"
              onClick={() => {
                useStudioStore.getState().loadSavedDesign(saved)
                setDismissed(true)
                useStudioStore.getState().setEntryGateOpen(false)
                const url = new URL(window.location.href)
                url.searchParams.set('saved', '1')
                url.searchParams.delete('create')
                url.searchParams.delete('fresh')
                url.searchParams.delete('width')
                url.searchParams.delete('length')
                url.searchParams.delete('height')
                window.history.replaceState({}, '', url.toString())
              }}
              className="rm-panel p-6 text-left transition-transform hover:-translate-y-0.5 sm:col-span-2"
            >
              <div className="rm-display text-xl font-bold">{COPY.resume}</div>
              <p className="mt-2 text-sm text-[var(--rm-muted)]">{COPY.resumeHint}</p>
              <p className="mt-3 text-xs text-[var(--rm-muted)]">
                {saved.items.length} meuble{saved.items.length === 1 ? '' : 's'} ·{' '}
                {new Date(saved.savedAt).toLocaleString('fr-DZ', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </button>
          )}

          <div className="rm-panel p-8 text-left sm:col-span-2 border-2 border-[var(--rm-primary)]">
            <div className="rm-display text-2xl font-bold">{COPY.importSketch}</div>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[var(--rm-primary)]">
              {COPY.importOutputs.map(o => (
                <li key={o} className="rounded-full border border-[var(--rm-primary)] px-3 py-1">
                  {o}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-[var(--rm-muted)]">{COPY.importHint}</p>
            <StudioRoomImport
              className="rm-btn-primary mt-5 px-5 py-2.5 text-sm"
              label="Choisir un fichier 3D"
              onImported={() => {
                setDismissed(true)
                useStudioStore.getState().setEntryGateOpen(false)
                onEnterBlank()
                const url = new URL(window.location.href)
                url.searchParams.set('create', '1')
                url.searchParams.delete('saved')
                url.searchParams.delete('width')
                url.searchParams.delete('length')
                url.searchParams.delete('height')
                window.history.replaceState({}, '', url.toString())
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setDismissed(true)
              useStudioStore.getState().setEntryGateOpen(false)
              onEnterBlank()
              const url = new URL(window.location.href)
              url.searchParams.set('create', '1')
              url.searchParams.delete('saved')
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
