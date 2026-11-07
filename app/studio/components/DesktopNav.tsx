import Link from 'next/link'

/** Roomia Desktop's own pages: Mes projets, Mon espace, and a new project in the Studio. */
export default function DesktopNav({ current }: { current: 'projets' | 'compte' }) {
  const tab = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]' : 'text-[var(--rm-text)] hover:bg-[var(--rm-text)]/5'}`
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-[var(--rm-text)]/10 bg-[var(--rm-surface)] px-4 py-3 sm:px-6">
      <span className="mr-3 text-base font-semibold tracking-tight text-[var(--rm-text)]">Roomia</span>
      <Link className={tab(current === 'projets')} href="/studio/projets">
        Mes projets
      </Link>
      <Link className={tab(current === 'compte')} href="/studio/compte">
        Mon espace
      </Link>
      <Link
        className="ml-auto rounded-lg bg-[var(--rm-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--rm-surface)] hover:brightness-110"
        href="/studio"
      >
        + Nouveau projet
      </Link>
    </header>
  )
}
