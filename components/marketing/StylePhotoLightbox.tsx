'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { StylePhoto } from '@/lib/style-details'

type LightboxLabels = {
  close: string
  prev: string
  next: string
}

export default function StylePhotoLightbox({
  photos,
  name,
  labels,
  children,
}: {
  photos: StylePhoto[]
  name: string
  labels: LightboxLabels
  children: (openAt: (index: number) => void) => ReactNode
}) {
  const [index, setIndex] = useState<number | null>(null)
  const startX = useRef<number | null>(null)

  const total = photos.length
  const current = index === null ? null : photos[index]

  function openAt(nextIndex: number) {
    if (total === 0) return
    setIndex(((nextIndex % total) + total) % total)
  }

  function close() {
    setIndex(null)
  }

  function step(delta: number) {
    setIndex(currentIndex => {
      if (currentIndex === null || total < 2) return currentIndex
      return (currentIndex + delta + total) % total
    })
  }

  useEffect(() => {
    if (index === null) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [index, total])

  return (
    <>
      {children(openAt)}
      {current ? (
        <div
          className="rm-style-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={name}
          onClick={close}
        >
          <button type="button" className="rm-style-lightbox-close" onClick={close}>
            {labels.close}
          </button>
          {total > 1 ? (
            <button
              type="button"
              className="rm-style-lightbox-prev"
              aria-label={labels.prev}
              onClick={event => {
                event.stopPropagation()
                step(-1)
              }}
            >
              ‹
            </button>
          ) : null}
          <figure
            className="rm-style-lightbox-frame"
            onClick={event => event.stopPropagation()}
            onTouchStart={event => {
              startX.current = event.changedTouches[0]?.clientX ?? null
            }}
            onTouchEnd={event => {
              if (startX.current == null) return
              const dx = (event.changedTouches[0]?.clientX ?? startX.current) - startX.current
              startX.current = null
              if (dx > 40) step(-1)
              if (dx < -40) step(1)
            }}
          >
            <img src={current.src} alt={name} referrerPolicy="no-referrer" />
            {total > 1 && index !== null ? (
              <figcaption className="rm-style-lightbox-count">
                {index + 1} / {total}
              </figcaption>
            ) : null}
          </figure>
          {total > 1 ? (
            <button
              type="button"
              className="rm-style-lightbox-next"
              aria-label={labels.next}
              onClick={event => {
                event.stopPropagation()
                step(1)
              }}
            >
              ›
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
