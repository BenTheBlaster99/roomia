'use client'

import { useEffect } from 'react'
import { useStudioStore } from '@/store/useStudioStore'
import TopBar from './components/TopBar'
import CatalogSidebar from './components/CatalogSidebar'
import ViewControls from './components/ViewControls'
import SelectedPanel from './components/SelectedPanel'
import RoomSettings from './components/RoomSettings'
import RenderPanel from './components/RenderPanel'
import StudioEntryGate from './components/StudioEntryGate'
import StudioScene from './StudioScene'
import CartDrawer from '@/components/CartDrawer'

export default function Studio() {
  const catalogOpen = useStudioStore(s => s.catalogOpen)

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return

      const { undo, redo, selectedId, removeItem } = useStudioStore.getState()

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
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="h-screen w-screen bg-[var(--rm-bg)] flex flex-col overflow-hidden relative">
      <StudioEntryGate onEnterBlank={() => {}} />
      <TopBar />

      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 relative">
          <StudioScene />
          <ViewControls />
          <SelectedPanel />
          <RoomSettings />
          <RenderPanel />
        </div>

        {catalogOpen && (
          <div className="w-80 flex-shrink-0 border-l border-[var(--rm-text)]/10 overflow-hidden">
            <CatalogSidebar />
          </div>
        )}
      </div>
      <CartDrawer />
    </div>
  )
}
