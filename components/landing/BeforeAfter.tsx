'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

/** The hero wipe: the designer's 3D scene on the left, the Roomia photo on the right. On load the
 * line sweeps across once to show the change, then the visitor can drag it. */
export default function BeforeAfter({ before, after, beforeAlt, afterAlt }: { before: string; after: string; beforeAlt: string; afterAlt: string }) {
  const [pos, setPos] = useState(50)
  const touched = useRef(false)
  const loaded = useRef(0)
  const [ready, setReady] = useState(false)

  // Images already in the cache can finish before the page is interactive: don't wait on them forever.
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 2500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!ready ||window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const keys: [number, number][] = [[0, 50], [500, 50], [1500, 94], [3300, 6], [4400, 50]]
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    let start: number | null = null
    let frame = 0
    const tick = (now: number) => {
      if (touched.current) return
      if (start === null) start = now
      const t = now - start
      const i = keys.findIndex(k => k[0] > t)
      if (i === -1) return setPos(50)
      const [t0, v0] = keys[i - 1]
      const [t1, v1] = keys[i]
      setPos(v0 + (v1 - v0) * ease((t - t0) / (t1 - t0)))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ready])

  const onLoad = () => {
    loaded.current += 1
    if (loaded.current === 2) setReady(true)
  }

  return (
    <div className="wipe" style={{ '--pos': `${pos}%` } as React.CSSProperties}>
      <Image src={before} alt={beforeAlt} fill priority sizes="(max-width: 1212px) 100vw, 1180px" onLoad={onLoad} />
      <Image className="photo" src={after} alt={afterAlt} fill priority sizes="(max-width: 1212px) 100vw, 1180px" onLoad={onLoad} />
      <span className="tag l">Votre scène 3D</span>
      <span className="tag r">Photo Roomia</span>
      <div className="handle">
        <div className="knob" aria-hidden="true">⇆</div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(pos)}
        aria-label="Comparer la scène 3D et la photo Roomia"
        onChange={e => {
          touched.current = true
          setPos(Number(e.target.value))
        }}
      />
    </div>
  )
}
