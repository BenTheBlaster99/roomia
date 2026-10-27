import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getDb } from './db'

/** Studio accounts: one per office or freelancer, plus admins (Roomia itself). */

export { SESSION_COOKIE } from './session-cookie'
import { SESSION_COOKIE } from './session-cookie'
const SESSION_DAYS = 30

export interface User {
  id: number
  login: string
  name: string
  role: 'user' | 'admin'
  status: 'active' | 'suspended'
  credits: number
}

const toUser = (row: Record<string, unknown>): User => ({
  id: Number(row.id),
  login: String(row.login),
  name: String(row.name),
  role: row.role === 'admin' ? 'admin' : 'user',
  status: row.status === 'suspended' ? 'suspended' : 'active',
  credits: Number(row.credits),
})

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

function passwordMatches(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const key = scryptSync(password, Buffer.from(saltHex, 'hex'), 32)
  const expected = Buffer.from(keyHex, 'hex')
  return expected.length === key.length && timingSafeEqual(expected, key)
}

/** Sessions store only a hash of the cookie, so a copy of the database can't be used to log in. */
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export function validLogin(login: string): boolean {
  return /^[a-z0-9._-]{3,40}$/i.test(login)
}

/** New account with 0 credits; credits are then added through the ledger (adjustCredits). */
export function createUser(input: { login: string; name: string; password: string; role?: 'user' | 'admin' }): User {
  if (!validLogin(input.login)) throw new Error('Identifiant : 3 à 40 caractères (lettres, chiffres, . _ -).')
  if (input.password.length < 10) throw new Error('Mot de passe : au moins 10 caractères.')
  const name = input.name.trim().slice(0, 80) || input.login
  const db = getDb()
  if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(input.login)) throw new Error('Cet identifiant existe déjà.')
  const info = db
    .prepare('INSERT INTO users (login, name, password_hash, role, credits, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.login, name, hashPassword(input.password), input.role ?? 'user', 0, Date.now())
  const id = Number(info.lastInsertRowid)
  return { id, login: input.login, name, role: input.role ?? 'user', status: 'active', credits: 0 }
}

export function getUser(id: number): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)
  return row ? toUser(row) : null
}

export function setPassword(id: number, password: string) {
  if (password.length < 10) throw new Error('Mot de passe : au moins 10 caractères.')
  const db = getDb()
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
}

// Failed logins in 15 minutes: 8 lock that account, 30 lock the address (higher, because a whole
// office often shares one address). In memory: a restart clears it, fine for a supervised pilot.
const FAILURE_WINDOW_MS = 15 * 60_000
const MAX_FAILURES_PER_LOGIN = 8
const MAX_FAILURES_PER_ADDRESS = 30
const failures = new Map<string, number[]>()

function tooManyFailures(key: string): boolean {
  const now = Date.now()
  const recent = (failures.get(key) ?? []).filter(t => now - t < FAILURE_WINDOW_MS)
  failures.set(key, recent)
  return recent.length >= (key.startsWith('ip:') ? MAX_FAILURES_PER_ADDRESS : MAX_FAILURES_PER_LOGIN)
}

const noteFailure = (key: string) => failures.set(key, [...(failures.get(key) ?? []), Date.now()])

/** Checks the password and opens a session; returns the cookie token, or a readable refusal. */
export function login(loginName: string, password: string, address: string): { token: string; user: User } | { error: string } {
  const keys = [`login:${loginName.toLowerCase()}`, `ip:${address}`]
  if (keys.some(tooManyFailures)) return { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }
  const row = getDb().prepare('SELECT * FROM users WHERE login = ?').get(loginName)
  // Same work whether or not the login exists, so the answer time doesn't reveal accounts.
  const ok = passwordMatches(password, row ? String(row.password_hash) : 'scrypt$00$00')
  if (!row || !ok) {
    keys.forEach(noteFailure)
    return { error: 'Identifiant ou mot de passe incorrect.' }
  }
  const user = toUser(row)
  if (user.status === 'suspended') return { error: 'Ce compte est suspendu. Contactez Roomia.' }
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  getDb()
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), user.id, now, now + SESSION_DAYS * 86_400_000)
  return { token, user }
}

export function logout(token: string) {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
}

/** The account behind a session cookie: null when missing, expired, or the account is suspended. */
export function userFromToken(token: string | undefined): User | null {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null
  const row = getDb()
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .get(tokenHash(token), Date.now())
  if (!row) return null
  const user = toUser(row)
  return user.status === 'active' ? user : null
}

export const sessionCookie = (token: string, secure: boolean) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? '; Secure' : ''}`

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
