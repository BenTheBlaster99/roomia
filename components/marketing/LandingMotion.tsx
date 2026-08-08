'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

const HERO_PHOTO =
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=2400&q=80'

const PATH_PHOTOS = [
  'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1615874959471-d45adb0d4f0e?auto=format&fit=crop&w=1600&q=80',
]

export function PhotoHero() {
  const t = useTranslations('home')

  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <Image
        src={HERO_PHOTO}
        alt=""
        fill
        priority
        className="object-cover scale-105 rm-kenburns"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--rm-ink)]/88 via-[var(--rm-ink)]/55 to-[var(--rm-ink)]/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--rm-ink)]/70 via-transparent to-[var(--rm-ink)]/30" />

      <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-16 pt-28 md:justify-center md:px-6 md:pb-24">
        <div className="max-w-xl text-[var(--rm-surface)] md:max-w-lg">
          <p className="rm-rise rm-display text-[clamp(3.5rem,12vw,7rem)] font-bold leading-[0.88] tracking-tight">
            roomia
          </p>
          <h1 className="rm-rise rm-rise-delay-1 rm-display mt-6 text-[clamp(1.85rem,4.2vw,3.1rem)] font-semibold leading-[1.12]">
            {t('headline1')}
            <br />
            {t('headline2')}
          </h1>
          <p className="rm-rise rm-rise-delay-2 mt-5 max-w-md text-base leading-relaxed text-[var(--rm-surface)]/75 md:text-lg">
            {t('sub')}
          </p>
          <div className="rm-rise rm-rise-delay-3 mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/generateur" className="rm-btn-accent px-8 py-3.5 text-base">
              {t('ctaPrimary')}
            </Link>
            <a
              href="/studio"
              className="inline-flex items-center justify-center rounded-[0.65rem] border border-white/30 bg-white/10 px-8 py-3.5 text-base font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
            >
              {t('path3dTitle')}
            </a>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[var(--rm-surface)]/55 md:flex">
        <span className="text-[10px] uppercase tracking-[0.25em]">{t('scroll')}</span>
        <span className="rm-scroll-pulse h-8 w-px bg-[var(--rm-surface)]/50" />
      </div>
    </section>
  )
}

export function PhotoSettleSection() {
  const t = useTranslations('home')

  return (
    <section className="relative overflow-hidden border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-5 py-24 md:px-6">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('settleEyebrow')}
          </p>
          <h2 className="rm-display mt-4 text-3xl font-bold tracking-tight md:text-5xl">
            {t('settleTitle1')}
            <br />
            {t('settleTitle2')}
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-[var(--rm-muted)]">
            {t('settleBody')}
          </p>
          <a href="/studio" className="rm-btn-primary mt-8 inline-flex px-8 py-3.5">
            {t('settleCta')}
          </a>
        </div>

        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[1.25rem] shadow-[0_30px_80px_-30px_rgba(14,23,20,0.45)] ring-1 ring-[var(--rm-text)]/10">
          <Image
            src="/marketing/float-dining.png"
            alt=""
            fill
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 512px"
          />
        </div>
      </div>
    </section>
  )
}

/** Two stacked scroll panels that slide up over each other */
export function StackedPaths() {
  const t = useTranslations('home')

  const paths = [
    {
      href: '/generateur',
      kicker: t('pathAiKicker'),
      title: t('pathAiTitle'),
      desc: t('pathAiDesc'),
      cta: t('pathAiCta'),
      photo: PATH_PHOTOS[0],
      external: false,
    },
    {
      href: '/studio',
      kicker: t('path3dKicker'),
      title: t('path3dTitle'),
      desc: t('path3dDesc'),
      cta: t('path3dCta'),
      photo: PATH_PHOTOS[1],
      external: true,
    },
  ]

  return (
    <section className="relative bg-[var(--rm-bg)]">
      <div className="mx-auto max-w-6xl px-5 pt-16 pb-6 md:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
          {t('pathsEyebrow')}
        </p>
        <h2 className="rm-display mt-3 text-3xl font-bold tracking-tight md:text-5xl">
          {t('pathsTitle')}
        </h2>
        <p className="mt-3 max-w-lg text-[var(--rm-muted)]">{t('pathsSub')}</p>
      </div>

      <div className="relative">
        {paths.map((path, index) => (
          <div
            key={path.href}
            className="rm-stack-panel sticky top-16 z-[calc(10+var(--i))] min-h-[85svh] px-5 pb-8 md:px-6"
            style={{ ['--i' as string]: index }}
          >
            <div className="relative mx-auto flex min-h-[78svh] max-w-6xl overflow-hidden rounded-[1.75rem] shadow-[0_30px_80px_-40px_rgba(14,23,20,0.55)]">
              <Image
                src={path.photo}
                alt=""
                fill
                className="object-cover"
                sizes="100vw"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--rm-ink)]/90 via-[var(--rm-ink)]/55 to-[var(--rm-ink)]/20" />
              <div className="relative z-10 flex w-full flex-col justify-end p-8 md:p-14 text-[var(--rm-surface)]">
                <span className="font-mono text-sm text-[var(--rm-accent)]">{path.kicker}</span>
                <h3 className="rm-display mt-3 text-4xl font-bold tracking-tight md:text-6xl">
                  {path.title}
                </h3>
                <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--rm-surface)]/75 md:text-lg">
                  {path.desc}
                </p>
                {path.external ? (
                  <a href={path.href} className="rm-btn-accent mt-8 inline-flex w-fit px-8 py-3.5">
                    {path.cta}
                  </a>
                ) : (
                  <Link href={path.href} className="rm-btn-accent mt-8 inline-flex w-fit px-8 py-3.5">
                    {path.cta}
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Spacer so last panel can finish stacking */}
      <div className="h-[20vh]" aria-hidden />
    </section>
  )
}
