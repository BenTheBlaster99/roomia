'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { PublishProgress } from '@/lib/roomia-cloud'

interface State {
  progress: PublishProgress | null
  published: { id: string; url: string; at: number } | null
}

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 ** 2))} Mo`

/**
 * Roomia Desktop, on a project's tour: publishes it on Roomia's server for the architect's clients and gives the link.
 * Publishing again updates the same link. Nothing shows in the web Studio.
 */
async function readPublish(sceneId: string): Promise<State | null> {
  const res = await fetch(`/api/account/publish?sceneId=${sceneId}`, { cache: 'no-store' }).catch(() => null)
  return res?.ok ? ((await res.json()) as State) : null
}

export default function DesktopPublish({ sceneId }: { sceneId: string }) {
  // only inside Roomia Desktop (its preload); false while rendering on the server
  const desktop = useSyncExternalStore(
    () => () => undefined,
    () => !!window.roomiaDesktop,
    () => false,
  )
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => readPublish(sceneId).then(s => s && setState(s)), [sceneId])

  const sending = state?.progress?.state === 'sending'
  useEffect(() => {
    if (!desktop) return
    let live = true
    const tick = () => void readPublish(sceneId).then(s => live && s && setState(s))
    tick()
    const timer = sending ? setInterval(tick, 1500) : null
    return () => {
      live = false
      if (timer) clearInterval(timer)
    }
  }, [desktop, sceneId, sending])

  async function publish() {
    setError('')
    const res = await fetch('/api/account/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sceneId }) })
    const body = (await res.json().catch(() => ({}))) as { detail?: string }
    if (!res.ok) setError(body.detail ?? 'La publication n’a pas pu démarrer.')
    await load()
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!desktop) return null
  const p = state?.progress
  const link = p?.state === 'done' && p.url ? p.url : state?.published?.url
  return (
    <div className="tour-publish">
      <button type="button" className="tour-publish-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {sending ? `Envoi… ${p && p.total ? Math.round((p.sent / p.total) * 100) : 0} %` : link ? 'Lien client ✓' : 'Publier pour mes clients'}
      </button>
      {open && (
        <div className="tour-publish-panel" role="dialog" aria-label="Publier la visite">
          {sending && p ? (
            <>
              <strong>Envoi de la visite au serveur Roomia…</strong>
              <progress max={p.total || 1} value={p.sent} />
              <span>
                {mb(p.sent)} / {mb(p.total)}. Vous pouvez continuer à travailler ; ne fermez pas Roomia.
              </span>
            </>
          ) : (
            <>
              <strong>{link ? 'Visite publiée' : 'Publier la visite pour vos clients'}</strong>
              <span>
                {link
                  ? 'Envoyez ce lien à vos clients : ils visitent sans compte ni installation, sur ordinateur ou téléphone.'
                  : 'La visite (360°, photos et plan) est envoyée sur le serveur Roomia et reçoit un lien à envoyer à vos clients. Gratuit, aucun crédit.'}
              </span>
              {link && (
                <div className="tour-publish-link">
                  <input readOnly value={link} onFocus={e => e.currentTarget.select()} />
                  <button type="button" onClick={() => void copy(link)}>
                    {copied ? 'Copié ✓' : 'Copier'}
                  </button>
                </div>
              )}
              {p?.state === 'failed' && <span className="tour-error">{p.error}</span>}
              {error && <span className="tour-error">{error}</span>}
              <button type="button" onClick={() => void publish()}>
                {link ? 'Mettre à jour le lien avec la visite actuelle' : 'Publier'}
              </button>
              {link && (
                <Link href="/studio/compte" className="tour-publish-more">
                  Gérer mes visites publiées →
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
