'use client'

import { useEffect, useLayoutEffect } from 'react'
import { useStudioStore } from '@/store/useStudioStore'
import type { RoomPresetPayload } from '@/types/room-preset'
import type { StudioQuery } from './studio-query'
import StudioBootstrap from './StudioBootstrap'
import TopBar from './components/TopBar'
import CatalogSidebar from './components/CatalogSidebar'
import ViewControls from './components/ViewControls'
import SelectedPanel from './components/SelectedPanel'
import RoomSettings from './components/RoomSettings'
import RenderPanel from './components/RenderPanel'
import StudioEntryGate from './components/StudioEntryGate'
import StudioEmptyState from './components/StudioEmptyState'
import StudioScene from './StudioScene'
import CartDrawer from '@/components/CartDrawer'

export default function Studio({
  initialPreset,
  query,
}: {
  initialPreset: RoomPresetPayload | null
  query: StudioQuery
}) {
  const catalogOpen = useStudioStore(s => s.catalogOpen)
  const entryGateOpen = useStudioStore(s => s.entryGateOpen)
  const skipGate =
    Boolean(initialPreset) ||
    Boolean(query.preset) ||
    query.create === '1' ||
    Boolean(query.width) ||
    Boolean(query.length)

  useLayoutEffect(() => {
    if (initialPreset) {
      useStudioStore.getState().loadPreset(initialPreset)
    }
    useStudioStore.getState().setEntryGateOpen(!skipGate)
  }, [initialPreset, skipGate])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      if (useStudioStore.getState().entryGateOpen) return

      const { undo, redo, selectedId, removeItem, rotateItemBy } = useStudioStore.getState()

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        removeItem(selectedId)
      }
      if (selectedId && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        rotateItemBy(selectedId, e.key === ']' ? Math.PI / 12 : -Math.PI / 12)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--rm-bg)]">
      <StudioBootstrap initialPreset={initialPreset} query={query} />
      <StudioEntryGate skipGate={skipGate} onEnterBlank={() => {}} />

      {!entryGateOpen && (
        <>
          <TopBar />

          <div className="relative flex flex-1 overflow-hidden">
            <div className="relative flex-1">
              <StudioScene />
              <StudioEmptyState />
              <ViewControls />
              <SelectedPanel />
              <RoomSettings />
              <RenderPanel />
            </div>

            {catalogOpen && (
              <div className="w-80 flex-shrink-0 overflow-hidden border-l border-[var(--rm-text)]/10">
                <CatalogSidebar />
              </div>
            )}
          </div>
          <CartDrawer />
        </>
      )}
    </div>
  )
}
