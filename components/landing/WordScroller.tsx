'use client'

import { useEffect, useRef } from 'react'

/** Position of word i for a scroll offset: distance from the centre row, and the blur, fade and scale that follow from it. */
function frame(i: number, offset: number, n: number) {
  const d = ((((i - offset + n / 2) % n) + n) % n) - n / 2
  const a = Math.abs(d)
  return {
    '--d': d.toFixed(3),
    '--b': (Math.min(a, 1.8) * 6).toFixed(2),
    '--o': Math.max(0, 1 - a * 0.55).toFixed(3),
    '--s': (1 - 0.08 * Math.min(a, 2)).toFixed(3),
  } as Record<string, string>
}

const STEP_MS = 1900
const HOLD = 0.58
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** A vertical word carousel: one word sharp in the middle, its neighbours blurred and faded, moving one word at a time. */
export default function WordScroller({ words, label }: { words: string[]; label: string }) {
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  const n = words.length

  useEffect(() => {
    const paint = (offset: number) =>
      refs.current.forEach((el, i) => {
        if (!el) return
        for (const [k, v] of Object.entries(frame(i, offset, n))) el.style.setProperty(k, v)
      })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let start: number | null = null
    const tick = (now: number) => {
      if (start === null) start = now
      const t = now - start
      const step = Math.floor(t / STEP_MS)
      const phase = (t % STEP_MS) / STEP_MS
      paint(step + (phase < HOLD ? 0 : ease((phase - HOLD) / (1 - HOLD))))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n])

  return (
    <div className="scroller">
      <ul className="sr-only" aria-label={label}>
        {words.map(w => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <div className="window" aria-hidden="true">
        {words.map((w, i) => (
          <span key={w} ref={el => void (refs.current[i] = el)} style={frame(i, 0, n)}>
            {w}
          </span>
        ))}
      </div>
    </div>
  )
}
