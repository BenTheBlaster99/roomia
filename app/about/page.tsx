import Link from 'next/link'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900">

      <nav className="flex items-center justify-between px-6 py-5 border-b border-zinc-200 bg-white">
        <Link href="/" className="text-xl font-bold text-amber-600 tracking-tight">roomia</Link>
        <Link
          href="/configure"
          className="px-5 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold
                     hover:bg-amber-600 transition-all"
        >
          Start Designing
        </Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-20 space-y-16">

        <div className="space-y-4">
          <h1 className="text-4xl font-bold">About Roomia</h1>
          <p className="text-zinc-600 leading-relaxed">
            Roomia is an interior design configurator built for Algerians
            furnishing their homes. Answer three questions and get a complete
            design — style, furniture, and budget — in under three minutes.
            No designer fees. No overwhelming catalogs. Just your room, done right.
          </p>
        </div>

        <div className="space-y-6">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
            The Team
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                role: 'Design & Architecture',
                name: 'Sarah',
                desc: 'Architect and interior designer. Every style, furniture recommendation, and budget range in Roomia comes from her expertise.',
                color: '#C9A84C',
              },
              {
                role: 'Product & Engineering',
                name: 'Aimen',
                desc: 'Full-stack developer. Built Roomia from the ground up — the configurator, the database, the whole experience.',
                color: '#4F84A6',
              },
            ].map(({ role, name, desc, color }) => (
              <div
                key={name}
                className="bg-white rounded-2xl p-6 border border-zinc-200 space-y-3 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full" style={{ backgroundColor: color }} />
                  <div>
                    <div className="font-bold text-sm">{name}</div>
                    <div className="text-xs text-zinc-500">{role}</div>
                  </div>
                </div>
                <p className="text-sm text-zinc-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
            Why We Built This
          </h2>
          <p className="text-zinc-600 leading-relaxed">
            Most people furnishing their home in Algeria have no structured tool to help them.
            They scroll Instagram, visit stores with no plan, and either overspend or
            under-decorate. Roomia gives them what was previously only available through
            an expensive consultation — a real design direction, instantly.
          </p>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-4 shadow-sm">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
            Get In Touch
          </h2>
          <p className="text-sm text-zinc-600">
            Questions, feedback, or partnership inquiries — we read everything.
          </p>
          <a
            href="mailto:contact@roomia.dz"
            className="inline-block text-sm text-amber-600 hover:text-amber-700 transition-colors font-medium"
          >
            contact@roomia.dz →
          </a>
        </div>

        <div className="text-center pt-4">
          <Link
            href="/configure"
            className="inline-block px-10 py-3.5 bg-amber-500 text-white rounded-xl
                       text-sm font-bold hover:bg-amber-600 transition-all"
          >
            Try Roomia →
          </Link>
        </div>

      </div>

      <footer className="border-t border-zinc-200 px-6 py-8 mt-10 bg-white">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center
                        justify-between gap-4 text-xs text-zinc-500">
          <span className="font-bold text-zinc-700">roomia</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-zinc-800 transition-colors">Home</Link>
            <Link href="/partners" className="hover:text-zinc-800 transition-colors">Partners</Link>
            <a href="mailto:contact@roomia.dz" className="hover:text-zinc-800 transition-colors">Contact</a>
          </div>
          <span>© 2025 Roomia. Algeria.</span>
        </div>
      </footer>

    </div>
  )
}
