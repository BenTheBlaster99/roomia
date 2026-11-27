'use client'

import { useEffect, useState } from 'react'
import { useStudioStore, type ViewMode } from '@/store/useStudioStore'
import { applySceneView } from '@/lib/studio-import/heavy-view-camera'
import { DEFAULT_LENS, lensHfov, type SceneCamera } from '@/lib/scene-cameras'
import { walkHome } from './walk-bridge'

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: 'perspective', label: '3D' },
  { mode: 'capture', label: 'Photo' },
  { mode: 'top', label: 'Haut' },
  { mode: 'front', label: 'Face' },
  { mode: 'back', label: 'Arrière' },
  { mode: 'left', label: 'Gauche' },
  { mode: 'right', label: 'Droite' },
]

const BAR = 'flex items-center gap-1 rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-surface)]/95 p-1 shadow-md backdrop-blur'
const CHIP = 'shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all sm:px-3'
const CHIP_OFF = 'text-[var(--rm-muted)] hover:bg-[var(--rm-secondary)] hover:text-[var(--rm-text)]'

export default function ViewControls() {
  const sceneId = useStudioStore(state => state.importedRoom?.sceneId ?? '')
  return sceneId ? <SceneWalkBar sceneId={sceneId} /> : <RoomViews />
}

/**
 * A project (18 Nov): it is walked through at eye level (WalkControls), so no overview and no top view. The bar takes you
 * to the file's own SketchUp scenes, and back to where the walk started.
 */
function SceneWalkBar({ sceneId }: { sceneId: string }) {
  const [cameras, setCameras] = useState<SceneCamera[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/scenes/${sceneId}/cameras`)
      .then(res => (res.ok ? (res.json() as Promise<{ cameras: SceneCamera[] }>) : null))
      .then(data => {
        if (data && !cancelled) setCameras(data.cameras)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sceneId])

  function goTo(index: number) {
    const camera = cameras[index]
    if (!camera) return
    applySceneView({ ...camera, hfov: lensHfov(DEFAULT_LENS, camera) })
    // for the side panel, which frames the photo from its own choice of scene
    window.dispatchEvent(new CustomEvent('roomia:scene-view', { detail: { index } }))
  }

  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex w-[min(92%,56rem)] -translate-x-1/2 flex-col items-center gap-2">
      <div className={`${BAR} max-w-full overflow-x-auto`}>
        <button type="button" onClick={() => walkHome()} title="Revenir au point de départ" className={`${CHIP} ${CHIP_OFF} font-semibold`}>
          Point de départ
        </button>
        {cameras.length > 0 && <span className="mx-0.5 h-5 w-px shrink-0 bg-[var(--rm-text)]/15" aria-hidden="true" />}
        {cameras.map((camera, i) => (
          <button key={`${camera.name}-${i}`} type="button" onClick={() => goTo(i)} title={`Aller à « ${camera.name} »`} className={`${CHIP} ${CHIP_OFF}`}>
            {camera.name}
          </button>
        ))}
      </div>
      <p className="hidden rounded-full bg-black/45 px-3 py-1 text-[10px] text-white/85 sm:block">
        Glisser = regarder · Molette ou ZQSD = avancer · Clic droit = se décaler · Double-clic au sol = y aller
      </p>
    </div>
  )
}

/** The empty studio room (no project): the orbit presets, as before. */
function RoomViews() {
  const { viewMode, setViewMode } = useStudioStore()

  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className={BAR}>
        {VIEWS.map(v => (
          <button
            key={v.mode}
            type="button"
            onClick={() => setViewMode(v.mode)}
            title={v.mode === 'capture' ? 'Vue photo (niveau des yeux)' : v.label}
            className={`${CHIP} ${viewMode === v.mode ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]' : CHIP_OFF}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="hidden rounded-full bg-black/45 px-3 py-1 text-[10px] text-white/85 sm:block">
        Glisser = orbit · Clic droit = pan · Molette = zoom · Mobile : 1 doigt = meuble · 2 doigts = orbit/zoom
      </p>
    </div>
  )
}
