'use client'

import { useRef, useState } from 'react'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import { composeRoom } from '@/lib/compose-client'
import {
  KITCHEN_ADDONS,
  KITCHEN_BASES,
  KITCHEN_DOORS,
  KITCHEN_HANDLES,
  KITCHEN_HOODS,
  KITCHEN_ISLAND,
  KITCHEN_SHAPES,
  KITCHEN_SIDES,
  KITCHEN_SINKS,
  KITCHEN_SPLASH,
  KITCHEN_STYLE_IDS,
  KITCHEN_SUBJECTS,
  KITCHEN_TALL,
  KITCHEN_UPPERS,
  KITCHEN_WORKTOPS,
  buildKitchenComposePrompt,
  buildKitchenRefinePrompt,
  buildKitchenTweakPrompt,
  kitchenPartById,
  kitchenStyleLabel,
  kitchenStylePhoto,
  kitchenSwatchById,
  kitchenTweakLabel,
  type KitchenPart,
  type KitchenPin,
  type KitchenShapeId,
  type KitchenStyleId,
  type KitchenSwatch,
  type KitchenTweak,
  type KitchenTweakAction,
} from '@/lib/kitchen-flow'

type Stage = 'idle' | 'config' | 'generating' | 'results' | 'error'

const PHOTO_TIPS = [
  'Cadre toute la cuisine — meubles, plan de travail, si possible la hotte',
  'Lumière du jour, sans grand angle trop déformé',
  'Une cuisine existante ou une pièce vide : les deux marchent',
]

function imgToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

function dataUrlToB64(src: string) {
  return src.includes(',') ? src.split(',')[1] : src
}

function clickPin(e: React.MouseEvent<HTMLImageElement>): KitchenPin {
  const rect = e.currentTarget.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  }
}

function ChipRow({
  title,
  children,
  compact,
}: {
  title: string
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <div className={compact ? 'space-y-2' : 'rm-panel space-y-3 p-4'}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function ChoiceButton({
  label,
  on,
  onClick,
  swatch,
}: {
  label: string
  on: boolean
  onClick: () => void
  swatch?: KitchenSwatch
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-left text-xs font-semibold ${
        on
          ? 'border-[var(--rm-primary)] bg-white text-[var(--rm-ink)] shadow-sm'
          : 'border-[var(--rm-text)]/10 bg-white/60 text-[var(--rm-muted)]'
      }`}
    >
      {swatch ? (
        <i className="block h-5 w-5 rounded-full border border-black/10" style={{ background: swatch.hex }} />
      ) : null}
      {label}
    </button>
  )
}

function PartRow({
  title,
  parts,
  value,
  onChange,
}: {
  title: string
  parts: KitchenPart[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <ChipRow title={title} compact>
      {parts.map(part => (
        <ChoiceButton
          key={part.id}
          label={part.label}
          on={value === part.id}
          onClick={() => onChange(part.id)}
        />
      ))}
    </ChipRow>
  )
}

export default function KitchenComposer() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [originalB64, setOriginalB64] = useState('')
  const [originalSrc, setOriginalSrc] = useState('')
  const [styleId, setStyleId] = useState<KitchenStyleId | null>(null)
  const [shapeId, setShapeId] = useState<KitchenShapeId | null>(null)
  const [doorsId, setDoorsId] = useState<string | null>(null)
  const [worktopId, setWorktopId] = useState<string | null>(null)
  const [handlesId, setHandlesId] = useState<string>('integrated')
  const [basesId, setBasesId] = useState('mix')
  const [uppersId, setUppersId] = useState('full')
  const [tallId, setTallId] = useState('none')
  const [islandId, setIslandId] = useState('none')
  const [hoodId, setHoodId] = useState('visible')
  const [sinkId, setSinkId] = useState('run')
  const [splashId, setSplashId] = useState('none')
  const [notes, setNotes] = useState('')
  const [resultSrc, setResultSrc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progressPct, setProgressPct] = useState(0)
  const [progressDetail, setProgressDetail] = useState('Préparation…')
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [tweaking, setTweaking] = useState(false)
  const [tweakAction, setTweakAction] = useState<KitchenTweakAction>('move')
  const [tweakSubjectId, setTweakSubjectId] = useState<string | null>('microwave')
  const [tweakAddonId, setTweakAddonId] = useState<string | null>(null)
  const [tweakSideId, setTweakSideId] = useState<string | null>(null)
  const [tweakFrom, setTweakFrom] = useState<KitchenPin | null>(null)
  const [tweakTo, setTweakTo] = useState<KitchenPin | null>(null)
  const [appliedTweaks, setAppliedTweaks] = useState<string[]>([])

  const doors = kitchenSwatchById(KITCHEN_DOORS, doorsId)
  const worktop = kitchenSwatchById(KITCHEN_WORKTOPS, worktopId)
  const handles = kitchenSwatchById(KITCHEN_HANDLES, handlesId)
  const bases = kitchenPartById(KITCHEN_BASES, basesId)
  const uppers = kitchenPartById(KITCHEN_UPPERS, uppersId)
  const tall = kitchenPartById(KITCHEN_TALL, tallId)
  const island = kitchenPartById(KITCHEN_ISLAND, islandId)
  const hood = kitchenPartById(KITCHEN_HOODS, hoodId)
  const sink = kitchenPartById(KITCHEN_SINKS, sinkId)
  const splash = kitchenPartById(KITCHEN_SPLASH, splashId)
  const canGenerate = Boolean(styleId && shapeId && doors && worktop)
  const currentTweak: KitchenTweak = {
    action: tweakAction,
    subjectId: tweakSubjectId,
    addonId: tweakAddonId,
    sideId: tweakSideId,
    from: tweakFrom,
    to: tweakTo,
    detail: notes,
  }
  const hasNotes = Boolean(notes.trim())
  const canApplyTweak =
    tweakAction === 'move'
      ? Boolean(tweakFrom && (tweakTo || tweakSideId))
      : tweakAction === 'change'
        ? Boolean(tweakFrom && tweakSubjectId)
        : Boolean(tweakFrom && (tweakAddonId || hasNotes))
  const canRefine = canApplyTweak || hasNotes

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const b64 = await imgToB64(file)
    setOriginalB64(b64)
    setOriginalSrc(URL.createObjectURL(file))
    setStage('config')
    setResultSrc('')
    setHandoffOpen(false)
    setError(null)
    clearTweak()
    setAppliedTweaks([])
  }

  function reset() {
    setStage('idle')
    setOriginalB64('')
    setOriginalSrc('')
    setResultSrc('')
    setError(null)
    setHandoffOpen(false)
    setProgressPct(0)
    setAppliedTweaks([])
    clearTweak()
    if (fileRef.current) fileRef.current.value = ''
  }

  function clearTweak() {
    setTweakFrom(null)
    setTweakTo(null)
    setTweakSideId(null)
    setTweaking(false)
  }

  function pickTweakAction(action: KitchenTweakAction) {
    setTweakAction(action)
    setTweakFrom(null)
    setTweakTo(null)
    setTweakSideId(null)
    if (action === 'add') setTweakAddonId(current => current ?? 'stools')
  }

  function handleResultClick(e: React.MouseEvent<HTMLImageElement>) {
    if (tweaking) return
    const pin = clickPin(e)
    if (tweakAction === 'move' && tweakFrom && !tweakTo && !tweakSideId) {
      setTweakTo(pin)
      return
    }
    setTweakFrom(pin)
    setTweakTo(null)
  }

  async function runCompose(imageB64: string, prompt: string) {
    const { variations } = await composeRoom(
      {
        image_base64: imageB64,
        full_frame: true,
        zones: [
          {
            x: tweakFrom?.x ?? 0.5,
            y: tweakFrom?.y ?? 0.45,
            prompt,
            category: 'Kitchen',
            fidelity: 'placement_adaptive',
          },
        ],
        num_variations: 1,
      },
      event => {
        if (event.detail) setProgressDetail(event.detail)
        if (typeof event.pct === 'number') setProgressPct(event.pct)
      },
    )
    const src = variations[0] ? `data:image/jpeg;base64,${variations[0]}` : null
    if (!src) throw new Error('Aucune image générée.')
    setResultSrc(src)
    setProgressPct(100)
    setStage('results')
  }

  async function handleGenerate() {
    if (!styleId || !shapeId || !doors || !worktop) {
      setError('Choisis un style, une forme, des portes et un plan de travail.')
      return
    }

    setStage('generating')
    setError(null)
    setProgressPct(8)
    setProgressDetail('Envoi de la photo à l’IA…')

    try {
      await runCompose(
        originalB64,
        buildKitchenComposePrompt({
          styleId,
          shapeId,
          doors,
          worktop,
          handles,
          bases,
          uppers,
          tall,
          island,
          hood,
          sink,
          splash,
          notes,
        }),
      )
      if (notes.trim()) setAppliedTweaks(list => [...list, `Précision · ${notes.trim()}`])
      setNotes('')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(
        message.toLowerCase().includes('fetch') || message.includes('502')
          ? 'Image API returned an error (502). Check OPENAI_BASE_URL / key, then retry.'
          : message,
      )
      setStage('error')
    }
  }

  async function handleRefine() {
    if (!resultSrc) return
    if (!canRefine) {
      setError('Tape un élément dans le cadre, ou écris une précision — les deux partent ensemble.')
      return
    }

    const prompt = canApplyTweak
      ? buildKitchenTweakPrompt(currentTweak, notes)
      : buildKitchenRefinePrompt(notes)
    const label = canApplyTweak
      ? kitchenTweakLabel(currentTweak, notes)
      : `Précision · ${notes.trim()}`

    setTweaking(true)
    setError(null)
    setProgressPct(8)
    setProgressDetail('On retouche ce look…')

    try {
      await runCompose(dataUrlToB64(resultSrc), prompt)
      setAppliedTweaks(list => [...list, label])
      setNotes('')
      clearTweak()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(
        message.toLowerCase().includes('fetch') || message.includes('502')
          ? 'Image API returned an error (502). Check OPENAI_BASE_URL / key, then retry.'
          : message,
      )
      setTweaking(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />

      <div className="rm-page py-8">
        {stage !== 'results' ? (
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">
              Cuisine · modèle
            </p>
            <h1 className="rm-display mt-2 text-3xl font-bold tracking-tight md:text-4xl">
              Une cuisine, en look
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--rm-muted)]">
              Tu choisis les briques. Roomia peint le look. Le cuisiniste fera le plan ensuite.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        {stage === 'idle' ? (
          <div className="max-w-2xl space-y-5">
            <div
              className="rm-panel flex cursor-pointer flex-col items-center gap-4 border-dashed p-12 transition-colors hover:border-[var(--rm-primary)]/40"
              onClick={() => fileRef.current?.click()}
            >
              <div className="rm-display text-sm font-bold text-[var(--rm-primary)]">
                Photo de la cuisine ou de l’espace
              </div>
              <div className="text-xs text-[var(--rm-muted)]">JPG ou PNG — un angle clair suffit</div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
            </div>
            <div className="rm-panel p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--rm-muted)]">
                Pour un bon résultat
              </p>
              <ul className="space-y-1.5">
                {PHOTO_TIPS.map(tip => (
                  <li key={tip} className="flex items-start gap-2 text-xs text-[var(--rm-muted)]">
                    <span className="flex-shrink-0 text-[var(--rm-accent)]">·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-[var(--rm-muted)]">
              Tu veux poser un canapé ?{' '}
              <a href="/room-composer" className="font-semibold text-[var(--rm-primary)] underline">
                Compositeur meubles
              </a>
            </p>
          </div>
        ) : null}

        {(stage === 'config' || stage === 'generating') && originalSrc ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(22rem,36%)_minmax(0,1fr)]">
            <div className="space-y-3">
              <ChipRow title="Style">
                {KITCHEN_STYLE_IDS.map(id => {
                  const on = styleId === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setStyleId(id)}
                      className={`overflow-hidden rounded-xl border text-left ${
                        on ? 'border-[var(--rm-primary)] ring-2 ring-[var(--rm-primary)]/25' : 'border-[var(--rm-text)]/10'
                      }`}
                    >
                      <img src={kitchenStylePhoto(id)} alt="" className="h-16 w-28 object-cover" />
                      <span className="block px-2 py-1.5 text-[11px] font-semibold">{kitchenStyleLabel(id)}</span>
                    </button>
                  )
                })}
              </ChipRow>

              <ChipRow title="Configuration">
                {KITCHEN_SHAPES.map(shape => (
                  <ChoiceButton
                    key={shape.id}
                    label={shape.label}
                    on={shapeId === shape.id}
                    onClick={() => {
                      setShapeId(shape.id)
                      if (shape.id === 'island' && islandId === 'none') setIslandId('seating')
                    }}
                  />
                ))}
              </ChipRow>

              <div className="rm-panel space-y-4 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
                  Composition
                </p>
                <PartRow title="Meubles bas" parts={KITCHEN_BASES} value={basesId} onChange={setBasesId} />
                <PartRow title="Meubles hauts" parts={KITCHEN_UPPERS} value={uppersId} onChange={setUppersId} />
                <PartRow title="Colonnes" parts={KITCHEN_TALL} value={tallId} onChange={setTallId} />
                <PartRow title="Îlot" parts={KITCHEN_ISLAND} value={islandId} onChange={setIslandId} />
              </div>

              <div className="rm-panel space-y-4 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
                  Éléments
                </p>
                <PartRow title="Hotte" parts={KITCHEN_HOODS} value={hoodId} onChange={setHoodId} />
                <PartRow title="Évier" parts={KITCHEN_SINKS} value={sinkId} onChange={setSinkId} />
                <PartRow title="Crédence" parts={KITCHEN_SPLASH} value={splashId} onChange={setSplashId} />
              </div>

              <div className="rm-panel space-y-4 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
                  Matières
                </p>
                <ChipRow title="Portes" compact>
                  {KITCHEN_DOORS.map(swatch => (
                    <ChoiceButton
                      key={swatch.id}
                      label={swatch.label}
                      swatch={swatch}
                      on={doorsId === swatch.id}
                      onClick={() => setDoorsId(swatch.id)}
                    />
                  ))}
                </ChipRow>
                <ChipRow title="Plan de travail" compact>
                  {KITCHEN_WORKTOPS.map(swatch => (
                    <ChoiceButton
                      key={swatch.id}
                      label={swatch.label}
                      swatch={swatch}
                      on={worktopId === swatch.id}
                      onClick={() => setWorktopId(swatch.id)}
                    />
                  ))}
                </ChipRow>
                <ChipRow title="Poignées" compact>
                  {KITCHEN_HANDLES.map(swatch => (
                    <ChoiceButton
                      key={swatch.id}
                      label={swatch.label}
                      swatch={swatch}
                      on={handlesId === swatch.id}
                      onClick={() => setHandlesId(swatch.id)}
                    />
                  ))}
                </ChipRow>
              </div>

              <div className="rm-panel space-y-2 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
                  Précisions
                </p>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Ex. tiroirs à gauche du four, plus de hauts au-dessus de l’évier… Intention visuelle, pas un plan."
                  className="w-full resize-y rounded-xl border border-[var(--rm-text)]/10 bg-white px-3 py-2 text-sm text-[var(--rm-ink)] outline-none focus:border-[var(--rm-primary)]"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              <div className="flex justify-end">
                <button type="button" onClick={reset} className="text-xs text-[var(--rm-muted)] hover:text-[var(--rm-text)]">
                  Autre photo
                </button>
              </div>
              <img
                src={originalSrc}
                alt="La cuisine"
                className="block w-full rounded-[1.25rem] border border-[var(--rm-text)]/10"
              />
              {stage === 'generating' ? (
                <div className="rm-panel p-4">
                  <p className="text-sm font-semibold">{progressDetail}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--rm-secondary)]">
                    <div className="h-full bg-[var(--rm-accent)]" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!canGenerate}
                  onClick={() => void handleGenerate()}
                  className="rm-btn-primary w-full py-3 text-sm disabled:opacity-40"
                >
                  Voir ce look
                </button>
              )}
              {!canGenerate && stage === 'config' ? (
                <p className="text-center text-xs text-[var(--rm-muted)]">
                  Style, forme, portes et plan de travail — puis on génère.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {stage === 'results' && resultSrc ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,28%)]">
            <div className="space-y-3">
              <p className="text-sm text-[var(--rm-muted)]">
                {tweakAction === 'move' && !tweakFrom
                  ? 'Tape le micro-ondes (ou l’élément), puis le nouvel endroit — ou choisis à gauche / à droite.'
                  : tweakAction === 'move' && tweakFrom && !tweakTo && !tweakSideId
                    ? 'Tape où tu veux le voir, ou choisis un côté.'
                    : tweakAction === 'add'
                      ? 'Tape l’endroit, puis ce que tu ajoutes.'
                      : 'Tape l’élément à changer, puis précise.'}
              </p>
              <div className="relative">
                <img
                  src={resultSrc}
                  alt="Look cuisine"
                  className={`w-full rounded-[1.25rem] ${tweaking ? '' : 'cursor-crosshair'}`}
                  onClick={handleResultClick}
                />
                {tweakFrom ? (
                  <span
                    className="pointer-events-none absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--rm-primary)] text-[10px] font-bold text-white shadow"
                    style={{ left: `${tweakFrom.x * 100}%`, top: `${tweakFrom.y * 100}%` }}
                  >
                    1
                  </span>
                ) : null}
                {tweakTo ? (
                  <span
                    className="pointer-events-none absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--rm-ink)] text-[10px] font-bold text-white shadow"
                    style={{ left: `${tweakTo.x * 100}%`, top: `${tweakTo.y * 100}%` }}
                  >
                    2
                  </span>
                ) : null}
                {tweaking ? (
                  <div className="absolute inset-x-4 bottom-4 rounded-xl bg-white/95 p-3 shadow">
                    <p className="text-sm font-semibold">{progressDetail}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--rm-secondary)]">
                      <div className="h-full bg-[var(--rm-accent)]" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">Ça vous plaît ?</p>
              <h2 className="rm-display text-2xl font-bold">Ce look, pas encore le plan</h2>
              <ul className="space-y-1 text-sm text-[var(--rm-ink)]">
                {styleId ? <li>Style · {kitchenStyleLabel(styleId)}</li> : null}
                {shapeId ? <li>Forme · {KITCHEN_SHAPES.find(s => s.id === shapeId)?.label}</li> : null}
                {bases ? <li>Bas · {bases.label}</li> : null}
                {uppers ? <li>Hauts · {uppers.label}</li> : null}
                {tall ? <li>Colonnes · {tall.label}</li> : null}
                {island ? <li>Îlot · {island.label}</li> : null}
                {hood ? <li>Hotte · {hood.label}</li> : null}
                {sink ? <li>Évier · {sink.label}</li> : null}
                {splash ? <li>Crédence · {splash.label}</li> : null}
                {doors ? <li>Portes · {doors.label}</li> : null}
                {worktop ? <li>Plan · {worktop.label}</li> : null}
                {handles ? <li>Poignées · {handles.label}</li> : null}
                {notes.trim() ? <li>Notes · {notes.trim()}</li> : null}
                {appliedTweaks.map(item => (
                  <li key={item}>Retouche · {item}</li>
                ))}
              </ul>
              <div className="rm-panel space-y-3 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
                  Dans le cadre
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['move', 'Déplacer'],
                      ['change', 'Changer'],
                      ['add', 'Ajouter'],
                    ] as const
                  ).map(([id, label]) => (
                    <ChoiceButton
                      key={id}
                      label={label}
                      on={tweakAction === id}
                      onClick={() => pickTweakAction(id)}
                    />
                  ))}
                </div>
                {tweakAction !== 'add' ? (
                  <ChipRow title="C’est quoi" compact>
                    {KITCHEN_SUBJECTS.map(item => (
                      <ChoiceButton
                        key={item.id}
                        label={item.label}
                        on={tweakSubjectId === item.id}
                        onClick={() => setTweakSubjectId(item.id)}
                      />
                    ))}
                  </ChipRow>
                ) : (
                  <ChipRow title="Ajouter" compact>
                    {KITCHEN_ADDONS.map(item => (
                      <ChoiceButton
                        key={item.id}
                        label={item.label}
                        on={tweakAddonId === item.id}
                        onClick={() => setTweakAddonId(item.id)}
                      />
                    ))}
                  </ChipRow>
                )}
                {tweakAction === 'move' ? (
                  <ChipRow title="Vers" compact>
                    {KITCHEN_SIDES.map(item => (
                      <ChoiceButton
                        key={item.id}
                        label={item.label}
                        on={tweakSideId === item.id}
                        onClick={() => {
                          setTweakSideId(item.id)
                          setTweakTo(null)
                        }}
                      />
                    ))}
                  </ChipRow>
                ) : null}
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
                    Précision
                  </p>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="En plus : hauts à moitié, tiroir à gauche… part dans le même envoi."
                    className="w-full resize-y rounded-xl border border-[var(--rm-text)]/10 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--rm-primary)]"
                  />
                </div>
                <button
                  type="button"
                  disabled={!canRefine || tweaking}
                  onClick={() => void handleRefine()}
                  className="rm-btn-primary w-full py-2.5 text-sm disabled:opacity-40"
                >
                  {canApplyTweak && hasNotes
                    ? 'Appliquer les deux'
                    : canApplyTweak
                      ? 'Appliquer dans le cadre'
                      : 'Appliquer la précision'}
                </button>
              </div>
              <button type="button" onClick={() => setHandoffOpen(true)} className="rm-btn-primary w-full py-3 text-sm">
                Voir avec le cuisiniste
              </button>
              {handoffOpen ? (
                <p className="rm-panel p-4 text-sm leading-relaxed text-[var(--rm-muted)]">
                  Ici le cuisiniste reprend : mesure, dépôt, conception. On n’a pas encore ce parcours — les questions
                  métier sont en pause. Le look reste une intention.
                </p>
              ) : null}
              <button type="button" onClick={() => setStage('config')} className="rm-btn-secondary w-full py-2.5 text-sm">
                Changer les briques
              </button>
              <button type="button" onClick={reset} className="w-full text-xs text-[var(--rm-muted)]">
                Autre photo
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'error' ? (
          <button type="button" onClick={() => setStage('config')} className="rm-btn-primary w-full py-3 text-sm">
            Réessayer
          </button>
        ) : null}
      </div>

      <SiteFooter />
    </div>
  )
}
