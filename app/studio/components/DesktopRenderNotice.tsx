'use client'

import { useEffect, useState } from 'react'

/**
 * Roomia Desktop: what the next render costs on this PC. The app's graphics card test (desktop/engine.js) picked a
 * profile; the times are measured ones (2-3 Nov: RTX 3060 "balanced", Ryzen 5 5675U with no usable GPU "cpu"),
 * scaled for the other profiles, so they are orders of magnitude, not promises. Nothing shows in the web Studio.
 */
export interface DesktopEngine {
  backend: string
  profile: 'high' | 'balanced' | 'low' | 'cpu' | string
  gpu: string
  vramMb: number
  ramMb: number
}

let cached: Promise<DesktopEngine | null> | null = null

export function loadDesktopEngine(): Promise<DesktopEngine | null> {
  cached ??= fetch('/api/desktop/health')
    .then(res => (res.ok ? (res.json() as Promise<{ desktop?: boolean; engine?: DesktopEngine }>) : null))
    .then(data => (data?.desktop && data.engine ? data.engine : null))
    .catch(() => null)
  return cached
}

export function useDesktopEngine(): DesktopEngine | null {
  const [engine, setEngine] = useState<DesktopEngine | null>(null)
  useEffect(() => {
    let live = true
    void loadDesktopEngine().then(e => live && setEngine(e))
    return () => {
      live = false
    }
  }, [])
  return engine
}

/** Minutes for one view (EEVEE still) and per 360° point (Cycles), by profile. */
const MINUTES: Record<string, { view: [number, number]; point: [number, number] }> = {
  high: { view: [0.3, 1], point: [0.3, 0.8] },
  balanced: { view: [0.5, 1.5], point: [0.5, 1.2] },
  low: { view: [1, 3], point: [1, 3] },
  cpu: { view: [4, 8], point: [10, 30] },
}

const range = ([a, b]: [number, number], n = 1) => {
  const lo = a * n
  const hi = b * n
  const fmt = (m: number) => (m < 1 ? `${Math.max(10, Math.round((m * 60) / 10) * 10)} s` : m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0).replace('.', ',')} h`)
  return `${fmt(lo)} à ${fmt(hi)}`
}

export const BACKEND: Record<string, string> = { OPTIX: 'OptiX', CUDA: 'CUDA', HIP: 'HIP', ONEAPI: 'oneAPI', METAL: 'Metal', CPU: 'processeur' }
export const PROFILE: Record<string, string> = { high: 'puissant', balanced: 'équilibré', low: 'léger', cpu: 'processeur' }

/** The sentence about the time and the card, for a view or a tour of `points` viewpoints. */
export function renderEstimate(engine: DesktopEngine, kind: 'view' | 'tour', points = 8): string {
  const m = MINUTES[engine.profile] ?? MINUTES.balanced
  if (kind === 'view') return `Compter ${range(m.view)} pour cette vue sur ce PC.`
  return `Compter ${range(m.point, points)} pour environ ${points} points de vue, plus le plan (${range(m.point)} par point).`
}

export function isCpuOnly(engine: DesktopEngine | null): boolean {
  return engine?.profile === 'cpu' || engine?.backend === 'CPU'
}

/**
 * What a render does to this PC (16 Nov redesign: one quiet line, not a box). On a PC without a usable graphics card it is a
 * warning, because the render is much slower and the person should plug the charger in.
 */
export default function DesktopRenderNotice({ kind, points, className = '' }: { kind: 'view' | 'tour'; points?: number; className?: string }) {
  const engine = useDesktopEngine()
  if (!engine) return null
  if (isCpuOnly(engine))
    return (
      <p className={`ui-notice ui-notice--warn !text-[13px] ${className}`} role="note" style={{ maxWidth: 460, textAlign: 'left' }}>
        <span>
          <strong>Pas de carte graphique utilisable :</strong> le rendu se fait sur le processeur, beaucoup plus lentement. {renderEstimate(engine, kind, points)}{' '}
          Branchez le chargeur et ne mettez pas l’ordinateur en veille.
        </span>
      </p>
    )
  return (
    <p
      className={`desktop-render-notice ${className}`}
      role="note"
      title="La carte graphique tourne à pleine charge pendant le rendu : les autres logiciels 3D et les jeux sont plus lents. Sur un portable, branchez le chargeur."
      style={{ maxWidth: 460, margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--brand-muted)', textAlign: 'inherit' }}
    >
      Rendu sur votre carte graphique{engine.gpu ? ` (${engine.gpu})` : ''}. {renderEstimate(engine, kind, points)}
    </p>
  )
}
