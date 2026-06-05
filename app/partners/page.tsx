import Link from 'next/link'

export default function PartnersPage() {
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
          <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200
                          rounded-full px-4 py-1.5 text-xs text-amber-700 font-medium">
            ✦ For furniture brands & retailers
          </div>
          <h1 className="text-4xl font-bold leading-tight">
            Put your products
            <br />
            in front of ready buyers.
          </h1>
          <p className="text-zinc-600 leading-relaxed">
            Roomia connects Algerians designing their homes with the furniture
            they need to make it real. When a user picks a style and budget,
            your products appear as the recommended choice. They click. They buy.
            You pay a commission — only on results.
          </p>
        </div>

        <div className="space-y-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
            How the partnership works
          </h2>
          <div className="space-y-3">
            {[
              {
                n: '01',
                title: 'We list your products',
                desc: 'Your catalog gets added to our configurator — matched to the right styles, rooms, and budgets.',
              },
              {
                n: '02',
                title: 'Users discover them naturally',
                desc: 'When someone designs their living room in a minimalist style with a comfortable budget, your sofa appears as the recommendation.',
              },
              {
                n: '03',
                title: 'They click through to your store',
                desc: 'Every product links directly to your website or product page. The buyer lands on you, ready to purchase.',
              },
              {
                n: '04',
                title: 'You pay commission on sales only',
                desc: 'No upfront fees. No monthly subscriptions. We take a small commission on purchases driven through Roomia.',
              },
            ].map(({ n, title, desc }) => (
              <div
                key={n}
                className="flex gap-4 bg-white rounded-xl p-5 border border-zinc-200 shadow-sm"
              >
                <span className="text-xs font-mono text-zinc-400 mt-0.5 flex-shrink-0">{n}</span>
                <div>
                  <div className="font-semibold text-sm mb-1">{title}</div>
                  <div className="text-sm text-zinc-600 leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
            Why it works for you
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <div
                key={title}
                className="bg-white rounded-xl p-5 border border-zinc-200 space-y-2 shadow-sm"
              >
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <div className="font-semibold text-sm">{title}</div>
                <div className="text-xs text-zinc-600 leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
            Who we work with
          </h2>
          <div className="flex flex-wrap gap-2">
            {[
              'Furniture stores',
              'Lighting brands',
              'Home décor retailers',
              'Textile & rug suppliers',
              'Kitchen & dining brands',
              'Local manufacturers',
              'Online furniture shops',
            ].map(tag => (
              <span
                key={tag}
                className="text-sm bg-white border border-zinc-200 text-zinc-600
                           px-4 py-2 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8
                        text-center space-y-5">
          <h2 className="text-xl font-bold">Interested in partnering?</h2>
          <p className="text-sm text-zinc-600">
            Send us a message. We&apos;ll get back to you within 24 hours to walk
            you through the details and set up your catalog.
          </p>
          <a
            href="mailto:partners@roomia.dz?subject=Partnership Inquiry"
            className="inline-block px-10 py-3.5 bg-amber-500 text-white rounded-xl
                       text-sm font-bold hover:bg-amber-600 transition-all"
          >
            Contact Us →
          </a>
          <p className="text-xs text-zinc-500">partners@roomia.dz</p>
        </div>

      </div>

      <footer className="border-t border-zinc-200 px-6 py-8 mt-10 bg-white">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center
                        justify-between gap-4 text-xs text-zinc-500">
          <span className="font-bold text-zinc-700">roomia</span>
          <div className="flex gap-6">
            <Link href="/" className="hover:text-zinc-800 transition-colors">Home</Link>
            <Link href="/about" className="hover:text-zinc-800 transition-colors">About</Link>
            <a href="mailto:contact@roomia.dz" className="hover:text-zinc-800 transition-colors">Contact</a>
          </div>
          <span>© 2025 Roomia. Algeria.</span>
        </div>
      </footer>

    </div>
  )
}
