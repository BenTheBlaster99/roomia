'use client'

import { useState } from 'react'
import { DEMO_ROLES, whatsappLink } from '@/lib/contact'

type Status = 'idle' | 'sending' | 'sent' | 'error'

/** Demo request: emailed to Roomia. If sending fails, the visitor gets the same request ready to send on WhatsApp. */
export default function DemoForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [fallback, setFallback] = useState('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'sending') return
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    if (!data.name?.trim() || !data.phone?.trim()) {
      setStatus('error')
      setError('Indiquez votre nom et votre téléphone pour qu’on puisse vous rappeler.')
      setFallback('')
      return
    }
    const text = `Bonjour, je souhaite une démo de Roomia Render.\nNom : ${data.name}\nSociété : ${data.company || '-'}\nMétier : ${data.role}\nTéléphone : ${data.phone}${data.message ? `\nProjet : ${data.message}` : ''}`
    setStatus('sending')
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const body = (await res.json().catch(() => ({}))) as { detail?: string }
      if (!res.ok) throw new Error(body.detail || 'La demande n’a pas pu être envoyée.')
      setStatus('sent')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'La demande n’a pas pu être envoyée.')
      setFallback(whatsappLink(text))
    }
  }

  if (status === 'sent') {
    return (
      <div className="status" role="status">
        Merci, votre demande est bien arrivée. Nous vous appelons pour fixer la démo.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="row2">
        <div className="field">
          <label htmlFor="demo-name">Nom</label>
          <input id="demo-name" name="name" autoComplete="name" maxLength={80} required />
        </div>
        <div className="field">
          <label htmlFor="demo-company">Société</label>
          <input id="demo-company" name="company" autoComplete="organization" maxLength={120} />
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="demo-role">Vous êtes</label>
          <select id="demo-role" name="role" defaultValue={DEMO_ROLES[0]}>
            {DEMO_ROLES.map(r => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="demo-phone">Téléphone</label>
          <input id="demo-phone" name="phone" type="tel" autoComplete="tel" maxLength={30} required />
        </div>
      </div>
      <div className="field">
        <label htmlFor="demo-message">Votre projet (facultatif)</label>
        <textarea id="demo-message" name="message" maxLength={1000} placeholder="Ex. : programme de 40 logements, F3 et F4, visuels pour la vente sur plan" />
      </div>
      {/* Left empty by people; bots fill it. */}
      <div className="trap" aria-hidden="true">
        <label htmlFor="demo-website">Site web</label>
        <input id="demo-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <button className="btn btn-main" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Envoi…' : 'Demander une démo'}
      </button>
      {status === 'error' && (
        <p className="status" role="alert">
          {error}
          {fallback && (
            <>
              {' '}
              <a href={fallback} target="_blank" rel="noopener noreferrer">
                Envoyer la demande sur WhatsApp
              </a>
            </>
          )}
        </p>
      )}
    </form>
  )
}
