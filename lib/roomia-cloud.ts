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
  args: { jobId: string; project: string; view: string; lighting: Lighting; capture: Buffer; ask: boolean; quality?: 'medium'; kind?: 'tile' },
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
    ...(args.kind ? { kind: args.kind } : {}),
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

// ── "Mon espace": the account's photos and published tours on Roomia's server (lib/desktop-drive.ts) ──

export interface CloudLedgerEntry {
  at: number
  kind: string
  delta: number
  balance_after: number
  outcome: string | null
  detail: string | null
}

export interface CloudDrive {
  user: CloudUser
  ledger: CloudLedgerEntry[]
  photos: { job: string; project: string; view: string; at: number }[]
  tours: { id: string; title: string; at: number; bytes: number; from?: string; url: string }[]
}

async function authed(): Promise<string> {
  const token = await readToken()
  if (!token) throw new CreditError('Connectez-vous à votre compte Roomia (menu Compte).', 401)
  return token
}

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { detail?: string }
  if (!res.ok) throw new CreditError(data.detail ?? `Serveur Roomia : erreur ${res.status}`, res.status)
  return data
}

export const cloudPublicUrl = (pathname: string) => `${base()}${pathname}`

export async function cloudDrive(): Promise<CloudDrive> {
  const token = await authed()
  const get = (p: string) => call(p, {}, token).catch(() => {
    throw unreachable()
  })
  const [me, photos, tours] = await Promise.all([
    get('/api/desktop/me').then(r => json<{ user: CloudUser; ledger: CloudLedgerEntry[] }>(r)),
    get('/api/desktop/photos').then(r => json<{ photos: CloudDrive['photos'] }>(r)),
    get('/api/desktop/tours').then(r => json<{ tours: Omit<CloudDrive['tours'][number], 'url'>[] }>(r)),
  ])
  return { user: me.user, ledger: me.ledger, photos: photos.photos, tours: tours.tours.map(t => ({ ...t, url: cloudPublicUrl(`/studio/tour/${t.id}`) })) }
}

/** One delivered photo of the account, as the server sends it. */
export async function cloudPhotoFile(job: string): Promise<Response> {
  const token = await authed()
  return call(`/api/desktop/photos/${encodeURIComponent(job)}`, { headers: {} }, token).catch(() => {
    throw unreachable()
  })
}

export async function cloudUnpublish(id: string): Promise<void> {
  const token = await authed()
  await json(await call(`/api/desktop/tours/${encodeURIComponent(id)}`, { method: 'DELETE' }, token).catch(() => {
    throw unreachable()
  }))
}

export interface PublishProgress {
  state: 'sending' | 'done' | 'failed'
  sent: number
  total: number
  url?: string
  id?: string
  error?: string
}

/**
 * Sends a project's tour to Roomia's server, for a link the architect gives their clients. `files` are the tour's
 * files as [path on the server, path on this PC, size]. Each file goes in pieces; a cut piece is sent again from
 * what the server has. With `id`, the same link is updated.
 */
export async function cloudPublishTour(
  args: { title: string; id?: string; files: [string, string, number][] },
  onProgress: (sent: number, total: number) => void,
): Promise<{ id: string; url: string }> {
  const token = await authed()
  const { open } = await import('node:fs/promises')
  const start = await json<{ id: string; chunk: number }>(
    await call('/api/desktop/tours', { method: 'POST', body: JSON.stringify({ title: args.title, from: hostname(), ...(args.id ? { id: args.id } : {}) }) }, token).catch(() => {
      throw unreachable()
    }),
  )
  const total = args.files.reduce((n, [, , size]) => n + size, 0)
  let sent = 0
  for (const [remote, local, size] of args.files) {
    const handle = await open(local, 'r')
    try {
      let offset = 0
      let failures = 0
      while (offset < size || (size === 0 && offset === 0)) {
        const length = Math.min(start.chunk, size - offset)
        const piece = Buffer.alloc(length)
        await handle.read(piece, 0, length, offset)
        try {
          const res = await call(
            `/api/desktop/tours/${start.id}?path=${encodeURIComponent(remote)}&offset=${offset}`,
            { method: 'PUT', body: piece, headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(120_000) },
            token,
          )
          const { size: have } = await json<{ size: number }>(res)
          sent += have - offset
          offset = have
          failures = 0
          onProgress(sent, total)
          if (size === 0) break
        } catch (err) {
          if (err instanceof CreditError && err.status < 500 && err.status !== 408 && err.status !== 429) throw err
          if (++failures > 6) throw new CreditError('La connexion coupe trop souvent : relancez la publication, elle reprendra.', 503)
          await new Promise(r => setTimeout(r, 3000 * failures))
        }
      }
    } finally {
      await handle.close()
    }
  }
  const done = await json<{ id: string; url: string }>(
    await call(`/api/desktop/tours/${start.id}/finish`, { method: 'POST', body: JSON.stringify({ files: args.files.map(([path, , bytes]) => ({ path, bytes })) }) }, token).catch(() => {
      throw unreachable()
    }),
  )
  return { id: done.id, url: cloudPublicUrl(done.url) }
}
