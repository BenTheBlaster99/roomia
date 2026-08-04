'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

/**
 * Broadway-style scroll companion: a photo follows the viewport while you scroll,
 * then eases into a settle dock when that section enters view.
 */
export default function ScrollPhotoCompanion({
  src = '/marketing/float-dining.png',
  alt = 'Roomia photorealistic room render',
}: {
  src?: string
  alt?: string
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const settleRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const stateRef = useRef({
    scroll: 0,
    soft: 0,
    x: 0,
    y: 0,
    rot: -8,
    scale: 1,
    settled: 0,
  })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setReady(true)
      return
    }

    const frame = frameRef.current
    const settle = settleRef.current
    if (!frame || !settle) return

    const onScroll = () => {
      stateRef.current.scroll = window.scrollY
    }

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

    let seeded = false

    const tick = () => {
      const s = stateRef.current
      s.soft = lerp(s.soft, s.scroll, 0.085)

      const settleRect = settle.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      // Floating start (hero, right side)
      const startW = Math.min(400, vw * 0.36)
      const startH = startW * 1.2
      const startX = vw - startW - Math.max(28, vw * 0.05)
      const startY = Math.max(110, vh * 0.18)

      // Dock target in settle section
      const dockW = settleRect.width
      const dockX = settleRect.left
      const dockY = settleRect.top

      // Progress: 0 while high on the page, ramps as settle enters view — then locks
      const settleCenter = settleRect.top + settleRect.height * 0.4
      const raw = 1 - settleCenter / (vh * 0.68)
      const progress = easeOutCubic(clamp(raw, 0, 1))

      // Feather drift while free — scroll-linked sway + tilt (Broadway-style follow)
      const freeX = startX + Math.sin(s.soft * 0.0024) * 22 - Math.min(s.soft * 0.02, 40)
      const freeY = startY + Math.min(s.soft * 0.28, vh * 0.55) + Math.sin(s.soft * 0.003) * 10
      const freeRot = -10 + Math.sin(s.soft * 0.002) * 7

      const targetX = lerp(freeX, dockX, progress)
      const targetY = lerp(freeY, dockY, progress)
      const targetRot = lerp(freeRot, 0, progress)
      const targetScale = lerp(1, dockW / startW, progress)

      if (!seeded) {
        s.x = targetX
        s.y = targetY
        s.rot = targetRot
        s.scale = targetScale
        seeded = true
        setReady(true)
      } else {
        s.x = lerp(s.x, targetX, 0.1)
        s.y = lerp(s.y, targetY, 0.1)
        s.rot = lerp(s.rot, targetRot, 0.09)
        s.scale = lerp(s.scale, targetScale, 0.09)
      }
      s.settled = progress

      frame.style.width = `${startW}px`
      frame.style.height = `${startH}px`
      frame.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) rotate(${s.rot}deg) scale(${s.scale})`
      frame.style.opacity = '1'
      frame.style.borderRadius = `${lerp(28, 18, progress)}px`
      settle.style.opacity = String(lerp(0.2, 0, progress))

      rafRef.current = requestAnimationFrame(tick)
    }

    stateRef.current.scroll = window.scrollY
    stateRef.current.soft = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <>
      {/* Floating companion — fixed layer, follows scroll then docks */}
      <div
        ref={frameRef}
        className={`pointer-events-none fixed left-0 top-0 z-30 hidden overflow-hidden shadow-[0_30px_80px_-20px_rgba(14,23,20,0.55)] ring-1 ring-white/20 md:block ${
          ready ? '' : 'opacity-0'
        }`}
        style={{
          willChange: 'transform',
          transformOrigin: 'top left',
        }}
        aria-hidden
      >
        <Image
          src={src}
          alt={alt}
          fill
          className="object-cover"
          sizes="420px"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--rm-ink)]/35 via-transparent to-transparent" />
      </div>

      {/* Settle dock — where the photo lands */}
      <div
        id="photo-settle"
        ref={settleRef}
        className="relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-[1.25rem] bg-[var(--rm-secondary)] md:max-w-lg"
      >
        {/* Fallback static image for mobile / reduced motion */}
        <Image
          src={src}
          alt={alt}
          fill
          className="object-cover md:opacity-0"
          sizes="(max-width: 768px) 100vw, 512px"
        />
      </div>
    </>
  )
}
