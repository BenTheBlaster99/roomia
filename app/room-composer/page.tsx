'use client'

import { useEffect, useRef, useState } from 'react'
import { MOCK_CATALOG, type CatalogItem } from '@/lib/mock-catalog'
import { furnitureItemToCatalogItem } from '@/lib/catalog-mapper'
import { fetchGeneratedCatalog } from '@/lib/studio-catalog'
import { getReferenceFidelity } from '@/lib/render-prompt'
import { composeRoom } from '@/lib/compose-client'
import { supabase } from '@/lib/supabase'
import {
  COMPOSER_LIGHTS,
  COMPOSER_WALLS,
  lightById,
  wallById,
  type ComposerLightId,
} from '@/lib/composer-restyle'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import ComposerCatalog from './ComposerCatalog'
import ComposerResults from './ComposerResults'
import { LOOKS, MAX_ZONES, type LookId } from './looks'
import {
  densityHintFr,
  parseComposerStyleParams,
  quizRoomLabelFr,
  styleLabelFr,
  type DensityId,
  type QuizRoomId,
} from '@/lib/quiz'
import { fetchFurnitureStyleTags } from '@/lib/style-tags'

type Slot = {
  id: string
  x: number
  y: number
  itemA: CatalogItem
  itemB: CatalogItem | null
}

type Stage = 'idle' | 'placing' | 'generating' | 'results' | 'error'
type ClickMode = 'furniture' | 'wall' | 'light'

type WallPin = { id: string; hex: string; label: string; prompt: string; x: number; y: number }
type LightPin = {
  id: ComposerLightId
  label: string
  prompt: string
  x: number
  y: number
}

type LookResult = {
  look: LookId
  src: string
  items: CatalogItem[]
}

const PHOTO_TIPS = [
  'Bonne lumière — le jour près d’une fenêtre marche le mieux',
  'Garde les murs et le plafond dans le cadre si tu veux les peindre',
  'Évite les angles extrêmes — vise plutôt face à la pièce',
  'Une photo nette vaut mieux qu’un grand angle trop chargé',
]

function imgToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

async function fetchRefB64(url: string | undefined | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export default function RoomComposerPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [originalB64, setOriginalB64] = useState('')
  const [originalSrc, setOriginalSrc] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [activeLook, setActiveLook] = useState<LookId>('a')
  const [compareOpen, setCompareOpen] = useState(false)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null)
  const [results, setResults] = useState<LookResult[]>([])
  const [selectedLook, setSelectedLook] = useState<LookId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restyleOpen, setRestyleOpen] = useState(false)
  const [progressPct, setProgressPct] = useState(0)
  const [progressDetail, setProgressDetail] = useState('Préparation…')
  const [clickMode, setClickMode] = useState<ClickMode>('furniture')
  const [wallPin, setWallPin] = useState<WallPin | null>(null)
  const [lightPin, setLightPin] = useState<LightPin | null>(null)
  const [pendingWallId, setPendingWallId] = useState<string | null>(null)
  const [pendingLightId, setPendingLightId] = useState<ComposerLightId | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[]>(MOCK_CATALOG.filter(c => c.available))
  const [seedItemId, setSeedItemId] = useState<string | null>(null)
  const [seedStoreSlug, setSeedStoreSlug] = useState<string | null>(null)
  const [seedStyleId, setSeedStyleId] = useState<string | null>(null)
  const [seedRoom, setSeedRoom] = useState<QuizRoomId | null>(null)
  const [seedDensity, setSeedDensity] = useState<DensityId | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('item')
    const store = params.get('store')
    const seeded = parseComposerStyleParams(window.location.search)
    if (id) setSeedItemId(id)
    if (store) setSeedStoreSlug(store)
    if (seeded.styleId) setSeedStyleId(seeded.styleId)
    if (seeded.room) setSeedRoom(seeded.room as QuizRoomId)
    if (seeded.density) setSeedDensity(seeded.density as DensityId)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [rows, storesRes, styleTags] = await Promise.all([
        fetchGeneratedCatalog(),
        supabase.from('stores').select('id, name, slug'),
        fetchFurnitureStyleTags(),
      ])
      if (cancelled) return
      const stores = new Map(
        ((storesRes.data ?? []) as { id: string; name: string; slug: string }[]).map(s => [s.id, s]),
      )
      const fromDb = rows.map(row => {
        const store = row.store_id ? stores.get(row.store_id) ?? null : null
        const item = furnitureItemToCatalogItem(row, store, styleTags.get(row.id))
        return { ...item, available: Boolean(item.imageUrl || item.modelUrl || item.name) }
      })
      const byId = new Map<string, CatalogItem>()
      for (const item of MOCK_CATALOG.filter(c => c.available)) byId.set(item.id, item)
      for (const item of fromDb) byId.set(item.id, item)
      setCatalog([...byId.values()].filter(c => c.available))
    }
    void load().catch(() => {
      /* keep mock catalog */
    })
    return () => {
      cancelled = true
    }
  }, [])

  const lockedItem = seedItemId ? catalog.find(c => c.id === seedItemId) ?? null : null
  const preferredStoreId =
    lockedItem?.storeId ?? catalog.find(c => c.storeSlug === seedStoreSlug)?.storeId ?? null
  const preferredStoreName =
    lockedItem?.storeName ?? catalog.find(c => c.storeSlug === seedStoreSlug)?.storeName ?? null
  const preferredStyleName = styleLabelFr(seedStyleId)
  const styleRoomLabel = quizRoomLabelFr(seedRoom)
  const styleDensityHint = densityHintFr(seedDensity)

  useEffect(() => {
    if (lockedItem) setPendingItem(lockedItem)
  }, [lockedItem])

  const selectedSlot = slots.find(s => s.id === selectedSlotId) ?? null
  const allSlotsHaveB = slots.length > 0 && slots.every(s => s.itemB)
  const willCompare = compareOpen && allSlotsHaveB
  const canGenerate = slots.length > 0 || Boolean(wallPin) || Boolean(lightPin)

  function applyItemToSlot(slotId: string, item: CatalogItem) {
    setSlots(list =>
      list.map(slot => {
        if (slot.id !== slotId) return slot
        return activeLook === 'b' ? { ...slot, itemB: item } : { ...slot, itemA: item }
      }),
    )
    setPendingItem(null)
    setSelectedSlotId(null)
    setError(null)
  }

  function pickCatalogItem(item: CatalogItem) {
    setPendingWallId(null)
    setPendingLightId(null)
    setClickMode('furniture')
    if (selectedSlotId) {
      applyItemToSlot(selectedSlotId, item)
      return
    }
    if (activeLook === 'b') {
      setPendingItem(item)
      setError('Tape le point sur la photo pour changer cette pièce.')
      return
    }
    if (slots.length >= MAX_ZONES) {
      setError(`Maximum ${MAX_ZONES} emplacements. Tape un point pour changer cette pièce.`)
      return
    }
    setPendingItem(item)
    setError(null)
  }

  function openCompare() {
    if (slots.length === 0) return
    setCompareOpen(true)
    setActiveLook('b')
    setSelectedSlotId(slots[0].id)
    setPendingItem(null)
    setError(null)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const b64 = await imgToB64(file)
    setOriginalB64(b64)
    setOriginalSrc(URL.createObjectURL(file))
    setStage('placing')
    setSlots([])
    setActiveLook('a')
    setCompareOpen(false)
    setSelectedSlotId(null)
    setResults([])
    setSelectedLook(null)
    setWallPin(null)
    setLightPin(null)
    setPendingWallId(null)
    setPendingLightId(null)
    setClickMode('furniture')
    setRestyleOpen(false)
    setError(null)
    if (lockedItem) setPendingItem(lockedItem)
  }

  function backToEdit() {
    setStage('placing')
    setError(null)
  }

  function continueCompare() {
    if (slots.length === 0) return
    setCompareOpen(true)
    setActiveLook('b')
    setSelectedSlotId(slots[0].id)
    setPendingItem(null)
    setStage('placing')
    setError(null)
  }

  function handlePhotoClick(e: React.MouseEvent<HTMLImageElement>) {
    if (stage !== 'placing') return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    if (clickMode === 'wall' && pendingWallId) {
      const wall = wallById(pendingWallId)
      if (!wall) return
      setWallPin({ id: wall.id, hex: wall.hex, label: wall.label, prompt: wall.prompt, x, y })
      setClickMode('furniture')
      return
    }

    if (clickMode === 'light' && pendingLightId) {
      const light = lightById(pendingLightId)
      if (!light) return
      setLightPin({ id: light.id, label: light.label, prompt: light.prompt, x, y })
      setClickMode('furniture')
      return
    }

    if (activeLook === 'b') {
      setError('Look 2 reprend les mêmes points. Tape un point, puis une pièce du catalogue.')
      return
    }
    if (selectedSlotId && !pendingItem) {
      setSelectedSlotId(null)
      setError(null)
      return
    }
    if (!pendingItem) {
      setError('Choisis une pièce dans le catalogue, puis tape la photo.')
      return
    }
    if (slots.length >= MAX_ZONES) {
      setError(`Maximum ${MAX_ZONES} emplacements. Tape un point pour changer cette pièce.`)
      return
    }

    const id = crypto.randomUUID()
    setSlots(list => [...list, { id, x, y, itemA: pendingItem, itemB: null }])
    setSelectedSlotId(null)
    setPendingItem(null)
    setError(null)
  }

  function handlePinClick(e: React.MouseEvent, slotId: string) {
    e.stopPropagation()
    e.preventDefault()
    setClickMode('furniture')
    setPendingWallId(null)
    setPendingLightId(null)
    if (pendingItem) {
      applyItemToSlot(slotId, pendingItem)
      return
    }
    setSelectedSlotId(current => (current === slotId ? null : slotId))
  }

  function removeSlot(id: string) {
    setSlots(list => list.filter(slot => slot.id !== id))
    if (selectedSlotId === id) setSelectedSlotId(null)
    if (slots.length <= 1) setCompareOpen(false)
  }

  async function runLook(look: LookId, items: { x: number; y: number; item: CatalogItem }[]): Promise<string | null> {
    const atmosphere = {
      wall: wallPin ? { prompt: wallPin.prompt, x: wallPin.x, y: wallPin.y } : null,
      lighting: lightPin
        ? { prompt: lightPin.prompt, kind: lightPin.id, x: lightPin.x, y: lightPin.y }
        : null,
    }
    if (items.length === 0 && !wallPin && !lightPin) return null

    const zonesPayload = await Promise.all(
      items.map(async zone => {
        const item = zone.item
        const reference_base64 = await fetchRefB64(item.imageUrl)
        const prompt = [item.name, item.style, item.category, item.notes ?? '', item.imageKeyword ?? '']
          .filter(Boolean)
          .join(', ')
        return {
          x: zone.x,
          y: zone.y,
          prompt,
          category: item.category,
          fidelity: getReferenceFidelity(item.category),
          reference_base64,
        }
      }),
    )

    const { variations } = await composeRoom(
      {
        image_base64: originalB64,
        zones: zonesPayload,
        atmosphere,
        num_variations: 1,
      },
      event => {
        if (event.detail) setProgressDetail(event.detail)
        if (typeof event.pct === 'number') {
          const base = look === 'b' && willCompare ? 50 : 0
          const span = willCompare ? 50 : 100
          setProgressPct(base + (event.pct / 100) * span)
        }
      },
    )
    return variations[0] ? `data:image/jpeg;base64,${variations[0]}` : null
  }

  async function handleGenerate() {
    if (!canGenerate) {
      setError('Place au moins une pièce, ou une peinture / lumière.')
      return
    }

    setStage('generating')
    setError(null)
    setSelectedLook(null)
    setProgressPct(8)
    setProgressDetail('Préparation des masques…')

    try {
      const looks: LookResult[] = []
      const lookA = slots.map(s => ({ x: s.x, y: s.y, item: s.itemA }))
      setProgressDetail('Look 1…')
      const srcA = await runLook('a', lookA)
      if (srcA) looks.push({ look: 'a', src: srcA, items: slots.map(s => s.itemA) })

      if (willCompare) {
        const lookB = slots.filter(s => s.itemB).map(s => ({ x: s.x, y: s.y, item: s.itemB! }))
        setProgressDetail('Look 2…')
        setProgressPct(52)
        const srcB = await runLook('b', lookB)
        if (srcB) looks.push({ look: 'b', src: srcB, items: lookB.map(z => z.item) })
      }

      if (looks.length === 0) throw new Error('Aucune image générée.')
      setResults(looks)
      setSelectedLook(looks[0].look)
      setProgressPct(100)
      setStage('results')
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

  function reset() {
    setStage('idle')
    setOriginalB64('')
    setOriginalSrc('')
    setSlots([])
    setActiveLook('a')
    setCompareOpen(false)
    setSelectedSlotId(null)
    setPendingItem(lockedItem)
    setResults([])
    setSelectedLook(null)
    setWallPin(null)
    setLightPin(null)
    setPendingWallId(null)
    setPendingLightId(null)
    setClickMode('furniture')
    setRestyleOpen(false)
    setProgressPct(0)
    setProgressDetail('Préparation…')
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const placingHint =
    clickMode === 'wall'
      ? 'Tape le mur sur la photo'
      : clickMode === 'light'
        ? (lightById(pendingLightId ?? '')?.hint ?? 'Tape où va la lumière')
        : activeLook === 'b'
          ? selectedSlot
            ? `Slot ${slots.indexOf(selectedSlot) + 1} — choisis le remplaçant dans le catalogue`
            : 'Tape un point rouge/bleu, puis une autre pièce'
          : pendingItem
            ? `Tape où placer « ${pendingItem.name} »${slots.length > 0 ? ` (${slots.length}/${MAX_ZONES})` : ''}`
            : selectedSlot
              ? 'Cette pièce va changer. Catalogue pour remplacer, ou tape la photo pour annuler.'
              : slots.length >= MAX_ZONES
                ? `Maximum ${MAX_ZONES} points. Tape un numéro pour changer cette pièce.`
                : slots.length > 0
                  ? `Encore une pièce ? Catalogue, puis tape la photo (${slots.length}/${MAX_ZONES}).`
                  : 'Catalogue → tape la photo. Un point = un emplacement.'

  const catalogHint =
    activeLook === 'b'
      ? 'Même emplacement, autre pièce. La source du magasin est sous chaque photo.'
      : selectedSlot
        ? `Remplace le point ${slots.indexOf(selectedSlot) + 1}, ou tape la photo pour en ajouter un autre.`
        : slots.length >= MAX_ZONES
          ? 'Tape un point sur la photo pour changer cette pièce.'
          : seedStyleId
            ? styleDensityHint ??
              'Les pièces de ce style sont en haut. Choisis, puis tape la photo.'
            : 'Choisis une pièce, puis tape la photo. Tu peux en placer plusieurs.'

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />

      <div className="rm-page py-8">
        {stage !== 'results' ? (
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">Compositeur</p>
            <h1 className="rm-display mt-2 text-3xl font-bold tracking-tight md:text-4xl">
              Cette pièce, dans la tienne
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--rm-muted)]">
              {seedStyleId
                ? `Direction ${preferredStyleName ?? seedStyleId}${styleRoomLabel ? ` · ${styleRoomLabel}` : ''}. Tu choisis les pièces et où elles vont.`
                : 'Place les meubles une fois. Compare ensuite avec d’autres pièces aux mêmes endroits.'}
            </p>
          </div>
        ) : null}

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        {stage === 'idle' && (
          <div className="max-w-2xl space-y-5">
            {seedStyleId && !lockedItem ? (
              <div className="rm-panel p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--rm-accent)]">
                  Depuis le quiz
                </p>
                <p className="mt-1 font-semibold text-[var(--rm-ink)]">{preferredStyleName ?? seedStyleId}</p>
                <p className="mt-1 text-xs text-[var(--rm-muted)]">
                  {styleDensityHint ?? 'Le catalogue met ce style en avant. Tu poses ce que tu veux.'}
                </p>
              </div>
            ) : null}
            {lockedItem ? (
              <div className="rm-panel flex items-center gap-3 p-4">
                {lockedItem.imageUrl ? (
                  <img
                    src={lockedItem.imageUrl}
                    alt=""
                    className="h-16 w-16 rounded-xl bg-[var(--rm-secondary)] object-contain"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-xl bg-[var(--rm-secondary)]" />
                )}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--rm-accent)]">
                    Prête à placer
                  </p>
                  <p className="truncate font-semibold text-[var(--rm-ink)]">{lockedItem.name}</p>
                  <p className="text-xs text-[var(--rm-muted)]">
                    {lockedItem.storeName ? `${lockedItem.storeName} · ` : ''}
                    Envoie ta photo, puis tape où elle va.
                  </p>
                </div>
              </div>
            ) : null}
            <div
              className="rm-panel flex cursor-pointer flex-col items-center gap-4 border-dashed p-12 transition-colors hover:border-[var(--rm-primary)]/40"
              onClick={() => fileRef.current?.click()}
            >
              <div className="rm-display text-sm font-bold text-[var(--rm-primary)]">Ajouter une photo de ta pièce</div>
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
          </div>
        )}

        {(stage === 'placing' || stage === 'generating') && (
          <div className="grid gap-6 lg:grid-cols-[minmax(24rem,34%)_minmax(0,1fr)]">
            <ComposerCatalog
              items={catalog}
              pendingId={pendingItem?.id ?? (selectedSlot
                ? (activeLook === 'b' ? selectedSlot.itemB?.id : selectedSlot.itemA.id) ?? null
                : null)}
              preferredStoreId={preferredStoreId}
              preferredStoreName={preferredStoreName}
              preferredStyleId={seedStyleId}
              preferredStyleName={preferredStyleName}
              hint={catalogHint}
              onPick={pickCatalogItem}
            />

            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {compareOpen ? (
                  <div className="flex rounded-2xl bg-white p-1 shadow-sm">
                    {(['a', 'b'] as LookId[]).map(look => {
                      const active = activeLook === look
                      return (
                        <button
                          key={look}
                          type="button"
                          onClick={() => {
                            setActiveLook(look)
                            setPendingItem(null)
                          }}
                          className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold ${
                            active ? 'bg-[var(--rm-ink)] text-white' : 'text-[var(--rm-muted)]'
                          }`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: LOOKS[look].pin }} />
                          {LOOKS[look].label}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[var(--rm-ink)]">
                    Tes pièces
                    <span className="ml-2 font-normal text-[var(--rm-muted)]">
                      {slots.length}/{MAX_ZONES}
                    </span>
                  </p>
                )}
                <button type="button" onClick={reset} className="text-xs text-[var(--rm-muted)] hover:text-[var(--rm-text)]">
                  Autre photo
                </button>
              </div>
              <p className="rounded-xl bg-white px-3 py-2 text-sm text-[var(--rm-ink)] shadow-sm">{placingHint}</p>

              <div className="relative">
                <img
                  src={originalSrc}
                  alt="Ta pièce"
                  className="block w-full cursor-crosshair rounded-[1.25rem] border border-[var(--rm-text)]/10"
                  onClick={handlePhotoClick}
                />
                {pendingItem ? (
                  <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[80%] items-center gap-2 rounded-full bg-[var(--rm-ink)]/90 px-2.5 py-1.5 text-white shadow">
                    {pendingItem.imageUrl ? (
                      <img src={pendingItem.imageUrl} alt="" className="h-8 w-8 rounded-full bg-white object-contain" />
                    ) : null}
                    <span className="truncate text-xs font-semibold">À placer · {pendingItem.name}</span>
                  </div>
                ) : null}
                {wallPin && (
                  <div
                    className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                    style={{
                      left: `${wallPin.x * 100}%`,
                      top: `${wallPin.y * 100}%`,
                      background: wallPin.hex,
                    }}
                    title={wallPin.label}
                  />
                )}
                {lightPin && (
                  <div
                    className="pointer-events-none absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-amber-300 bg-amber-400/90 text-[10px] font-bold text-zinc-900 shadow"
                    style={{ left: `${lightPin.x * 100}%`, top: `${lightPin.y * 100}%` }}
                    title={lightPin.label}
                  >
                    ✦
                  </div>
                )}
                {slots.map((slot, i) => {
                  const selected = selectedSlotId === slot.id
                  const pinColor = activeLook === 'b' ? LOOKS.b.pin : LOOKS.a.pin
                  const emptyB = activeLook === 'b' && !slot.itemB
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={e => handlePinClick(e, slot.id)}
                      className={`absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-xs font-bold text-white shadow ${
                        selected ? 'ring-2 ring-white' : ''
                      }`}
                      style={{
                        left: `${slot.x * 100}%`,
                        top: `${slot.y * 100}%`,
                        background: emptyB ? 'transparent' : pinColor,
                        borderColor: emptyB ? LOOKS.b.pin : '#fff',
                        color: emptyB ? LOOKS.b.pin : '#fff',
                      }}
                      title={`Slot ${i + 1}`}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>

              <div className="rm-panel overflow-hidden">
                <button
                  type="button"
                  onClick={() => setRestyleOpen(open => !open)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-xs font-semibold text-[var(--rm-ink)]">Peinture et lumière</span>
                  <span className="text-[11px] text-[var(--rm-muted)]">
                    {restyleOpen ? 'Masquer' : wallPin || lightPin ? 'En place' : 'Optionnel'}
                  </span>
                </button>
                {restyleOpen ? (
              <div className="flex flex-col gap-3 border-t border-[var(--rm-text)]/8 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[var(--rm-muted)]">
                    Mur
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {COMPOSER_WALLS.map(wall => {
                      const active = (wallPin?.id ?? pendingWallId) === wall.id
                      return (
                        <button
                          key={wall.id}
                          type="button"
                          title={wall.label}
                          aria-label={wall.label}
                          onClick={() => {
                            if (active) {
                              setWallPin(null)
                              setPendingWallId(null)
                              setClickMode('furniture')
                              return
                            }
                            setPendingWallId(wall.id)
                            setPendingLightId(null)
                            setPendingItem(null)
                            if (wallPin) {
                              setWallPin({
                                ...wallPin,
                                id: wall.id,
                                hex: wall.hex,
                                label: wall.label,
                                prompt: wall.prompt,
                              })
                              setClickMode('furniture')
                            } else {
                              setClickMode('wall')
                            }
                          }}
                          className={`h-7 w-7 rounded-full border ${
                            active ? 'border-[var(--rm-primary)] ring-2 ring-[var(--rm-primary)]/30' : 'border-black/10'
                          }`}
                          style={{ background: wall.hex }}
                        />
                      )
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[var(--rm-muted)]">
                    Lumière
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {COMPOSER_LIGHTS.map(light => {
                      const active = (lightPin?.id ?? pendingLightId) === light.id
                      return (
                        <button
                          key={light.id}
                          type="button"
                          onClick={() => {
                            if (active) {
                              setLightPin(null)
                              setPendingLightId(null)
                              setClickMode('furniture')
                              return
                            }
                            setPendingLightId(light.id)
                            setPendingWallId(null)
                            setPendingItem(null)
                            if (lightPin) {
                              setLightPin({
                                ...lightPin,
                                id: light.id,
                                label: light.label,
                                prompt: light.prompt,
                              })
                              setClickMode('furniture')
                            } else {
                              setClickMode('light')
                            }
                          }}
                          className={`rounded-full px-3 py-1 text-xs ${
                            active
                              ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                              : 'bg-[var(--rm-secondary)] text-[var(--rm-muted)]'
                          }`}
                        >
                          {light.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
                ) : null}
              </div>

              {slots.length > 0 && (
                <div className="space-y-2">
                  {slots.map((slot, i) => {
                    const item = activeLook === 'b' ? slot.itemB : slot.itemA
                    return (
                      <div
                        key={slot.id}
                        className={`rm-panel px-4 py-2.5 ${
                          selectedSlotId === slot.id ? 'ring-1 ring-[var(--rm-primary)]' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() =>
                              setSelectedSlotId(current => (current === slot.id ? null : slot.id))
                            }
                          >
                            <span
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                              style={{ background: LOOKS[activeLook].pin }}
                            >
                              {i + 1}
                            </span>
                            {compareOpen ? (
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  {slot.itemA.imageUrl ? (
                                    <img src={slot.itemA.imageUrl} alt="" className="h-8 w-8 rounded-lg bg-[var(--rm-bg)] object-contain" />
                                  ) : null}
                                  <span className="truncate text-xs font-semibold">{slot.itemA.name}</span>
                                </div>
                                <p className="mt-1 truncate text-[10px] uppercase tracking-wider text-[var(--rm-muted)]">ou</p>
                                <div className="mt-1 flex items-center gap-2">
                                  {slot.itemB?.imageUrl ? (
                                    <img src={slot.itemB.imageUrl} alt="" className="h-8 w-8 rounded-lg bg-[var(--rm-bg)] object-contain" />
                                  ) : (
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--rm-secondary)] text-[10px] text-[var(--rm-muted)]">
                                      ?
                                    </div>
                                  )}
                                  <span className="truncate text-xs font-semibold">
                                    {slot.itemB?.name ?? 'Choisis le remplaçant'}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <>
                                {item?.imageUrl ? (
                                  <img src={item.imageUrl} alt="" className="h-9 w-9 rounded-lg bg-[var(--rm-bg)] object-contain" />
                                ) : (
                                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--rm-secondary)] text-[10px] text-[var(--rm-muted)]">
                                    ?
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold">
                                    {item?.name ?? 'Choisis une pièce'}
                                  </div>
                                  <div className="truncate text-xs text-[var(--rm-accent)]">
                                    {item?.storeName ?? item?.category ?? 'Même emplacement'}
                                  </div>
                                </div>
                              </>
                            )}
                          </button>
                          {activeLook === 'a' ? (
                            <button
                              type="button"
                              onClick={() => removeSlot(slot.id)}
                              className="shrink-0 text-xs text-[var(--rm-muted)] hover:text-red-600"
                            >
                              Retirer
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {stage === 'generating' && (
                <div className="space-y-2 rounded-2xl border border-[var(--rm-text)]/10 bg-white px-4 py-4">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold">{progressDetail}</span>
                    <span className="tabular-nums text-[var(--rm-muted)]">{Math.round(progressPct)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--rm-text)]/10">
                    <div
                      className="h-full rounded-full bg-[var(--rm-primary)] transition-[width] duration-500"
                      style={{ width: `${Math.min(100, Math.max(4, progressPct))}%` }}
                    />
                  </div>
                </div>
              )}

              {stage === 'placing' && canGenerate && (
                <div className="space-y-2">
                  <button type="button" onClick={() => void handleGenerate()} className="rm-btn-primary w-full py-3.5 text-sm">
                    {willCompare ? 'Voir les deux versions' : 'Voir dans ma pièce'}
                    <span className="mt-1 block text-[11px] font-normal opacity-80">
                      {slots.length} emplacement{slots.length > 1 ? 's' : ''}
                      {willCompare ? ' · mêmes points, deux pièces' : ''}
                    </span>
                  </button>
                  {!compareOpen && slots.length > 0 ? (
                    <button type="button" onClick={openCompare} className="rm-btn-secondary w-full py-2.5 text-sm">
                      Comparer avec une autre pièce
                    </button>
                  ) : null}
                  {compareOpen && !allSlotsHaveB ? (
                    <p className="text-center text-xs text-[var(--rm-muted)]">
                      Remplace chaque point en bleu pour lancer les deux looks.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        )}

        {stage === 'results' && (
          <ComposerResults
            results={results}
            selectedLook={selectedLook}
            slots={slots}
            onSelectLook={setSelectedLook}
            onEdit={backToEdit}
            onCompare={continueCompare}
            onReset={reset}
          />
        )}

        {stage === 'error' && (
          <button type="button" onClick={() => setStage('placing')} className="rm-btn-primary w-full py-3 text-sm">
            Réessayer
          </button>
        )}
      </div>

      <SiteFooter />
    </div>
  )
}
