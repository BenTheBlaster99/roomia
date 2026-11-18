'use client'

import { useEffect, useState } from 'react'
import { FAMILY_LABELS, MATERIAL_FAMILIES, type MaterialFamily, type MaterialRoles } from '@/lib/material-roles'
import type { MaterialGuess } from '@/lib/material-library'
import { highlightSceneMaterials, listSceneMaterials, setMaterialPickHandler, type SceneMaterialInfo } from '@/lib/studio-import/material-picker'

const WHY: Record<MaterialGuess['why'], string> = {
  name: 'reconnu par son nom',
  picture: 'reconnu par sa texture',
  library: 'mémorisé sur ce PC',
  tag: 'indiqué par vous',
}

/**
 * "Matières" (18 Nov): what each surface is in real life gives it its real finish in the 360° render (polished marble, satin
 * lacquer, soft velvet...). Roomia recognises most of them from their name or texture; here the designer clicks a surface in the
 * 3D and says what it is when Roomia did not know, or got it wrong. The answer is kept with the project and on this PC, for the
 * next projects that use the same material. Colours and textures are never changed.
 */
export default function MaterialFamiliesPanel({ sceneId }: { sceneId: string }) {
  const [open, setOpen] = useState(false)
  const [roles, setRoles] = useState<MaterialRoles>({})
  const [guesses, setGuesses] = useState<Record<string, MaterialGuess> | null>(null)
  const [materials, setMaterials] = useState<SceneMaterialInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || guesses) return
    let cancelled = false
    fetch(`/api/scenes/${sceneId}/materials?guesses=1`)
      .then(res => (res.ok ? (res.json() as Promise<{ roles: MaterialRoles; guesses: Record<string, MaterialGuess> }>) : null))
      .then(data => {
        if (cancelled || !data) return
        setRoles(data.roles)
        setGuesses(data.guesses ?? {})
      })
      .catch(() => !cancelled && setError('Les matières n’ont pas pu être lues.'))
    return () => {
      cancelled = true
    }
  }, [open, guesses, sceneId])

  // the 3D view goes back to normal when the section closes or the page changes
  useEffect(
    () => () => {
      highlightSceneMaterials([])
      setMaterialPickHandler(null)
    },
    [],
  )

  function choose(name: string) {
    setSelected(name)
    highlightSceneMaterials([name])
  }

  function togglePicking() {
    if (picking) {
      setPicking(false)
      setMaterialPickHandler(null)
      return
    }
    setPicking(true)
    setMaterialPickHandler(choose)
  }

  async function setFamily(name: string, family: MaterialFamily | null) {
    const next = { ...roles }
    const edit = { ...next[name] }
    if (family) edit.family = family
    else delete edit.family
    if (Object.keys(edit).length) next[name] = edit
    else delete next[name]
    setRoles(next)
    setError('')
    const res = await fetch(`/api/scenes/${sceneId}/materials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: next }),
    }).catch(() => null)
    if (!res?.ok) setError('La modification n’a pas pu être enregistrée. Réessayez.')
  }

  // what the render will use for a material: the designer's tag first, then Roomia's guess
  const familyOf = (name: string): { family: string; why: string } | null => {
    if (roles[name]?.family) return { family: roles[name].family!, why: WHY.tag }
    const g = guesses?.[name]
    return g ? { family: g.family, why: WHY[g.why] } : null
  }

  const recognised = materials.filter(m => familyOf(m.name)).length
  // the big surfaces Roomia does not know: the ones that change a render most (walls, floors, cabinets)
  const toCheck = materials
    .filter(m => !familyOf(m.name) && !m.seeThrough && (m.area ?? 0) >= 0.5)
    .sort((a, b) => (b.area ?? 0) - (a.area ?? 0))
    .slice(0, 8)
  const sel = selected ? materials.find(m => m.name === selected) ?? { name: selected, color: '#ccc', textured: false, seeThrough: false, meshes: 0 } : null
  const current = sel ? familyOf(sel.name) : null

  return (
    <details
      className="rounded-[12px] border border-[var(--brand-line)] px-3.5 py-3 text-[13px] text-[var(--brand-muted)]"
      onToggle={e => {
        const isOpen = (e.target as HTMLDetailsElement).open
        setOpen(isOpen)
        if (isOpen) setMaterials(listSceneMaterials())
        else {
          setSelected(null)
          setPicking(false)
          highlightSceneMaterials([])
          setMaterialPickHandler(null)
        }
      }}
    >
      <summary className="cursor-pointer select-none text-[14px] font-semibold text-[var(--brand-ink)]">
        Matières{' '}
        {guesses && materials.length > 0 && (
          <span className="font-normal text-[var(--brand-muted)]">
            · {recognised} reconnues sur {materials.length}
          </span>
        )}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="leading-relaxed">
          Ce qu’est chaque surface lui donne son vrai rendu en 360° : marbre poli, laque satinée, velours doux… Cliquez une surface dans la 3D et dites ce
          que c’est si Roomia ne la reconnaît pas. Les couleurs et les textures ne changent jamais.
        </p>
        {!guesses && !error && <p>Lecture des matières du projet…</p>}
        <button
          type="button"
          onClick={togglePicking}
          className={`ui-btn ui-btn--block ui-btn--sm ${picking ? 'ui-btn--primary' : 'ui-btn--ghost'}`}
        >
          {picking ? 'Cliquez une surface dans la 3D… (terminer)' : 'Choisir une surface dans la 3D'}
        </button>

        {sel && (
          <div className="space-y-2 rounded-[10px] border border-[var(--brand-gold)] bg-[var(--brand-gold-tint)] p-2.5">
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 shrink-0 rounded border border-black/10" style={{ background: sel.color }} />
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--brand-ink)]" title={sel.name}>
                {sel.name}
              </span>
              {(sel.area ?? 0) > 0 && <span className="shrink-0">{sel.area} m²</span>}
            </div>
            <p>
              {current ? (
                <>
                  <b className="text-[var(--brand-ink)]">{FAMILY_LABELS[current.family as MaterialFamily] ?? current.family}</b> · {current.why}
                </>
              ) : (
                'Pas reconnue : finition neutre.'
              )}
              {' '}En orange dans la 3D.
            </p>
            <div className="grid grid-cols-2 gap-1">
              {MATERIAL_FAMILIES.map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => void setFamily(sel.name, f)}
                  className={`rounded-md px-2 py-1.5 text-left text-[12px] transition-all ${
                    roles[sel.name]?.family === f ? 'bg-[var(--brand-blue)] font-semibold text-white' : 'bg-white text-[var(--brand-ink)] hover:bg-[var(--brand-blue-tint)]'
                  }`}
                >
                  {FAMILY_LABELS[f]}
                </button>
              ))}
            </div>
            {roles[sel.name]?.family && (
              <button type="button" onClick={() => void setFamily(sel.name, null)} className="text-[12px] underline underline-offset-2 hover:text-[var(--brand-blue)]">
                Laisser Roomia décider
              </button>
            )}
          </div>
        )}

        {guesses && toCheck.length > 0 && (
          <div>
            <p className="mb-1 font-semibold text-[var(--brand-ink)]">Grandes surfaces à vérifier</p>
            <ul className="space-y-0.5">
              {toCheck.map(m => (
                <li key={m.name}>
                  <button
                    type="button"
                    onClick={() => choose(m.name)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--brand-blue-tint)] ${selected === m.name ? 'bg-[var(--brand-blue-tint)]' : ''}`}
                  >
                    <span className="h-3.5 w-3.5 shrink-0 rounded border border-black/10" style={{ background: m.color }} />
                    <span className="min-w-0 flex-1 truncate text-[var(--brand-ink)]" title={m.name}>
                      {m.name}
                    </span>
                    <span className="shrink-0">{m.area} m²</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[12px]">Utilisé au prochain rendu 360°. Retenu aussi sur ce PC : un projet qui reprend la même matière n’aura rien à refaire.</p>
        {error && <p className="rounded-md bg-red-50 px-2 py-1.5 text-red-700">{error}</p>}
      </div>
    </details>
  )
}
