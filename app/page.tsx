import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { MOCK_CATALOG } from '@/lib/mock-catalog'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'

export default async function LandingPage() {
  const [{ data: styles }, { data: presets, count: presetCount }] = await Promise.all([
    supabase.from('styles').select('id, name, tagline, main_color, accent_color'),
    supabase
      .from('room_presets')
      .select('id, name, room_type, style_id, room_config', { count: 'exact' })
      .order('style_id')
      .limit(4),
  ])

  const catalogCount = MOCK_CATALOG.filter(i => i.available).length
  const featuredPresets = presets ?? []

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900 overflow-x-hidden">

      <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white/90 backdrop-blur-md sticky top-0 z-30">
        <Link href="/" className="text-xl font-bold text-amber-600 tracking-tight">
          roomia
        </Link>
        <div className="hidden sm:flex items-center gap-6 text-sm">
          <Link href="/rooms" className="text-zinc-500 hover:text-zinc-900 transition-colors">
            Presets
          </Link>
          <Link href="/marketplace" className="text-zinc-500 hover:text-zinc-900 transition-colors">
            Catalog
          </Link>
          <Link href="/studio" className="text-zinc-500 hover:text-zinc-900 transition-colors">
            Studio
          </Link>
        </div>
        <Link
          href="/configure"
          className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold hover:bg-amber-600 transition-colors"
        >
          Start designing
        </Link>
      </nav>

      <section className="relative px-6 pt-16 pb-20 md:pt-24 md:pb-28 bg-white border-b border-zinc-100">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-amber-100/60 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-1.5 text-xs text-amber-800 font-medium mb-8">
            ✦ Interior design for Algeria
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.1] tracking-tight mb-6">
            Design your room in 3D.
            <br />
            <span className="text-amber-600">Shop the look.</span>
          </h1>

          <p className="text-zinc-600 text-base md:text-lg max-w-2xl mx-auto mb-12 leading-relaxed">
            Scan your space, pick a curated preset, or browse furniture — then arrange everything
            in the studio and request a quote.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left max-w-4xl mx-auto">
            <EntryCard
              href="/configure"
              emoji="📐"
              title="Design your room"
              desc="Enter dimensions, scan your floor plan, then open the 3D studio to place furniture."
              cta="Configure & scan →"
              featured
            />
            <EntryCard
              href="/rooms"
              emoji="🏠"
              title="Curated presets"
              desc={`${presetCount ?? 10} styled living rooms & bedrooms — open in the studio and customize.`}
              cta="Browse presets →"
            />
            <EntryCard
              href="/marketplace"
              emoji="🛋️"
              title="Furniture catalog"
              desc={`Browse ${catalogCount}+ pieces. Filter by room, style, and budget. Add to cart or studio.`}
              cta="Shop catalog →"
            />
          </div>

          <p className="mt-8 text-sm text-zinc-500">
            Already know your space?{' '}
            <Link href="/studio" className="text-amber-600 hover:text-amber-700 transition-colors underline-offset-2 hover:underline">
              Open studio directly
            </Link>
          </p>
        </div>
      </section>

      <section className="border-b border-zinc-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { value: String(styles?.length ?? 5), label: 'Design styles' },
            { value: String(presetCount ?? 10), label: 'Room presets' },
            { value: String(catalogCount), label: 'Catalog items' },
            { value: 'Free', label: 'To explore' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-bold text-amber-600">{value}</div>
              <div className="text-xs text-zinc-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {featuredPresets.length > 0 && (
        <section className="px-6 py-20 bg-stone-50">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-end justify-between gap-4 mb-10">
              <div>
                <h2 className="text-2xl md:text-3xl font-bold mb-2">Start from a preset</h2>
                <p className="text-sm text-zinc-500">Architect-curated rooms, ready to edit in 3D.</p>
              </div>
              <Link href="/rooms" className="text-sm text-amber-600 hover:text-amber-700 font-medium whitespace-nowrap">
                View all →
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {featuredPresets.map(preset => {
                const colors = STYLE_CARD_COLORS[preset.style_id ?? ''] ?? {
                  main: '#E8E4E0',
                  accent: '#9CA3AF',
                }
                const wall = preset.room_config?.wallColor ?? colors.main

                return (
                  <Link
                    key={preset.id}
                    href={`/studio?preset=${preset.id}`}
                    className="group rounded-2xl overflow-hidden border border-zinc-200 bg-white shadow-sm hover:shadow-md hover:border-amber-300 transition-all"
                  >
                    <div
                      className="aspect-[4/3] relative flex items-end p-3"
                      style={{
                        background: `linear-gradient(145deg, ${wall} 0%, ${colors.accent}66 100%)`,
                      }}
                    >
                      <span className="text-4xl absolute inset-0 flex items-center justify-center opacity-25 select-none">
                        {preset.room_type === 'Bedroom' ? '🛏' : '🛋'}
                      </span>
                      <span className="relative text-[10px] font-semibold uppercase tracking-wider text-zinc-800 bg-white/80 px-2 py-0.5 rounded">
                        {preset.room_type}
                      </span>
                    </div>
                    <div className="p-4">
                      <div className="font-semibold text-sm group-hover:text-amber-700 transition-colors truncate">
                        {preset.name}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">Open in studio →</div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      <section id="how-it-works" className="px-6 py-20 bg-white border-t border-zinc-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">How it works</h2>
            <p className="text-zinc-500 text-sm">Three ways in. One studio to finish.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { step: '01', title: 'Set up your space', desc: 'Scan a photo or enter room dimensions. Or skip straight to a curated preset.', icon: '📐', href: '/configure' },
              { step: '02', title: 'Arrange in 3D', desc: 'Drag furniture, swap styles, change floors and walls — all in the studio.', icon: '🎨', href: '/studio' },
              { step: '03', title: 'Build your cart', desc: 'Add pieces from the catalog, then request a quote by email.', icon: '🛒', href: '/marketplace' },
            ].map(({ step, title, desc, icon, href }) => (
              <Link
                key={step}
                href={href}
                className="bg-stone-50 border border-zinc-200 rounded-2xl p-6 hover:border-amber-200 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-3xl">{icon}</span>
                  <span className="text-xs font-mono text-zinc-400">{step}</span>
                </div>
                <h3 className="font-bold mb-2 group-hover:text-amber-700 transition-colors">{title}</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 bg-stone-50 border-t border-zinc-200">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">5 styles to explore</h2>
            <p className="text-zinc-500 text-sm">Curated palettes — each preset and catalog piece is tagged by style.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {styles?.map(style => (
              <Link
                key={style.id}
                href="/rooms"
                className="group bg-white rounded-2xl p-5 border border-zinc-200 hover:border-amber-300 shadow-sm hover:shadow transition-all"
              >
                <div className="flex gap-2 mb-4">
                  <div className="h-8 flex-1 rounded-lg border border-zinc-100" style={{ backgroundColor: style.main_color }} />
                  <div className="h-8 w-8 rounded-lg flex-shrink-0 border border-zinc-100" style={{ backgroundColor: style.accent_color }} />
                </div>
                <div className="font-bold text-sm mb-1 group-hover:text-amber-700 transition-colors">{style.name}</div>
                <div className="text-xs text-zinc-500">{style.tagline}</div>
              </Link>
            ))}

            <Link
              href="/marketplace"
              className="bg-amber-50 border border-amber-200 rounded-2xl p-5 hover:bg-amber-100/80 transition-all flex flex-col items-center justify-center text-center gap-2 min-h-[140px]"
            >
              <span className="text-2xl">🛋️</span>
              <span className="text-sm font-bold text-amber-700">Browse catalog</span>
              <span className="text-xs text-zinc-500">Filter by style & room</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 py-20 bg-white border-t border-zinc-200">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Ready to design
            <br />
            your space?
          </h2>
          <p className="text-zinc-600 mb-10 text-sm leading-relaxed">
            Free to explore. No account needed.
            <br />
            Scan, preset, or shop — then make it yours in the studio.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/configure"
              className="w-full sm:w-auto px-10 py-4 bg-amber-500 text-white rounded-xl text-base font-bold hover:bg-amber-600 transition-colors"
            >
              Start designing →
            </Link>
            <Link
              href="/marketplace"
              className="w-full sm:w-auto px-10 py-4 border border-zinc-200 rounded-xl text-base text-zinc-700 hover:border-amber-300 hover:text-amber-700 transition-all bg-white"
            >
              Browse catalog
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-200 px-6 py-8 bg-stone-50">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <span className="font-bold text-zinc-700">roomia</span>
          <div className="flex flex-wrap justify-center gap-6">
            <Link href="/rooms" className="hover:text-zinc-800 transition-colors">Presets</Link>
            <Link href="/marketplace" className="hover:text-zinc-800 transition-colors">Catalog</Link>
            <Link href="/studio" className="hover:text-zinc-800 transition-colors">Studio</Link>
            <Link href="/about" className="hover:text-zinc-800 transition-colors">About</Link>
            <Link href="/partners" className="hover:text-zinc-800 transition-colors">Partners</Link>
            <a href="mailto:contact@roomia.dz" className="hover:text-zinc-800 transition-colors">Contact</a>
          </div>
          <span>© 2026 Roomia · Algeria</span>
        </div>
      </footer>
    </div>
  )
}

function EntryCard({
  href,
  emoji,
  title,
  desc,
  cta,
  featured = false,
}: {
  href: string
  emoji: string
  title: string
  desc: string
  cta: string
  featured?: boolean
}) {
  return (
    <Link
      href={href}
      className={`group rounded-2xl p-6 border transition-all flex flex-col h-full shadow-sm ${
        featured
          ? 'bg-amber-50 border-amber-200 hover:border-amber-400 hover:shadow-md'
          : 'bg-white border-zinc-200 hover:border-zinc-300 hover:shadow-md'
      }`}
    >
      <span className="text-3xl mb-4">{emoji}</span>
      <h2 className={`font-bold text-lg mb-2 ${featured ? 'text-amber-800' : 'text-zinc-900'}`}>{title}</h2>
      <p className="text-sm text-zinc-600 leading-relaxed flex-1 mb-5">{desc}</p>
      <span className={`text-sm font-bold ${featured ? 'text-amber-700 group-hover:text-amber-800' : 'text-zinc-700 group-hover:text-amber-700'}`}>
        {cta}
      </span>
    </Link>
  )
}
