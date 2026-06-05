import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default async function LandingPage() {
  const { data: styles } = await supabase
    .from('styles')
    .select('id, name, tagline, main_color, accent_color')

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900 overflow-x-hidden">

      {/* ── Nav ── */}
      <nav className="flex items-center justify-between px-6 py-5 border-b border-zinc-200 bg-white">
        <span className="text-xl font-bold text-amber-600 tracking-tight">roomia</span>
        <Link
          href="/configure"
          className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold
                     hover:bg-amber-600 transition-all"
        >
          Start Designing
        </Link>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200
                        rounded-full px-4 py-1.5 text-xs text-amber-700 font-medium mb-8">
          ✦ Interior design, made simple
        </div>

        <h1 className="text-5xl md:text-7xl font-bold leading-tight tracking-tight mb-6">
          Design your room.
          <br />
          <span className="text-amber-600">In 3 minutes.</span>
        </h1>

        <p className="text-lg text-zinc-600 max-w-xl mx-auto mb-10 leading-relaxed">
          Answer 3 simple questions. Get a complete interior design —
          style, furniture, and budget — tailored to your exact space.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/configure"
            className="w-full sm:w-auto px-10 py-4 bg-amber-500 text-white rounded-xl
                       text-base font-bold hover:bg-amber-600 transition-all"
          >
            Start Designing →
          </Link>
          <a
            href="#how-it-works"
            className="w-full sm:w-auto px-10 py-4 border border-zinc-200 rounded-xl
                       text-base text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 transition-all bg-white"
          >
            See how it works
          </a>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-center gap-10 mt-16 text-center">
          {[
            { value: '5', label: 'Design styles' },
            { value: '3 min', label: 'Average time' },
            { value: '100%', label: 'Free to use' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-bold text-amber-600">{value}</div>
              <div className="text-xs text-zinc-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="border-t border-zinc-200 py-24 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-3">How it works</h2>
            <p className="text-zinc-500 text-sm">Three steps. That&apos;s all.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: '01',
                title: 'Tell us about your room',
                desc: 'Select your room type and enter the dimensions. That\'s all we need.',
                icon: '📐',
              },
              {
                step: '02',
                title: 'Pick your style',
                desc: 'Choose from 5 curated interior styles, each with a distinct personality.',
                icon: '🎨',
              },
              {
                step: '03',
                title: 'Get your design',
                desc: 'Receive a full furniture list, moodboard, and budget estimate instantly.',
                icon: '✨',
              },
            ].map(({ step, title, desc, icon }) => (
              <div key={step} className="bg-stone-50 rounded-2xl p-6 border border-zinc-200
                                         hover:border-zinc-300 transition-colors shadow-sm">
                <div className="flex items-start justify-between mb-4">
                  <span className="text-3xl">{icon}</span>
                  <span className="text-xs font-mono text-zinc-400">{step}</span>
                </div>
                <h3 className="font-bold mb-2">{title}</h3>
                <p className="text-sm text-zinc-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Styles ── */}
      <section className="border-t border-zinc-200 py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-3">5 styles to explore</h2>
            <p className="text-zinc-500 text-sm">
              Curated by a professional architect. Pick the one that speaks to you.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {styles?.map(style => (
              <Link
                key={style.id}
                href="/configure"
                className="group bg-white rounded-2xl p-5 border border-zinc-200
                           hover:border-amber-300 transition-all shadow-sm"
              >
                <div className="flex gap-2 mb-4">
                  <div
                    className="h-8 flex-1 rounded-lg border border-zinc-100"
                    style={{ backgroundColor: style.main_color }}
                  />
                  <div
                    className="h-8 w-8 rounded-lg flex-shrink-0 border border-zinc-100"
                    style={{ backgroundColor: style.accent_color }}
                  />
                </div>
                <div className="font-bold text-sm mb-1 group-hover:text-amber-600 transition-colors">
                  {style.name}
                </div>
                <div className="text-xs text-zinc-500">{style.tagline}</div>
              </Link>
            ))}

            <Link
              href="/configure"
              className="bg-amber-50 border border-amber-200 rounded-2xl p-5
                         hover:bg-amber-100 transition-all flex flex-col
                         items-center justify-center text-center gap-2"
            >
              <span className="text-2xl">→</span>
              <span className="text-sm font-bold text-amber-700">Find your style</span>
              <span className="text-xs text-zinc-500">Start the configurator</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-zinc-200 py-24 bg-white">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-4">
            Ready to design
            <br />
            your space?
          </h2>
          <p className="text-zinc-600 mb-10 text-sm leading-relaxed">
            Free. No account needed. No expertise required.
            <br />
            Just your room and 3 minutes.
          </p>
          <Link
            href="/configure"
            className="inline-block px-12 py-4 bg-amber-500 text-white rounded-xl
                       text-base font-bold hover:bg-amber-600 transition-all"
          >
            Design My Room →
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-zinc-200 px-6 py-8 bg-stone-50">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center
                        justify-between gap-4 text-xs text-zinc-500">
          <span className="font-bold text-zinc-700">roomia</span>
          <div className="flex gap-6">
            <Link href="/about" className="hover:text-zinc-800 transition-colors">About</Link>
            <Link href="/partners" className="hover:text-zinc-800 transition-colors">Partners</Link>
            <a href="mailto:contact@roomia.dz" className="hover:text-zinc-800 transition-colors">
              Contact
            </a>
          </div>
          <span>© 2025 Roomia. Algeria.</span>
        </div>
      </footer>

    </div>
  )
}
