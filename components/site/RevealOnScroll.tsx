'use client'

import { useEffect } from 'react'

/**
 * Fades and lifts every [data-reveal] element into place as it scrolls into view. Mount it once per page.
 * Elements already on screen when the page opens are never hidden, nothing is hidden without JS, and nothing moves for
 * visitors who ask for reduced motion. A `data-reveal="2"` value staggers siblings by that many steps.
 */
export default function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    const fold = window.innerHeight * 0.92
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.classList.add('is-in')
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    for (const el of els) {
      if (el.getBoundingClientRect().top < fold) continue
      const step = Number(el.dataset.reveal)
      if (step > 0) el.style.setProperty('--reveal-delay', `${Math.min(step, 6) * 0.08}s`)
      el.classList.add('is-armed')
      io.observe(el)
    }
    return () => io.disconnect()
  }, [])
  return null
}
