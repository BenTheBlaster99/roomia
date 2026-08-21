'use client'

import { useState } from 'react'
import Link from 'next/link'
import { saveStudioDesign } from '@/lib/studio-design-storage'
import { useStudioStore } from '@/store/useStudioStore'

export default function TopBar() {
  const [saveLabel, setSaveLabel] = useState('Save')
  const {
    cart,
    catalogOpen,
    toggleCatalog,
    setRoomSettingsOpen,
    undo,
    redo,
    canUndo,
    canRedo,
    clearRoom,
    setCartOpen,
    setRenderPanelOpen,
  } = useStudioStore()
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0)
  const cartTotal = useStudioStore(s => s.cartTotal())
  const isUndoable = canUndo()
  const isRedoable = canRedo()

  const btn =
    'text-xs text-[var(--rm-muted)] hover:text-[var(--rm-text)] px-2.5 py-1.5 border border-[var(--rm-text)]/12 rounded-lg hover:border-[var(--rm-primary)]/35 bg-[var(--rm-surface)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed'

  function saveDesign() {
    const { room, items } = useStudioStore.getState()
    saveStudioDesign(room, items)
    const url = new URL(window.location.href)
    url.searchParams.set('saved', '1')
    window.history.replaceState({}, '', url.toString())
    setSaveLabel('Saved')
    window.setTimeout(() => setSaveLabel('Save'), 1500)
  }

  return (
    <div className="h-14 bg-[var(--rm-bg)]/90 backdrop-blur-xl border-b border-[var(--rm-text)]/8 flex items-center justify-between px-4 flex-shrink-0 z-10">
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight text-[var(--rm-primary)]"
        >
          roomia
        </Link>

        <div className="hidden sm:block w-px h-5 bg-[var(--rm-text)]/12" />

        <button onClick={undo} disabled={!isUndoable} title="Undo (Ctrl+Z)" className={btn}>
          Undo
        </button>
        <button onClick={redo} disabled={!isRedoable} title="Redo (Ctrl+Y)" className={btn}>
          Redo
        </button>

        <div className="hidden sm:block w-px h-5 bg-[var(--rm-text)]/12" />

        <button onClick={() => setRoomSettingsOpen(true)} className={btn}>
          Room
        </button>

        <button
          onClick={() => {
            if (window.confirm('Clear all furniture from the room?')) clearRoom()
          }}
          className={`${btn} hover:border-red-300 hover:text-red-700`}
        >
          Clear
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleCatalog}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            catalogOpen
              ? 'border-[var(--rm-primary)] text-[var(--rm-primary)] bg-[var(--rm-secondary)]'
              : btn
          }`}
        >
          Catalog
        </button>

        <Link href="/room-composer" className={`hidden sm:inline ${btn}`}>
          Compose
        </Link>

        <Link href="/configure" className={`hidden sm:inline ${btn}`}>
          Floor plan
        </Link>

        <Link href="/marketplace" className={`hidden md:inline ${btn}`}>
          Shop
        </Link>

        <button onClick={saveDesign} className={`hidden md:inline ${btn}`}>
          {saveLabel}
        </button>

        <button
          type="button"
          onClick={() => setRenderPanelOpen(true)}
          className="hidden sm:inline text-xs px-3 py-1.5 border border-[var(--rm-accent)]/40 rounded-lg text-[var(--rm-ink)] bg-[var(--rm-accent)]/20 hover:bg-[var(--rm-accent)]/35 transition-colors font-semibold"
        >
          Render Photo
        </button>

        <button
          onClick={() => setCartOpen(true)}
          className="flex items-center gap-2 text-xs px-3 py-1.5 bg-[var(--rm-primary)] text-[var(--rm-surface)] rounded-lg font-bold hover:brightness-110 transition-colors"
        >
          Cart
          {cartCount > 0 && (
            <span className="bg-[var(--rm-surface)] text-[var(--rm-primary)] text-xs px-1.5 py-0.5 rounded font-bold">
              {cartCount}
            </span>
          )}
          {cartTotal > 0 && (
            <span className="font-normal hidden sm:inline">{cartTotal.toLocaleString()} DZD</span>
          )}
        </button>
      </div>
    </div>
  )
}
