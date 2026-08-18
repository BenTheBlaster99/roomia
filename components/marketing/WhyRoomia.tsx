'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

const STEP_COUNT = 4

type WhyItem = {
  title: string
  body: string
}

export default function WhyRoomia() {
  const t = useTranslations('home')
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  const items = (Array.isArray(t.raw('whyItems')) ? t.raw('whyItems') : []) as WhyItem[]
  const slides = items.slice(0, STEP_COUNT)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    let frame = 0

    function update() {
      frame = 0
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const nav = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--rm-nav-h'),
      ) || 72
      const scrolled = nav - rect.top
      const range = el.offsetHeight - (window.innerHeight - nav)
      const progress = range > 0 ? Math.min(0.999, Math.max(0, scrolled / range)) : 0
      const next = Math.min(slides.length - 1, Math.floor(progress * slides.length))
      setActive(current => (current === next ? current : next))
    }

    function onScroll() {
      if (frame) return
      frame = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [slides.length])

  return (
    <div ref={trackRef} className="rm-why-track">
      <section className="rm-why-panel">
        <div className="flex justify-center pt-4" aria-hidden>
          <span className="h-1 w-12 rounded-full bg-white/35" />
        </div>

        <div className="mx-auto flex h-[calc(100%-1.25rem)] max-w-[92rem] flex-col px-6 pb-8 pt-4 md:px-10">
          <h2 className="rm-display text-center text-4xl font-bold tracking-tight text-white md:text-5xl lg:text-6xl">
            {t('whyTitle')}
          </h2>

          <div className="mt-8 grid min-h-0 flex-1 gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
            <div className="rm-why-frame hidden h-full min-h-[22rem] lg:block" aria-hidden />

            <div className="relative grid min-h-[18rem] grid-cols-[2.5rem_1fr] gap-5 md:gap-8">
              <div className="relative mx-auto h-full w-10">
                <div className="absolute left-1/2 top-4 bottom-4 w-px -translate-x-1/2 bg-white/75" />
                <div
                  className="absolute left-1/2 top-4 w-px -translate-x-1/2 bg-white transition-[height] duration-500 ease-out"
                  style={{ height: `calc(${(active / Math.max(slides.length - 1, 1)) * 100}% - 1rem)` }}
                />
                <div className="relative z-10 flex h-full flex-col justify-between py-2">
                  {slides.map((item, index) => (
                    <span
                      key={item.title}
                      className={`mx-auto block rounded-full bg-white transition-all duration-500 ${
                        index === active
                          ? 'h-6 w-6 shadow-[0_0_0_6px_rgba(255,255,255,0.18)]'
                          : 'h-3 w-3 opacity-55'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="rm-why-copy">
                <div
                  className="rm-why-copy-track"
                  style={{ transform: `translateY(-${active * 20}rem)` }}
                >
                  {slides.map(item => (
                    <div key={item.title} className="rm-why-slide">
                      <h3 className="rm-display text-3xl font-bold tracking-tight text-white md:text-4xl">
                        {item.title}
                      </h3>
                      <p className="mt-4 max-w-xl text-base leading-relaxed text-white/85 md:text-lg">
                        {item.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Link
              href="/contact#launch"
              className="inline-flex rounded-xl bg-[#e8efe9] px-6 py-3 text-sm font-bold text-[var(--rm-ink)] transition-transform hover:-translate-y-0.5 md:text-base"
            >
              {t('heroNotifyCta')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
