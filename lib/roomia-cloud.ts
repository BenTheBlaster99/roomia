import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import path from 'node:path'
import { CreditError } from './credits'
import { PhotoChoiceError } from './photoreal'
import type { Lighting } from './render-lighting'

/**
 * Roomia Desktop's link to Roomia's server (app/api/desktop/*, lib/desktop-cloud.ts). In the desktop app the local
 * Studio has no AI key and no credits of its own: it signs in to Roomia's server and sends its Blender captures there
 * for the paid photo. ROOMIA_CLOUD_URL (set by desktop/main.js) turns this on; the device token is kept in
 * ROOMIA_CLOUD_TOKEN_FILE, in the app's own data folder.
 */
export const cloudMode = () => !!process.env.ROOMIA_CLOUD_URL

const base = () => (process.env.ROOMIA_CLOUD_URL ?? '').replace(/\/+$/, '')
const tokenFile = () => process.env.ROOMIA_CLOUD_TOKEN_FILE ?? path.join(process.cwd(), '.roomia-account.json')

export interface CloudUser {
  login: string
  name: string
  role: string
  credits: number
}

async function readToken(): Promise<string | null> {
  const saved = JSON.parse(await readFile(tokenFile(), 'utf8').catch(() => '{}')) as { token?: string }
  return typeof saved.token === 'string' && /^[0-9a-f]{64}$/.test(saved.token) ? saved.token : null
}

async function call(pathname: string, init: RequestInit = {}, token?: string | null): Promise<Response> {
  const auth = token === undefined ? await readToken() : token
  return fetch(`${base()}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  })
}

const unreachable = () => new CreditError('Le serveur Roomia est injoignable. Vérifiez la connexion internet.', 503)

export async function cloudLogin(login: string, password: string): Promise<CloudUser> {
  const res = await call('/api/desktop/session', { method: 'POST', body: JSON.stringify({ login, password, device: hostname() }) }, null).catch(() => {
    throw unreachable()
  })
  const data = (await res.json().catch(() => ({}))) as { token?: string; user?: CloudUser; detail?: string }
  if (!res.ok || !data.token || !data.user) throw new CreditError(data.detail ?? 'Connexion impossible.', res.status || 503)
  await mkdir(path.dirname(tokenFile()), { recursive: true })
  await writeFile(tokenFile(), JSON.stringify({ token: data.token, login: data.user.login, at: new Date().toISOString() }), { mode: 0o600 })
  return data.user
}

export async function cloudLogout(): Promise<void> {
  const token = await readToken()
  await rm(tokenFile(), { force: true })
  if (token) await call('/api/desktop/session', { method: 'DELETE' }, token).catch(() => undefined)
}

/** The signed-in account, or null when signed out (or the token was revoked). Throws when the server can't be reached. */
export async function cloudMe(): Promise<CloudUser | null> {
  const token = await readToken()
  if (!token) return null
  const res = await call('/api/desktop/me', {}, token).catch(() => {
    throw unreachable()
  })
  if (res.status === 401) return null
  if (!res.ok) throw unreachable()
  return ((await res.json()) as { user: CloudUser }).user
}

export interface CloudPhoto {
  base64: string
  credits: number
  seconds: number
  quality?: string
  fellBack?: boolean
  fidelity?: unknown
  provider?: string
  size?: string
}

/**
 * The paid photo of a capture, made on Roomia's server. A cut connection or a server still working on it is retried
 * with the same job id for up to 6 minutes: the server answers the photo it kept, never charging twice.
 */
export async function cloudPhoto(
  args: { jobId: string; project: string; view: string; lighting: Lighting; capture: Buffer; ask: boolean; quality?: 'medium' },
  onPing: () => void,
): Promise<CloudPhoto> {
  const token = await readToken()
  if (!token) throw new CreditError('Connectez-vous à votre compte Roomia pour les photos IA (menu Compte).', 401)
  const body = JSON.stringify({
    jobId: args.jobId,
    project: args.project,
    view: args.view,
    lighting: args.lighting,
    ask: args.ask,
    ...(args.quality ? { quality: args.quality } : {}),
    capture_base64: args.capture.toString('base64'),
  })
  const until = Date.now() + 6 * 60_000
  let lastError: unknown = null
  while (Date.now() < until) {
    try {
      const res = await call('/api/desktop/photo', { method: 'POST', body, signal: AbortSignal.timeout(330_000) }, token)
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string }
        throw new CreditError(data.detail ?? `Serveur Roomia : erreur ${res.status}`, res.status)
      }
      let pending = false
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffered += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, nl).trim()
          buffered = buffered.slice(nl + 1)
          if (!line) continue
          const event = JSON.parse(line) as Record<string, unknown>
          if (event.type === 'ping') onPing()
          else if (event.type === 'pending') pending = true
          else if (event.type === 'done') {
            return {
              base64: String(event.result_base64),
              credits: Number(event.credits ?? 0),
              seconds: Number(event.seconds ?? 0),
              quality: event.quality as string | undefined,
              fellBack: event.fellBack as boolean | undefined,
              fidelity: event.fidelity,
              provider: event.provider as string | undefined,
              size: event.size as string | undefined,
            }
          } else if (event.type === 'choice') {
            throw new PhotoChoiceError(event.tried as 'low' | 'medium' | 'high', event.reason as 'slow' | 'down', String(event.detail ?? ''))
          } else if (event.type === 'error') {
            throw new CreditError(String(event.detail ?? 'Erreur du serveur Roomia.'), Number(event.status ?? 500))
          }
        }
      }
      // the stream ended without an answer: cut, or the photo is still being made there
      lastError = new Error(pending ? 'pending' : 'cut')
    } catch (err) {
      if (err instanceof CreditError || err instanceof PhotoChoiceError) throw err
      lastError = err
    }
    onPing()
    await new Promise(r => setTimeout(r, 10_000))
  }
  throw new CreditError(
    `Pas de réponse du serveur Roomia (${lastError instanceof Error ? lastError.message : 'délai dépassé'}). Si la photo a été faite, elle sera rendue sans nouveau crédit en relançant.`,
    504,
  )
}
