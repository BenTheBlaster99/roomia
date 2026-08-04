import Link from 'next/link'
import HaikeiBackdrop from './HaikeiBackdrop'

export default function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-[var(--rm-text)]/10 bg-[var(--rm-ink)] text-[var(--rm-bg)]">
      <HaikeiBackdrop variant="footer" />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 md:flex-row md:items-end md:justify-between md:px-6">
        <div>
          <div className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
            roomia
          </div>
          <p className="mt-2 max-w-xs text-sm text-[var(--rm-bg)]/65">
            Interior design for Algeria — scan, compose, and shop the look.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--rm-bg)]/70">
          <Link href="/rooms" className="hover:text-[var(--rm-bg)]">Presets</Link>
          <Link href="/marketplace" className="hover:text-[var(--rm-bg)]">Catalog</Link>
          <Link href="/room-composer" className="hover:text-[var(--rm-bg)]">Compose</Link>
          <Link href="/studio" className="hover:text-[var(--rm-bg)]">Studio</Link>
          <Link href="/about" className="hover:text-[var(--rm-bg)]">About</Link>
          <Link href="/partners" className="hover:text-[var(--rm-bg)]">Partners</Link>
          <a href="mailto:contact@roomia.dz" className="hover:text-[var(--rm-bg)]">Contact</a>
        </div>

        <p className="text-xs text-[var(--rm-bg)]/45">© 2026 Roomia · Algeria</p>
      </div>
    </footer>
  )
}
