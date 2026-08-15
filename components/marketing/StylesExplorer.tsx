'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { STYLE_CARD_COLORS, STYLE_NAMES, STYLE_SLUG } from '@/lib/style-room-presentation'

export type StyleSection = {
  id: string
  name: string
  tagline: string
  description: string
  main_color: string
  accent_color: string
}

export default function StylesExplorer({ styles }: { styles: StyleSection[] }) {
  const t = useTranslations('stylesPage')
  const [activeId, setActiveId] = useState(styles[0]?.id ?? '')
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    if (!styles.length) return

    const observers: IntersectionObserver[] = []
    const ratios = new Map<string, number>()

    styles.forEach(style => {
      const el = sectionRefs.current[style.id]
      if (!el) return

      const observer = new IntersectionObserver(
        ([entry]) => {
          ratios.set(style.id, entry.isIntersecting ? entry.intersectionRatio : 0)
          let bestId = styles[0].id
          let bestRatio = -1
          for (const s of styles) {
            const r = ratios.get(s.id) ?? 0
            if (r > bestRatio) {
              bestRatio = r
              bestId = s.id
            }
          }
          if (bestRatio > 0) setActiveId(bestId)
        },
        { rootMargin: '-20% 0px -45% 0px', threshold: [0, 0.15, 0.35, 0.55, 0.75] },
      )
      observer.observe(el)
      observers.push(observer)
    })

    const hash = window.location.hash.replace(/^#/, '')
    if (hash && styles.some(s => s.id === hash)) {
      setActiveId(hash)
      sectionRefs.current[hash]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    return () => observers.forEach(o => o.disconnect())
  }, [styles])

  function scrollTo(id: string) {
    setActiveId(id)
    const el = sectionRefs.current[id]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.replaceState(null, '', `#${id}`)
  }

  if (!styles.length) {
    return <p className="text-[var(--rm-muted)]">{t('empty')}</p>
  }

  return (
    <div>
      <nav
        aria-label={t('miniNavLabel')}
        className="sticky top-[3.6rem] z-30 -mx-5 mb-10 border-y border-[var(--rm-text)]/8 bg-[var(--rm-bg)]/90 px-5 py-3 backdrop-blur-xl md:-mx-6 md:px-6"
      >
        <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {styles.map(style => {
            const active = activeId === style.id
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => scrollTo(style.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                    : 'bg-[var(--rm-surface)] text-[var(--rm-muted)] hover:text-[var(--rm-text)]'
                }`}
              >
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: style.accent_color }}
                  aria-hidden
                />
                {style.name}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="space-y-20 md:space-y-28">
        {styles.map((style, index) => {
          const colors = STYLE_CARD_COLORS[style.id] ?? {
            main: style.main_color,
            accent: style.accent_color,
          }
          const studioHref = `/studio?create=1&style=${encodeURIComponent(style.id)}`

          return (
            <section
              key={style.id}
              id={style.id}
              ref={el => {
                sectionRefs.current[style.id] = el
              }}
              className="scroll-mt-36"
            >
              <div className="grid items-stretch gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
                <div>
                  <p className="font-mono text-xs text-[var(--rm-accent)]">
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h2 className="rm-display mt-3 text-3xl font-bold tracking-tight md:text-5xl">
                    {style.name}
                  </h2>
                  <p className="mt-3 text-lg font-medium text-[var(--rm-primary)]">
                    {style.tagline}
                  </p>
                  <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--rm-muted)]">
                    {style.description}
                  </p>

                  <div className="mt-8 flex flex-wrap gap-3">
                    <a href={studioHref} className="rm-btn-primary text-sm">
                      {t('studio')}
                    </a>
                    <Link href="/quiz" className="rm-btn-secondary text-sm">
                      {t('quiz')}
                    </Link>
                    <Link href="/rooms" className="rm-btn-secondary text-sm">
                      {t('explore')}
                    </Link>
                  </div>
                </div>

                <div
                  className="relative min-h-[220px] overflow-hidden rounded-[1.25rem] ring-1 ring-[var(--rm-text)]/10"
                  style={{
                    background: `linear-gradient(145deg, ${colors.main} 0%, ${colors.accent} 100%)`,
                  }}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.22),transparent_45%)]" />
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <div className="flex gap-2">
                      <span
                        className="h-8 w-8 rounded-full ring-2 ring-white/40"
                        style={{ backgroundColor: style.main_color }}
                      />
                      <span
                        className="h-8 w-8 rounded-full ring-2 ring-white/40"
                        style={{ backgroundColor: style.accent_color }}
                      />
                    </div>
                    <p className="mt-4 text-sm font-semibold text-white/90 drop-shadow">
                      {style.name}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Fallback when Supabase returns nothing — keep page usable. */
export function fallbackStyleSections(): StyleSection[] {
  return STYLE_NAMES.map(name => {
    const id = STYLE_SLUG[name]
    const colors = STYLE_CARD_COLORS[id]
    return {
      id,
      name,
      tagline: '',
      description: '',
      main_color: colors?.main ?? '#888',
      accent_color: colors?.accent ?? '#666',
    }
  })
}
