'use client'

import Image from 'next/image'
import Link from 'next/link'

const HERO_PHOTO =
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=2400&q=80'
const PATH_PHOTOS = [
  'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1615874959471-d45adb0d4f0e?auto=format&fit=crop&w=1200&q=80',
]

export function PhotoHero() {
  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <Image
        src={HERO_PHOTO}
        alt="Sunlit modern living room"
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
            Design the room.
            <br />
            Live the photo.
          </h1>
          <p className="rm-rise rm-rise-delay-2 mt-5 max-w-md text-base leading-relaxed text-[var(--rm-surface)]/75 md:text-lg">
            Scan your space, furnish with AI, arrange in 3D — built for Algerian homes.
          </p>
          <div className="rm-rise rm-rise-delay-3 mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/configure" className="rm-btn-accent px-8 py-3.5 text-base">
              Start designing
            </Link>
            <Link
              href="/room-composer"
              className="inline-flex items-center justify-center rounded-[0.65rem] border border-white/30 bg-white/10 px-8 py-3.5 text-base font-semibold text-white backdrop-blur-md transition hover:bg-white/20"
            >
              Furnish a photo
            </Link>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[var(--rm-surface)]/55 md:flex">
        <span className="text-[10px] uppercase tracking-[0.25em]">Scroll</span>
        <span className="rm-scroll-pulse h-8 w-px bg-[var(--rm-surface)]/50" />
      </div>
    </section>
  )
}

export function PhotoSettleSection() {
  return (
    <section className="relative overflow-hidden border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-5 py-24 md:px-6">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            Studio → photo
          </p>
          <h2 className="rm-display mt-4 text-3xl font-bold tracking-tight md:text-5xl">
            Watch the design
            <br />
            become a room.
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-[var(--rm-muted)]">
            Arrange furniture in 3D, then hit Render Photo — ControlNet keeps the layout, AI paints
            the light and materials. Below is a real Roomia render.
          </p>
          <Link href="/studio" className="rm-btn-primary mt-8 px-8 py-3.5">
            Open studio
          </Link>
        </div>

        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[1.25rem] shadow-[0_30px_80px_-30px_rgba(14,23,20,0.45)] ring-1 ring-[var(--rm-text)]/10">
          <Image
            src="/marketing/float-dining.png"
            alt="Roomia photorealistic dining room render"
            fill
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 512px"
          />
        </div>
      </div>
    </section>
  )
}

export function PhotoPaths() {
  const paths = [
    {
      href: '/room-composer',
      kicker: '01',
      title: 'Furnish a photo',
      desc: 'Tap spots in a real room. AI places catalog pieces — three variations.',
      photo: PATH_PHOTOS[0],
    },
    {
      href: '/configure',
      kicker: '02',
      title: 'Scan a floor plan',
      desc: 'Upload a plan, enter wall lengths, open the room in 3D.',
      photo: PATH_PHOTOS[1],
    },
    {
      href: '/studio',
      kicker: '03',
      title: 'Open the studio',
      desc: 'Arrange, render a photoreal still, build a quote-ready cart.',
      photo: PATH_PHOTOS[2],
    },
  ]

  return (
    <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-bg)] px-5 py-20 md:px-6">
      <div className="mx-auto max-w-6xl">
        <h2 className="rm-display text-3xl font-bold tracking-tight md:text-4xl">Three ways in</h2>
        <p className="mt-3 max-w-lg text-[var(--rm-muted)]">
          Photo, plan, or blank studio — pick how you enter.
        </p>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {paths.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              className="group relative overflow-hidden rounded-[1.25rem] rm-path-reveal"
              style={{ animationDelay: `${i * 0.08}s` }}
            >
              <div className="relative aspect-[4/5]">
                <Image
                  src={item.photo}
                  alt=""
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 33vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--rm-ink)]/90 via-[var(--rm-ink)]/35 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 text-[var(--rm-surface)]">
                  <span className="font-mono text-xs text-[var(--rm-accent)]">{item.kicker}</span>
                  <h3 className="rm-display mt-2 text-2xl font-bold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--rm-surface)]/75">
                    {item.desc}
                  </p>
                  <span className="mt-4 inline-block text-sm font-semibold">Continue →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
