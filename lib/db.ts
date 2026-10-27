import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

/**
 * The Studio's own database: accounts, sessions, paid render jobs and the credit ledger. A single
 * SQLite file on the Studio PC (ROOMIA_DB_PATH, default .data/roomia.db, never in Git). Node's
 * built-in SQLite is loaded on first use only, so the website build on Vercel never touches it.
 */

type Row = Record<string, unknown>
export interface Statement {
  run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint }
  get: (...params: unknown[]) => Row | undefined
  all: (...params: unknown[]) => Row[]
}
export interface Database {
  exec: (sql: string) => void
  prepare: (sql: string) => Statement
}

declare const __non_webpack_require__: NodeJS.Require | undefined

let db: Database | null = null

export const DB_PATH = process.env.ROOMIA_DB_PATH ?? path.join(/* turbopackIgnore: true */ process.cwd(), '.data', 'roomia.db')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  scene_id TEXT NOT NULL,
  view TEXT,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed', 'released')),
  pid INTEGER,
  photo_file TEXT,
  failure TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_id TEXT,
  kind TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  outcome TEXT,
  detail TEXT,
  actor_id INTEGER
);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  scene_id TEXT NOT NULL,
  photo_file TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'refunded', 'denied')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, at);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, created_at);
`

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * A reserved job whose server process is gone (restart, crash) can never finish: its credit goes
 * back. Jobs of a still-running process (e.g. another Studio instance on the same file) are left.
 */
function releaseOrphans(database: Database) {
  const orphans = database.prepare(`SELECT id, user_id, pid FROM jobs WHERE status = 'reserved'`).all()
  for (const job of orphans) {
    const pid = Number(job.pid)
    if (pid === process.pid || (pid && processAlive(pid))) continue
    transaction(database, () => {
      const done = database
        .prepare(`UPDATE jobs SET status = 'released', failure = 'serveur redémarré', finished_at = ? WHERE id = ? AND status = 'reserved'`)
        .run(Date.now(), job.id)
      if (Number(done.changes) !== 1) return
      database.prepare(`UPDATE users SET credits = credits + 1 WHERE id = ?`).run(job.user_id)
      const balance = Number(database.prepare(`SELECT credits FROM users WHERE id = ?`).get(job.user_id)?.credits ?? 0)
      database
        .prepare(`INSERT INTO ledger (at, user_id, job_id, kind, delta, balance_after, outcome, detail) VALUES (?, ?, ?, 'release', 1, ?, 'interrupted', 'serveur redémarré pendant le rendu')`)
        .run(Date.now(), job.user_id, job.id, balance)
    })
  }
}

/** Runs fn in one write transaction (BEGIN IMMEDIATE): concurrent requests queue instead of racing. */
export function transaction<T>(database: Database, fn: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    database.exec('COMMIT')
    return result
  } catch (err) {
    database.exec('ROLLBACK')
    throw err
  }
}

export function getDb(): Database {
  if (db) return db
  const req = typeof __non_webpack_require__ === 'function' ? __non_webpack_require__ : createRequire(import.meta.url)
  const { DatabaseSync } = req('node:sqlite') as { DatabaseSync: new (file: string) => Database }
  mkdirSync(path.dirname(DB_PATH), { recursive: true })
  const opened = new DatabaseSync(DB_PATH)
  opened.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  opened.exec(SCHEMA)
  releaseOrphans(opened)
  db = opened
  return db
}
