import Link from 'next/link'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />

      <section className="relative overflow-hidden">
        <HaikeiBackdrop variant="hero" />
        <div className="relative mx-auto max-w-3xl px-5 pb-20 pt-20 md:px-6 md:pt-28">
          <p className="rm-rise text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            About
          </p>
          <h1 className="rm-rise rm-rise-delay-1 rm-display mt-4 text-5xl font-bold tracking-tight text-[var(--rm-primary)] md:text-6xl">
            roomia
          </h1>
          <p className="rm-rise rm-rise-delay-2 mt-6 text-xl leading-relaxed text-[var(--rm-ink)] md:text-2xl">
            Interior design for Algerians who want a clear plan — not another endless catalog scroll.
          </p>
        </div>
      </section>

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-5 py-16 md:px-6">
        <div className="mx-auto max-w-3xl space-y-6 text-base leading-relaxed text-[var(--rm-muted)]">
          <p>
            Roomia is an interior design configurator built for people furnishing homes in Algeria.
            Scan a floor plan or a room photo, pick a style, arrange furniture in 3D, and walk away
            with a look you can actually buy.
          </p>
          <p>
            No designer fees. No overwhelming showrooms. Just your room — directed, visualized, and
            quote-ready.
          </p>
        </div>
      </section>

      <section className="px-5 py-20 md:px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="rm-display text-2xl font-bold tracking-tight md:text-3xl">The team</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            {[
              {
                role: 'Design & Architecture',
                name: 'Sarah',
                desc: 'Architect and interior designer. Every style, furniture recommendation, and budget range in Roomia comes from her expertise.',
                tone: 'var(--rm-accent)',
              },
              {
                role: 'Product & Engineering',
                name: 'Aimen',
                desc: 'Full-stack developer. Built Roomia from the ground up — the configurator, the AI pipelines, the whole experience.',
                tone: 'var(--rm-primary)',
              },
            ].map(({ role, name, desc, tone }) => (
              <div key={name} className="border-t-2 pt-6" style={{ borderColor: tone }}>
                <div className="rm-display text-2xl font-bold">{name}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rm-muted)]">
                  {role}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[var(--rm-muted)]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-[var(--rm-text)]/8 px-5 py-20 md:px-6">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-3xl">
          <h2 className="rm-display text-2xl font-bold tracking-tight md:text-3xl">
            Why we built this
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--rm-muted)]">
            Most people furnishing a home in Algeria have no structured tool. They scroll Instagram,
            visit stores with no plan, and either overspend or under-decorate. Roomia gives them what
            used to require an expensive consultation — a real design direction, instantly.
          </p>

          <div className="mt-12 rm-panel p-8">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rm-muted)]">
              Get in touch
            </h3>
            <p className="mt-3 text-sm text-[var(--rm-muted)]">
              Questions, feedback, or partnership inquiries — we read everything.
            </p>
            <a
              href="mailto:contact@roomia.dz"
              className="mt-4 inline-block text-sm font-bold text-[var(--rm-primary)] hover:underline"
            >
              contact@roomia.dz →
            </a>
          </div>

          <div className="mt-10">
            <Link href="/configure" className="rm-btn-primary px-10 py-3.5">
              Try Roomia
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
