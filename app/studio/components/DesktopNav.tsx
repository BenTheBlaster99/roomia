'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import BrandMark from './BrandMark'
import Icon, { type IconName } from './Icon'

/**
 * Roomia Desktop's header (16 Nov redesign): the mark, the two places (Mes projets, Mon espace), help, and one blue action.
 * The native menu strip is hidden (desktop/main.js); everything a user needs from it is in the help menu here.
 */
export default function DesktopNav({ current }: { current?: 'projets' | 'compte' }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--brand-line)] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-5 sm:px-8">
        <Link href="/studio/projets" className="mr-6 no-underline" aria-label="Roomia, mes projets">
          <BrandMark size={19} />
        </Link>
        <nav className="flex items-center gap-1" aria-label="Roomia">
          <NavTab href="/studio/projets" active={current === 'projets'}>
            Mes projets
          </NavTab>
          <NavTab href="/studio/compte" active={current === 'compte'}>
            Mon espace
          </NavTab>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <HelpMenu />
          <AccountMenu />
          <Link className="ui-btn ui-btn--primary" href="/studio">
            <Icon name="plus" size={17} />
            Nouveau projet
          </Link>
        </div>
      </div>
    </header>
  )
}

function NavTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative flex h-16 items-center px-3 text-[15px] font-semibold no-underline transition-colors ${
        active ? 'text-[var(--brand-blue)]' : 'text-[var(--brand-ink-soft)] hover:text-[var(--brand-blue)]'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-[var(--brand-gold)]" />}
    </Link>
  )
}

type Me = { state: 'loading' } | { state: 'in'; name: string; login?: string } | { state: 'out' } | { state: 'offline' }

const LOGIN = `/login?next=${encodeURIComponent('/studio/projets')}`

/** Who is signed in, with Mon espace, change account and sign out (16 Nov: the native menu that had them is hidden). */
function AccountMenu() {
  const [me, setMe] = useState<Me>({ state: 'loading' })
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async res => {
        const data = (await res.json().catch(() => null)) as { user?: { name?: string; login?: string } } | null
        if (cancelled) return
        if (res.ok && data?.user) setMe({ state: 'in', name: data.user.name || data.user.login || 'Mon compte', login: data.user.login })
        else setMe(res.status === 401 ? { state: 'out' } : { state: 'offline' })
      })
      .catch(() => !cancelled && setMe({ state: 'offline' }))
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  if (me.state === 'loading') return <span className="h-9 w-9" aria-hidden />
  if (me.state === 'out')
    return (
      <Link className="ui-btn ui-btn--ghost" href={LOGIN}>
        <Icon name="user" size={17} />
        Se connecter
      </Link>
    )

  const initials =
    me.state === 'in'
      ? me.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map(w => w[0]!.toUpperCase())
          .join('')
      : '?'
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-gold-tint)] text-[13px] font-bold text-[var(--brand-gold-text)] ring-1 ring-[var(--brand-gold-light)] transition hover:ring-2"
        aria-label="Mon compte"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {me.state === 'in' ? initials : <Icon name="user" size={17} />}
      </button>
      {open && (
        <div className="ui-menu right-0 top-12 min-w-[230px]" role="menu">
          <div className="px-2.5 pb-2 pt-1.5">
            {me.state === 'in' ? (
              <>
                <p className="text-[15px] font-semibold text-[var(--brand-ink)]">{me.name}</p>
                {me.login && me.login !== me.name && <p className="text-xs text-[var(--brand-muted)]">{me.login}</p>}
              </>
            ) : (
              <p className="text-[13px] text-[var(--brand-muted)]">Serveur Roomia injoignable. Vos projets restent disponibles.</p>
            )}
          </div>
          <hr className="ui-divider my-1" />
          <Link role="menuitem" href="/studio/compte" onClick={() => setOpen(false)}>
            <Icon name="user" size={17} />
            Mon espace
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
              window.location.assign(LOGIN)
            }}
          >
            <Icon name="logout" size={17} />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  )
}

type Item = { icon: IconName; label: string; run: () => void } | 'sep'

/** What the hidden native menu offered: SketchUp, help, updates, report, engine, folders. Only inside Roomia Desktop. */
function HelpMenu() {
  const [open, setOpen] = useState(false)
  const [desktop, setDesktop] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const d = window.roomiaDesktop
    if (!d) return
    // the bridge exists only inside Electron: decided after the first paint, the server cannot know
    queueMicrotask(() => setDesktop(true))
    void d.action?.('version').then(v => typeof v === 'string' && setVersion(v))
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  if (!desktop) return null

  const d = window.roomiaDesktop
  const items: Item[] = [
    { icon: 'sketchup', label: 'Installer l’extension SketchUp', run: () => void d?.installSketchup?.() },
    { icon: 'help', label: 'Guide d’utilisation', run: () => void d?.action?.('guide') },
    'sep',
    { icon: 'refresh', label: 'Rechercher une mise à jour', run: () => void d?.action?.('check-updates') },
    { icon: 'report', label: 'Signaler un problème', run: () => void d?.report?.() },
    'sep',
    { icon: 'cpu', label: 'Carte graphique et moteur', run: () => void d?.action?.('engine') },
    { icon: 'folder', label: 'Ouvrir le dossier des projets', run: () => void d?.openProjects?.() },
  ]
  return (
    <div className="relative" ref={box}>
      <button type="button" className="ui-btn ui-btn--quiet ui-btn--icon" aria-label="Aide" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="help" size={20} />
      </button>
      {open && (
        <div className="ui-menu right-0 top-12" role="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <hr key={i} className="ui-divider my-1" />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  it.run()
                }}
              >
                <Icon name={it.icon} size={17} />
                {it.label}
              </button>
            ),
          )}
          {version && <p className="px-2.5 pb-1 pt-2 text-xs text-[var(--brand-muted)]">Roomia {version}</p>}
        </div>
      )}
    </div>
  )
}
