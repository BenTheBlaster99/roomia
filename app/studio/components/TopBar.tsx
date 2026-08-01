'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useStudioStore } from '@/store/useStudioStore'

export default function TopBar() {
  const [saveLabel, setSaveLabel] = useState('💾 Save')
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
    'text-xs text-zinc-600 hover:text-zinc-900 px-2.5 py-1.5 border border-zinc-200 rounded-lg hover:border-zinc-300 bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed'

  function saveDesign() {
    const { room, items } = useStudioStore.getState()
    localStorage.setItem(
      'roomia:studio-design',
      JSON.stringify({
        room,
        items,
        savedAt: new Date().toISOString(),
      }),
    )
    setSaveLabel('✓ Saved')
    window.setTimeout(() => setSaveLabel('💾 Save'), 1500)
  }

  return (
    <div className="h-14 bg-white border-b border-zinc-200 flex items-center justify-between px-4 flex-shrink-0 z-10">
      <div className="flex items-center gap-2 sm:gap-3">
        <Link href="/" className="text-lg font-bold text-amber-600 tracking-tight">
          roomia
        </Link>

        <div className="hidden sm:block w-px h-5 bg-zinc-200" />

        <button onClick={undo} disabled={!isUndoable} title="Undo (Ctrl+Z)" className={btn}>
          ↩ Undo
        </button>
        <button onClick={redo} disabled={!isRedoable} title="Redo (Ctrl+Y)" className={btn}>
          ↪ Redo
        </button>

        <div className="hidden sm:block w-px h-5 bg-zinc-200" />

        <button onClick={() => setRoomSettingsOpen(true)} className={btn}>
          ⚙ Room
        </button>

        <button
          onClick={() => {
            if (window.confirm('Clear all furniture from the room?')) clearRoom()
          }}
          className={`${btn} hover:border-red-300 hover:text-red-600`}
        >
          🗑 Clear
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleCatalog}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            catalogOpen
              ? 'border-amber-500 text-amber-700 bg-amber-50'
              : btn
          }`}
        >
          📦 Catalog
        </button>

        <Link href="/room-capture" className={`hidden sm:inline ${btn}`}>
          📷 Scan Room
        </Link>

        <Link href="/configure" className={`hidden sm:inline ${btn}`}>
          📐 Floor plan
        </Link>

        <Link href="/marketplace" className={`hidden md:inline ${btn}`}>
          🛒 Shop
        </Link>

        <button onClick={saveDesign} className={`hidden md:inline ${btn}`}>
          {saveLabel}
        </button>

        <button
          type="button"
          onClick={() => setRenderPanelOpen(true)}
          className="hidden sm:inline text-xs px-3 py-1.5 border border-amber-300 rounded-lg text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
        >
          ✨ Render Photo
        </button>

        <a href="mailto:contact@roomia.dz" className={`hidden lg:inline ${btn}`}>
          📅 Book
        </a>

        <button
          onClick={() => setCartOpen(true)}
          className="flex items-center gap-2 text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 transition-colors"
        >
          🛒
          {cartCount > 0 && (
            <span className="bg-white text-amber-600 text-xs px-1.5 py-0.5 rounded-full font-bold">
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
