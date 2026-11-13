#!/usr/bin/env node
/**
 * Daily backup (13 Nov 2026, the user's choice of folder): everything that is NOT already on GitHub and NOT already on
 * the DATA disk goes to /media/jackhammer/DATA/Linux-Work/backup-logs.
 *
 *   roomia-db/roomia-YYYY-MM-DD.db   the accounts, credits and ledger (lives on the home disk: ~/roomia-data/roomia.db).
 *                                    SQLite's own online backup, so it is consistent even while the Studio is running;
 *                                    the copy is integrity-checked. The last 30 days are kept.
 *   config/YYYY-MM-DD/               the Studio and tunnel services, their drop-ins, the tunnel's config and credentials,
 *                                    and both .env.local files. The last 14 days are kept.
 *   backup.log                       one line per run.
 *
 * Run by the systemd user timer roomia-backup.timer (deploy/roomia-backup.*). By hand: node deploy/backup-daily.mjs
 * Restore the database: stop roomia-studio, copy a roomia-YYYY-MM-DD.db over ~/roomia-data/roomia.db (and delete the
 * -wal and -shm files next to it), start roomia-studio.
 */
import { backup, DatabaseSync } from 'node:sqlite'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const HOME = homedir()
const DEST = process.env.ROOMIA_BACKUP_DIR ?? '/media/jackhammer/DATA/Linux-Work/backup-logs'
const DB = process.env.ROOMIA_DB_PATH ?? path.join(HOME, 'roomia-data', 'roomia.db')
const PROJECTS = '/media/jackhammer/DATA/Linux-Work/Projects'
const CONFIG_FILES = [
  path.join(HOME, '.config/systemd/user/roomia-studio.service'),
  path.join(HOME, '.config/systemd/user/roomia-tunnel.service'),
  path.join(HOME, '.config/systemd/user/roomia-backup.service'),
  path.join(HOME, '.config/systemd/user/roomia-backup.timer'),
  path.join(HOME, '.config/systemd/user/roomia-studio.service.d'),
  path.join(HOME, '.cloudflared'),
  path.join(PROJECTS, 'roomia-w/.env.local'),
  path.join(PROJECTS, 'roomia/.env.local'),
]
const KEEP_DB = 30
const KEEP_CONFIG = 14

const day = new Date().toISOString().slice(0, 10)
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

function log(line) {
  const text = `${stamp()}  ${line}\n`
  process.stdout.write(text)
  try {
    appendFileSync(path.join(DEST, 'backup.log'), text)
  } catch {
    // DATA not mounted or read-only: leave a trace on the home disk instead
    appendFileSync(path.join(HOME, 'roomia-data', 'backup-failed.log'), text)
  }
}

function copyInto(src, dir) {
  if (!existsSync(src)) return 0
  const target = path.join(dir, path.basename(src).replace(/^\./, 'dot.'))
  if (statSync(src).isDirectory()) {
    mkdirSync(target, { recursive: true })
    return readdirSync(src).reduce((n, f) => n + copyInto(path.join(src, f), target), 0)
  }
  copyFileSync(src, target)
  return 1
}

function prune(dir, keep, match) {
  const items = readdirSync(dir).filter(f => match.test(f)).sort()
  for (const old of items.slice(0, Math.max(0, items.length - keep))) rmSync(path.join(dir, old), { recursive: true, force: true })
}

async function main() {
  // DATA must be mounted read-write, or nothing can be written there
  mkdirSync(DEST, { recursive: true })
  const probe = path.join(DEST, '.write-test')
  writeFileSync(probe, day)
  rmSync(probe)

  // 1. the database
  const dbDir = path.join(DEST, 'roomia-db')
  mkdirSync(dbDir, { recursive: true })
  const out = path.join(dbDir, `roomia-${day}.db`)
  const tmp = `${out}.tmp`
  rmSync(tmp, { force: true })
  const src = new DatabaseSync(DB, { readOnly: true })
  await backup(src, tmp)
  src.close()
  // the copy keeps the live database's WAL mode: switch it back to a single self-contained file
  const copy = new DatabaseSync(tmp)
  copy.exec('PRAGMA journal_mode = DELETE')
  const check = copy.prepare('PRAGMA integrity_check').get()
  const users = copy.prepare('SELECT COUNT(*) AS n FROM users').get().n
  const ledger = copy.prepare('SELECT COUNT(*) AS n FROM ledger').get().n
  copy.close()
  if (Object.values(check)[0] !== 'ok') throw new Error(`the copy failed its integrity check: ${JSON.stringify(check)}`)
  for (const extra of ['-wal', '-shm']) rmSync(`${tmp}${extra}`, { force: true })
  renameSync(tmp, out)
  for (const f of readdirSync(dbDir)) if (/\.tmp(-wal|-shm)?$/.test(f)) rmSync(path.join(dbDir, f), { force: true })
  prune(dbDir, KEEP_DB, /^roomia-\d{4}-\d{2}-\d{2}\.db$/)

  // 2. the server's configuration
  const cfgRoot = path.join(DEST, 'config')
  const cfgDir = path.join(cfgRoot, day)
  rmSync(cfgDir, { recursive: true, force: true })
  mkdirSync(cfgDir, { recursive: true })
  let files = 0
  for (const f of CONFIG_FILES) {
    // the two .env.local files share a name: keep them apart by project
    const into = f.endsWith('.env.local') ? path.join(cfgDir, path.basename(path.dirname(f))) : cfgDir
    mkdirSync(into, { recursive: true })
    files += copyInto(f, into)
  }
  prune(cfgRoot, KEEP_CONFIG, /^\d{4}-\d{2}-\d{2}$/)

  log(`OK  database ${users} accounts, ${ledger} ledger lines -> ${path.relative(DEST, out)} · ${files} config files -> config/${day}`)
}

main().catch(err => {
  log(`FAILED  ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
