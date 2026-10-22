import { NextRequest } from 'next/server'
import { Resend } from 'resend'
import { DEMO_ROLES } from '@/lib/contact'

/**
 * Demo requests from the landing page, emailed to Roomia (DEMO_REQUEST_EMAIL). Resend's test sender
 * only delivers to the Resend account's own address; any other one needs room-ia.com verified on Resend.
 */
const TO = process.env.DEMO_REQUEST_EMAIL || 'aymen1889@outlook.fr'

const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max)
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ detail: 'Requête invalide.' }, { status: 400 })
  // The hidden field is only filled by bots: answer as if it worked.
  if (clean(body.website, 200)) return Response.json({ ok: true })

  const name = clean(body.name, 80)
  const company = clean(body.company, 120)
  const phone = clean(body.phone, 30)
  const message = clean(body.message, 1000)
  const role = DEMO_ROLES.find(r => r === body.role) ?? 'Autre'
  if (name.length < 2) return Response.json({ detail: 'Indiquez votre nom.' }, { status: 400 })
  if (!/^[+\d][\d\s().-]{5,29}$/.test(phone)) return Response.json({ detail: 'Vérifiez le numéro de téléphone.' }, { status: 400 })

  const key = process.env.RESEND_API_KEY
  if (!key) return Response.json({ detail: 'L’envoi par e-mail n’est pas disponible pour le moment.' }, { status: 503 })

  const rows: [string, string][] = [
    ['Nom', name],
    ['Société', company || '-'],
    ['Métier', role],
    ['Téléphone', phone],
    ['Projet', message || '-'],
  ]
  const html = `<h2 style="font-family:Arial,sans-serif">Nouvelle demande de démo</h2><table style="font-family:Arial,sans-serif;font-size:15px;border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#666;vertical-align:top">${k}</td><td style="padding:6px 0;white-space:pre-wrap">${escape(v)}</td></tr>`)
    .join('')}</table>`

  try {
    const { error } = await new Resend(key).emails.send({
      from: 'Roomia <onboarding@resend.dev>',
      to: TO,
      subject: `Demande de démo : ${name} (${role})`,
      html,
      text: rows.map(([k, v]) => `${k} : ${v}`).join('\n'),
    })
    if (error) throw new Error(error.message)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('demo-request email error:', err)
    return Response.json({ detail: 'La demande n’a pas pu être envoyée par e-mail.' }, { status: 502 })
  }
}
