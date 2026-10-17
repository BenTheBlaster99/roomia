'use client'

import { useEffect, useState } from 'react'
import { MATERIAL_ROLES, ROLE_LABELS, type MaterialRole, type MaterialRoles } from '@/lib/material-roles'
import {
  highlightSceneMaterial,
  listSceneMaterials,
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

function Swatch({ material }: { material?: SceneMaterialInfo }) {
  return (
    <span
      className="h-5 w-5 shrink-0 rounded-md border border-black/10"
      style={{ background: material?.color ?? '#ccc', backgroundImage: material?.textured ? 'linear-gradient(135deg,transparent 45%,rgba(0,0,0,.25) 50%,transparent 55%)' : undefined }}
      title={material?.textured ? 'Matériau avec texture' : undefined}
    />
  )
}

/**
 * Optional panel: the designer tells Roomia which materials are mirrors, glass or lights when the
 * file's names don't say it (Sarah's mirror is "*33"). Roles are saved with the scene and used by
 * the next capture.
 */
export default function MaterialRolesPanel({ sceneId }: { sceneId: string }) {
  const [roles, setRoles] = useState<MaterialRoles>({})
  const [materials, setMaterials] = useState<SceneMaterialInfo[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/scenes/${sceneId}/materials`)
      .then(res => (res.ok ? (res.json() as Promise<{ roles: MaterialRoles }>) : null))
      .then(data => {
        if (data && !cancelled) setRoles(data.roles)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sceneId])

  // Leave the 3D view as it was when the panel goes away.
  useEffect(
    () => () => {
      highlightSceneMaterial(null)
      setMaterialPickHandler(null)
    },
    [],
  )

  function select(name: string | null) {
    setSelected(name)
    highlightSceneMaterial(name)
  }

  function startPicking() {
    if (picking) {
      setPicking(false)
      setMaterialPickHandler(null)
      return
    }
    setMaterials(listSceneMaterials())
    setPicking(true)
    setMaterialPickHandler(name => {
      setPicking(false)
      setMaterialPickHandler(null)
      select(name)
    })
  }

  async function setRole(name: string, role: MaterialRole) {
    const next = { ...roles }
    if (role === 'auto') delete next[name]
    else next[name] = role
    setRoles(next)
    setError(null)
    const res = await fetch(`/api/scenes/${sceneId}/materials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: next }),
    }).catch(() => null)
    if (!res?.ok) setError('Le rôle n’a pas pu être enregistré. Réessayez.')
  }

  const byName = new Map(materials.map(m => [m.name, m]))
  const current = selected ? byName.get(selected) : undefined
  const results = query.trim()
    ? materials.filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 20)
    : []
  const set = Object.entries(roles)

  return (
    <details
      className="rounded-xl border border-[var(--rm-text)]/10 px-3 py-2.5 text-xs text-[var(--rm-muted)]"
      onToggle={e => {
        if ((e.target as HTMLDetailsElement).open) setMaterials(listSceneMaterials())
        else select(null)
      }}
    >
      <summary className="cursor-pointer select-none text-sm font-medium text-[var(--rm-text)]">
        Matériaux <span className="font-normal text-[var(--rm-muted)]">· optionnel{set.length ? ` · ${set.length} réglé${set.length > 1 ? 's' : ''}` : ''}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="leading-relaxed">
          Un miroir, une vitre ou une lumière mal reconnus ? Cliquez sur la surface dans la 3D et donnez-lui son rôle.
        </p>
        <button
          type="button"
          onClick={startPicking}
          className={`w-full rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
            picking
              ? 'border-[var(--rm-primary)] bg-[var(--rm-primary)] text-[var(--rm-surface)]'
              : 'border-[var(--rm-text)]/15 bg-[var(--rm-bg)] text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50'
          }`}
        >
          {picking ? 'Cliquez sur une surface dans la 3D… (annuler)' : 'Choisir une surface dans la 3D'}
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
                  onClick={() => select(m.name)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--rm-text)]/6 ${selected === m.name ? 'bg-[var(--rm-text)]/8' : ''}`}
                >
                  <Swatch material={m} />
                  <span className="min-w-0 flex-1 truncate text-[var(--rm-text)]">{m.name}</span>
                  {roles[m.name] && <span className="shrink-0 font-medium">{ROLE_LABELS[roles[m.name]]}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="rounded-lg border border-[var(--rm-primary)]/40 bg-[var(--rm-bg)] p-2.5">
            <div className="flex items-center gap-2">
              <Swatch material={current} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--rm-text)]" title={selected}>
                {selected}
              </span>
              <button type="button" onClick={() => select(null)} className="shrink-0 px-1 hover:text-[var(--rm-text)]" aria-label="Fermer">
                ✕
              </button>
            </div>
            <p className="mt-1">
              En orange dans la 3D{current ? ` · ${current.meshes} surface${current.meshes > 1 ? 's' : ''}` : ''}
              {current ? ` · Auto = ${autoRole(current)}` : ''}
            </p>
            <div className="mt-2 grid grid-cols-5 gap-1">
              {MATERIAL_ROLES.map(role => {
                const active = (roles[selected] ?? 'auto') === role
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => void setRole(selected, role)}
                    className={`rounded-md px-1 py-1.5 text-[11px] transition-all ${
                      active
                        ? 'bg-[var(--rm-primary)] font-semibold text-[var(--rm-surface)]'
                        : 'bg-[var(--rm-text)]/6 text-[var(--rm-text)] hover:bg-[var(--rm-text)]/12'
                    }`}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {set.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-[var(--rm-text)]">Rôles réglés</p>
            <ul className="space-y-1">
              {set.map(([name, role]) => (
                <li key={name} className="flex items-center gap-2">
                  <button type="button" onClick={() => select(name)} className="min-w-0 flex-1 truncate text-left text-[var(--rm-text)] hover:underline" title={name}>
                    {name}
                  </button>
                  <span className="shrink-0">{ROLE_LABELS[role]}</span>
                  <button type="button" onClick={() => void setRole(name, 'auto')} className="shrink-0 px-1 hover:text-red-700" aria-label={`Remettre ${name} en Auto`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5">La prochaine capture utilise ces rôles.</p>
          </div>
        )}
        {error && <p className="rounded-md bg-red-50 px-2 py-1.5 text-red-700">{error}</p>}
      </div>
    </details>
  )
}
