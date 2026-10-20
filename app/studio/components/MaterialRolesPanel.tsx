'use client'

import { useEffect, useState } from 'react'
import {
  FINISH_LABELS,
  FINISHES,
  MATERIAL_ROLES,
  ROLE_LABELS,
  type MaterialEdit,
  type MaterialFinish,
  type MaterialRole,
  type MaterialRoles,
} from '@/lib/material-roles'
import {
  highlightSceneMaterials,
  listSceneMaterials,
  previewMaterialColor,
  setMaterialPickHandler,
  type SceneMaterialInfo,
} from '@/lib/studio-import/material-picker'

/** What the capture does with a material left on Auto (same rules as the Blender script). */
function autoRole(material: SceneMaterialInfo): string {
  if (/mirror|miroir/i.test(material.name)) return 'miroir (nom)'
  if (/glass|verre|vitre|window/i.test(material.name) || material.seeThrough) return 'verre'
  if (/^(led|light|lights|lamp|spot)$|\bled\b|bedside lights|lumin|plafonnier|neon/i.test(material.name)) return 'lumière (nom)'
  return 'normal'
}

function Swatch({ color, textured }: { color?: string; textured?: boolean }) {
  return (
    <span
      className="h-4 w-4 shrink-0 rounded border border-black/10"
      style={{
        background: color ?? '#ccc',
        backgroundImage: textured ? 'linear-gradient(135deg,transparent 45%,rgba(0,0,0,.25) 50%,transparent 55%)' : undefined,
      }}
    />
  )
}

/** The value every selected material shares, or undefined when they differ. */
function common<T>(values: T[]): T | undefined {
  return values.length && values.every(v => v === values[0]) ? values[0] : undefined
}

function summary(edit: MaterialEdit): string {
  return [edit.role && ROLE_LABELS[edit.role], edit.finish && FINISH_LABELS[edit.finish], edit.color && 'couleur']
    .filter(Boolean)
    .join(' · ')
}

/**
 * Corrections after a check or photo: pick one or several surfaces in the 3D view, then say what
 * they are (mirror, glass, light) and/or give them a new colour and finish. Saved with the scene
 * and used by the next capture.
 */
export default function MaterialRolesPanel({ sceneId }: { sceneId: string }) {
  const [edits, setEdits] = useState<MaterialRoles>({})
  const [materials, setMaterials] = useState<SceneMaterialInfo[]>(() => listSceneMaterials())
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [draftColor, setDraftColor] = useState('#d9cbb8')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/scenes/${sceneId}/materials`)
      .then(res => (res.ok ? (res.json() as Promise<{ roles: MaterialRoles }>) : null))
      .then(data => {
        if (!data || cancelled) return
        setEdits(data.roles)
        for (const [name, edit] of Object.entries(data.roles)) if (edit.color) previewMaterialColor(name, edit.color)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sceneId])

  // Leave the 3D view as it was when the panel goes away (saved colours stay shown).
  useEffect(
    () => () => {
      highlightSceneMaterials([])
      setMaterialPickHandler(null)
    },
    [],
  )

  function select(next: string[]) {
    setSelection(next)
    highlightSceneMaterials(next)
  }

  const toggle = (name: string) =>
    setSelection(current => {
      const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name]
      highlightSceneMaterials(next)
      return next
    })

  function togglePicking() {
    if (picking) {
      setPicking(false)
      setMaterialPickHandler(null)
      return
    }
    setMaterials(listSceneMaterials())
    setPicking(true)
    // Picking stays on: every click adds that surface's material, or removes it if already picked.
    setMaterialPickHandler(toggle)
  }

  async function save(next: MaterialRoles) {
    setEdits(next)
    setError(null)
    const res = await fetch(`/api/scenes/${sceneId}/materials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: next }),
    }).catch(() => null)
    if (!res?.ok) setError('La modification n’a pas pu être enregistrée. Réessayez.')
  }

  /** Applies one change to every selected material; null removes that part of the edit. */
  function apply(change: { role?: MaterialRole; color?: string | null; finish?: MaterialFinish | null }, names = selection) {
    const next = { ...edits }
    for (const name of names) {
      const edit: MaterialEdit = { ...next[name] }
      if (change.role) {
        if (change.role === 'auto') delete edit.role
        else edit.role = change.role
      }
      if (change.color !== undefined) {
        if (change.color) edit.color = change.color
        else delete edit.color
        previewMaterialColor(name, change.color)
      }
      if (change.finish !== undefined) {
        if (change.finish) edit.finish = change.finish
        else delete edit.finish
      }
      if (Object.keys(edit).length) next[name] = edit
      else delete next[name]
    }
    void save(next)
  }

  function reset(name: string) {
    previewMaterialColor(name, null)
    const next = { ...edits }
    delete next[name]
    void save(next)
  }

  const byName = new Map(materials.map(m => [m.name, m]))
  const results = query.trim()
    ? materials.filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 20)
    : []
  const edited = Object.entries(edits)
  const selectedRole = common(selection.map(n => edits[n]?.role ?? 'auto'))
  const selectedFinish = common(selection.map(n => edits[n]?.finish ?? null))
  const selectedColor = common(selection.map(n => edits[n]?.color ?? null))
  const single = selection.length === 1 ? byName.get(selection[0]) : undefined

  return (
    <details
      open
      className="rounded-xl border border-[var(--rm-text)]/10 px-3 py-2.5 text-xs text-[var(--rm-muted)]"
      onToggle={e => {
        if ((e.target as HTMLDetailsElement).open) setMaterials(listSceneMaterials())
        else select([])
      }}
    >
      <summary className="cursor-pointer select-none text-sm font-medium text-[var(--rm-text)]">
        Matériaux{' '}
        <span className="font-normal text-[var(--rm-muted)]">
          · corriger{edited.length ? ` · ${edited.length} modifié${edited.length > 1 ? 's' : ''}` : ''}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="leading-relaxed">
          Cliquez une ou plusieurs surfaces dans la 3D, puis dites ce qu’elles sont (miroir, vitre, lumière) ou changez leur couleur
          et leur finition.
        </p>
        <button
          type="button"
          onClick={togglePicking}
          className={`w-full rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
            picking
              ? 'border-[var(--rm-primary)] bg-[var(--rm-primary)] text-[var(--rm-surface)]'
              : 'border-[var(--rm-text)]/15 bg-[var(--rm-bg)] text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50'
          }`}
        >
          {picking ? 'Cliquez les surfaces dans la 3D… (terminer)' : 'Choisir des surfaces dans la 3D'}
        </button>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ou chercher un matériau par son nom"
          className="w-full rounded-lg border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-3 py-2 text-[var(--rm-text)] placeholder:text-[var(--rm-muted)]"
        />
        {results.length > 0 && (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {results.map(m => (
              <li key={m.name}>
                <button
                  type="button"
                  onClick={() => toggle(m.name)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--rm-text)]/6 ${selection.includes(m.name) ? 'bg-[var(--rm-text)]/10' : ''}`}
                >
                  <input type="checkbox" readOnly checked={selection.includes(m.name)} className="pointer-events-none" />
                  <Swatch color={edits[m.name]?.color ?? m.color} textured={!edits[m.name]?.color && m.textured} />
                  <span className="min-w-0 flex-1 truncate text-[var(--rm-text)]">{m.name}</span>
                  {edits[m.name] && <span className="shrink-0">{summary(edits[m.name])}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selection.length > 0 && (
          <div className="space-y-2.5 rounded-lg border border-[var(--rm-primary)]/40 bg-[var(--rm-bg)] p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--rm-text)]">
                {selection.length} matériau{selection.length > 1 ? 'x' : ''} · en orange dans la 3D
              </span>
              <button type="button" onClick={() => select([])} className="px-1 hover:text-[var(--rm-text)]">
                Vider
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {selection.map(name => (
                <span key={name} className="flex max-w-full items-center gap-1 rounded-md bg-[var(--rm-text)]/6 px-1.5 py-0.5">
                  <Swatch color={edits[name]?.color ?? byName.get(name)?.color} textured={!edits[name]?.color && byName.get(name)?.textured} />
                  <span className="max-w-[9rem] truncate text-[var(--rm-text)]" title={name}>
                    {name}
                  </span>
                  <button type="button" onClick={() => toggle(name)} className="hover:text-red-700" aria-label={`Retirer ${name}`}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
            {single && <p>{single.meshes} surface{single.meshes > 1 ? 's' : ''} · Auto = {autoRole(single)}</p>}

            <div>
              <p className="mb-1 font-medium text-[var(--rm-text)]">C’est…</p>
              <div className="grid grid-cols-5 gap-1">
                {MATERIAL_ROLES.map(role => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => apply({ role })}
                    className={`rounded-md px-1 py-1.5 text-[11px] transition-all ${
                      selectedRole === role
                        ? 'bg-[var(--rm-primary)] font-semibold text-[var(--rm-surface)]'
                        : 'bg-[var(--rm-text)]/6 text-[var(--rm-text)] hover:bg-[var(--rm-text)]/12'
                    }`}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 font-medium text-[var(--rm-text)]">Couleur</p>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selectedColor ?? draftColor}
                  onChange={e => {
                    setDraftColor(e.target.value)
                    for (const name of selection) previewMaterialColor(name, e.target.value)
                  }}
                  className="h-8 w-10 cursor-pointer rounded border border-[var(--rm-text)]/15 bg-transparent"
                  aria-label="Choisir la couleur"
                />
                <button
                  type="button"
                  onClick={() => apply({ color: selectedColor ?? draftColor })}
                  className="rounded-md bg-[var(--rm-primary)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--rm-surface)]"
                >
                  Appliquer
                </button>
                <button
                  type="button"
                  onClick={() => apply({ color: null })}
                  className="rounded-md bg-[var(--rm-text)]/6 px-2.5 py-1.5 text-[11px] text-[var(--rm-text)] hover:bg-[var(--rm-text)]/12"
                >
                  Couleur d’origine
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1 font-medium text-[var(--rm-text)]">Finition</p>
              <div className="grid grid-cols-4 gap-1">
                {[null, ...FINISHES].map(finish => (
                  <button
                    key={finish ?? 'auto'}
                    type="button"
                    onClick={() => apply({ finish })}
                    className={`rounded-md px-1 py-1.5 text-[11px] transition-all ${
                      selectedFinish === finish
                        ? 'bg-[var(--rm-primary)] font-semibold text-[var(--rm-surface)]'
                        : 'bg-[var(--rm-text)]/6 text-[var(--rm-text)] hover:bg-[var(--rm-text)]/12'
                    }`}
                  >
                    {finish ? FINISH_LABELS[finish] : 'D’origine'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {edited.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-[var(--rm-text)]">Matériaux modifiés</p>
            <ul className="space-y-1">
              {edited.map(([name, edit]) => (
                <li key={name} className="flex items-center gap-2">
                  {edit.color && <Swatch color={edit.color} />}
                  <button type="button" onClick={() => select([name])} className="min-w-0 flex-1 truncate text-left text-[var(--rm-text)] hover:underline" title={name}>
                    {name}
                  </button>
                  <span className="shrink-0">{summary(edit)}</span>
                  <button type="button" onClick={() => reset(name)} className="shrink-0 px-1 hover:text-red-700" aria-label={`Remettre ${name} d’origine`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5">La prochaine capture utilise ces modifications : cliquez « Vérifier la vue » pour les voir.</p>
          </div>
        )}
        {error && <p className="rounded-md bg-red-50 px-2 py-1.5 text-red-700">{error}</p>}
      </div>
    </details>
  )
}
