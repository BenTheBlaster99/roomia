import Link from 'next/link'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'

export default function PartnersPage() {
  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="mailto:partners@roomia.dz?subject=Partnership Inquiry" ctaLabel="Partner with us" />

      <section className="relative min-h-[70svh] overflow-hidden">
        <HaikeiBackdrop variant="hero" />
        <div className="relative mx-auto flex min-h-[70svh] max-w-4xl flex-col justify-end px-5 pb-16 pt-24 md:justify-center md:px-6">
          <p className="rm-rise text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            For furniture brands & retailers
          </p>
          <h1 className="rm-rise rm-rise-delay-1 rm-display mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-[var(--rm-ink)] md:text-6xl">
            Put your products
            <br />
            in front of ready buyers.
          </h1>
          <p className="rm-rise rm-rise-delay-2 mt-6 max-w-xl text-base leading-relaxed text-[var(--rm-muted)] md:text-lg">
            When someone designs their home on Roomia, your catalog can be the recommendation.
            They click through. You pay commission — only on results.
          </p>
          <div className="rm-rise rm-rise-delay-3 mt-9">
            <a
              href="mailto:partners@roomia.dz?subject=Partnership Inquiry"
              className="rm-btn-accent px-8 py-3.5 text-base"
            >
              Contact partners
            </a>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-5 py-20 md:px-6">
        <div className="mx-auto max-w-4xl">
          <h2 className="rm-display text-3xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-12 space-y-0 divide-y divide-[var(--rm-text)]/10">
            {[
              {
                n: '01',
                title: 'We list your products',
                desc: 'Your catalog gets matched to the right styles, rooms, and budgets inside the configurator.',
              },
              {
                n: '02',
                title: 'Users discover them naturally',
                desc: 'A living-room design in a traditional style with a comfortable budget surfaces your sofa as the pick.',
              },
              {
                n: '03',
                title: 'They click through to your store',
                desc: 'Every product links to your site. The buyer lands on you, ready to purchase.',
              },
              {
                n: '04',
                title: 'You pay on sales only',
                desc: 'No upfront fees. No monthly subscription. Commission only when Roomia drives a purchase.',
              },
            ].map(({ n, title, desc }) => (
              <li key={n} className="grid gap-3 py-8 sm:grid-cols-[4rem_1fr] sm:gap-8">
                <span className="font-mono text-sm text-[var(--rm-accent)]">{n}</span>
                <div>
                  <h3 className="rm-display text-xl font-bold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--rm-muted)]">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-5 py-20 md:px-6">
        <div className="mx-auto max-w-4xl">
          <h2 className="rm-display text-3xl font-bold tracking-tight">Why it works for you</h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {[
              {
                title: 'Qualified traffic',
                desc: 'Every visitor already chose a style and a budget. They know what they want.',
              },
              {
                title: 'Zero risk',
                desc: 'You only pay when a Roomia user completes a purchase. No results, no cost.',
              },
              {
                title: 'First mover',
                desc: 'No other platform like this exists in Algeria. Early partners get the best placement.',
              },
            ].map(({ title, desc }) => (
              <div key={title}>
                <div className="mb-3 h-1 w-10 bg-[var(--rm-primary)]" />
                <h3 className="rm-display text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--rm-muted)]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-primary)] px-5 py-16 text-[var(--rm-surface)] md:px-6">
        <div className="mx-auto max-w-4xl">
          <h2 className="rm-display text-2xl font-bold">Who we work with</h2>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[var(--rm-surface)]/80">
            {[
              'Furniture stores',
              'Lighting brands',
              'Home décor retailers',
              'Textile & rug suppliers',
              'Kitchen & dining brands',
              'Local manufacturers',
              'Online furniture shops',
            ].map(tag => (
              <span key={tag} className="border-b border-[var(--rm-surface)]/25 pb-0.5">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-5 py-24 md:px-6">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-xl text-center">
          <h2 className="rm-display text-3xl font-bold tracking-tight md:text-4xl">
            Interested in partnering?
          </h2>
          <p className="mt-4 text-[var(--rm-muted)]">
            Send a message. We&apos;ll reply within 24 hours to walk through details and set up your
            catalog.
          </p>
          <a
            href="mailto:partners@roomia.dz?subject=Partnership Inquiry"
            className="rm-btn-primary mt-8 px-10 py-3.5"
          >
            Contact us
          </a>
          <p className="mt-4 text-xs text-[var(--rm-muted)]">partners@roomia.dz</p>
          <p className="mt-8 text-sm">
            <Link href="/" className="font-semibold text-[var(--rm-primary)] hover:underline">
              ← Back home
            </Link>
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
