'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

const HERO_PHOTO =
  'https://images.unsplash.com/photo-1600607687644-c7171b42498f?auto=format&fit=crop&w=2400&q=85'

const PATH_PHOTOS = [
  'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1600&q=80',
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1600&q=80',
]

function HeroCheck({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-[0.95rem] text-[var(--rm-surface)]/92">
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" aria-hidden>
        <path
          d="M3 8.2 6.2 11.4 13 4.4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </li>
  )
}

export function PhotoHero() {
  const t = useTranslations('home')

  return (
    <section className="rm-hero-pin">
      <div className="absolute inset-0">
        <Image
          src={HERO_PHOTO}
          alt=""
          fill
          priority
          className="object-cover object-[center_40%] scale-105 rm-kenburns"
          sizes="100vw"
        />
      </div>
      <div className="rm-hero-scrim-side absolute inset-0 bg-gradient-to-r from-[var(--rm-ink)]/88 via-[var(--rm-ink)]/52 to-transparent" />
      <div className="rm-hero-scrim-bottom absolute inset-0 bg-gradient-to-t from-[var(--rm-ink)]/50 via-transparent to-[var(--rm-ink)]/20" />
      <div className="rm-grain pointer-events-none absolute inset-0 opacity-[0.18]" />

      <div className="relative z-10 mx-auto flex h-full max-w-6xl items-end px-5 pb-10 pt-16 md:items-center md:px-6 md:pb-16">
        <div className="max-w-[36rem] text-[var(--rm-surface)] lg:max-w-[40rem]">
          <h1 className="rm-rise rm-display text-[clamp(1.7rem,4vw,3rem)] font-semibold leading-[1.16] tracking-tight text-pretty">
            {t('heroHeadlineBefore')}
            <span className="underline decoration-[var(--rm-surface)] decoration-2 underline-offset-[0.18em]">
              {t('heroHeadlineHighlight')}
            </span>
            {t('heroHeadlineAfter')}
          </h1>
          <p className="rm-hero-body rm-rise rm-rise-delay-1 mt-5 max-w-[34rem] text-[0.95rem] leading-[1.65] text-[var(--rm-surface)]/82 md:mt-6 md:text-[1.05rem] md:leading-[1.7]">
            {t.rich('heroBody', {
              brand: chunks => (
                <strong className="font-semibold text-[var(--rm-surface)]">{chunks}</strong>
              ),
            })}
          </p>
          <div className="rm-rise rm-rise-delay-2 mt-7 md:mt-9">
            <Link href="/contact#launch" className="rm-btn-primary w-full px-8 py-3.5 text-base md:w-auto">
              {t('heroNotifyCta')}
            </Link>
          </div>
          <ul className="rm-hero-checks rm-rise rm-rise-delay-3 mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-10">
            <HeroCheck label={t('heroCheck1')} />
            <HeroCheck label={t('heroCheck2')} />
          </ul>
        </div>
      </div>
    </section>
  )
}

/** A homepage sheet that slides up over the previous sticky layer. */
export function StackLayer({
  children,
  z,
  pin = true,
}: {
  children: ReactNode
  z: number
  pin?: boolean
}) {
  return (
    <div
      className={`rm-stack-layer ${pin ? 'rm-stack-layer-pin' : ''}`}
      style={{ zIndex: z }}
    >
      <div className={pin ? 'flex min-h-0 flex-1 flex-col' : undefined}>{children}</div>
    </div>
  )
}

/** @deprecated use StackLayer */
export function CoverSheet({ children }: { children: ReactNode }) {
  return (
    <StackLayer z={10} pin={false}>
      {children}
    </StackLayer>
  )
}

function PathCard({
  href,
  kicker,
  title,
  desc,
  cta,
  steps,
  photo,
  external,
}: {
  href: string
  kicker: string
  title: string
  desc: string
  cta: string
  steps: string[]
  photo: string
  external?: boolean
}) {
  const button = external ? (
    <a href={href} className="rm-btn-accent shrink-0 self-end px-6 py-3 text-sm md:text-base">
      {cta}
    </a>
  ) : (
    <Link href={href} className="rm-btn-accent shrink-0 self-end px-6 py-3 text-sm md:text-base">
      {cta}
    </Link>
  )

  return (
    <article className="rm-path-card group">
      <div className="rm-path-stage">
        <Image src={photo} alt="" fill className="rm-path-photo" sizes="(max-width: 768px) 100vw, 50vw" />
        <div className="rm-path-wash" />
        <ol className="rm-path-steps">
          {(steps ?? []).map((step, index) => (
            <li key={step} className="rm-path-step">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--rm-primary)] text-xs font-bold text-[var(--rm-surface)]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="text-[0.95rem] leading-relaxed text-[var(--rm-ink)]">{step}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="rm-path-copy">
        <div className="min-w-0">
          <span className="text-sm font-semibold tracking-[0.14em] text-[var(--rm-muted)]">
            {kicker}
          </span>
          <h3 className="rm-display mt-2 text-3xl font-bold tracking-tight text-[var(--rm-ink)] md:text-4xl">
            {title}
          </h3>
          <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--rm-muted)]">{desc}</p>
        </div>
        {button}
      </div>
    </article>
  )
}

export function StackedPaths() {
  const t = useTranslations('home')
  const aiSteps = Array.isArray(t.raw('pathAiSteps')) ? (t.raw('pathAiSteps') as string[]) : []
  const studioSteps = Array.isArray(t.raw('path3dSteps')) ? (t.raw('path3dSteps') as string[]) : []

  return (
    <StackLayer z={2}>
      <section className="flex h-full flex-col justify-center bg-[var(--rm-bg)] lg:pt-12">
        <div className="mx-auto w-full max-w-[92rem] px-5 pb-6 pt-7 text-left md:px-10 lg:pb-8 lg:pt-0 lg:text-center">
          <h2 className="rm-display text-[1.85rem] font-bold tracking-tight text-[var(--rm-ink)] md:text-5xl lg:text-6xl">
            {t('pathsTitle')}
          </h2>
          <p className="mx-auto mt-4 hidden max-w-3xl text-base leading-relaxed text-[var(--rm-muted)] lg:mt-5 lg:block md:text-lg">
            {t('pathsSub')}
          </p>
        </div>

        <div className="mx-auto grid w-full max-w-[92rem] flex-1 gap-4 px-5 pb-10 md:grid-cols-2 md:gap-7 md:px-10">
          <PathCard
            href="/generateur"
            kicker={t('pathAiKicker')}
            title={t('pathAiTitle')}
            desc={t('pathAiDesc')}
            cta={t('pathAiCta')}
            steps={aiSteps}
            photo={PATH_PHOTOS[0]}
          />
          <PathCard
            href="/studio"
            kicker={t('path3dKicker')}
            title={t('path3dTitle')}
            desc={t('path3dDesc')}
            cta={t('path3dCta')}
            steps={studioSteps}
            photo={PATH_PHOTOS[1]}
            external
          />
        </div>
      </section>
    </StackLayer>
  )
}
