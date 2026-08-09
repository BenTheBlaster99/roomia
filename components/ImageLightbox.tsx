'use client'

import { useEffect } from 'react'

/** Fullscreen image viewer — click backdrop or press Escape to close. */
export default function ImageLightbox({
  src,
  alt = 'Aperçu',
  onClose,
}: {
  src: string | null
  alt?: string
  onClose: () => void
}) {
  useEffect(() => {
    if (!src) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [src, onClose])

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
      >
        Fermer ✕
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[92vh] max-w-[96vw] object-contain shadow-2xl"
        onClick={e => e.stopPropagation()}
      />
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/50">
        Cliquez à l&apos;extérieur ou Échap pour fermer
      </p>
    </div>
  )
}
