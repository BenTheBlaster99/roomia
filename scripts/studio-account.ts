/**
 * Studio accounts from the command line (the first admin can't be created from the web page).
 *
 *   npx tsx scripts/studio-account.ts create-admin <login> "<name>"     # asks for the password
 *   npx tsx scripts/studio-account.ts assign-scenes <login> [sceneId…]  # give existing scenes to an account
 *   npx tsx scripts/studio-account.ts list
 *   npx tsx scripts/studio-account.ts create-user <login> "<name>"      # a Roomia Desktop account; asks for the password
 *   npx tsx scripts/studio-account.ts credits <login> <+N|-N> "<reason>" # e.g. credits sarah +20 "pilot"
 *   npx tsx scripts/studio-account.ts history <login>                  # the account's last 30 credit movements
 *   npx tsx scripts/studio-account.ts password <login>                 # a new password; signs out every device
 *   npx tsx scripts/studio-account.ts suspend|activate <login>
 *
 * The credit commands are recorded in the ledger under the first admin account.
 *
 * Uses ROOMIA_DB_PATH (default .data/roomia.db) and SCENES_DIR (default .scenes).
 */
import { readdir } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { createUser, setPassword } from '../lib/auth'
import { adjustCredits } from '../lib/credits'
import { getDb } from '../lib/db'
import { readMeta, SCENES_DIR, writeMeta } from '../lib/scene-store'

async function askHidden(question: string): Promise<string> {
  if (process.env.STUDIO_PASSWORD) return process.env.STUDIO_PASSWORD
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput
  ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (s.includes(question)) write.call(rl, s)
  }
  const answer = await rl.question(question)
  rl.close()
  process.stdout.write('\n')
  return answer
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const db = getDb()
  if (command === 'create-admin') {
    const [login, name = login] = args
    if (!login) throw new Error('usage: create-admin <login> "<name>"')
    const password = await askHidden('Mot de passe (10 caractères minimum) : ')
    const user = createUser({ login, name, password, role: 'admin' })
    console.log(`Admin « ${user.login} » créé (id ${user.id}).`)
  } else if (command === 'assign-scenes') {
    const [login, ...ids] = args
    const owner = db.prepare('SELECT id FROM users WHERE login = ?').get(login)
    if (!owner) throw new Error(`Compte « ${login} » introuvable.`)
    const targets = ids.length ? ids : await readdir(SCENES_DIR)
    let changed = 0
    for (const id of targets) {
      const meta = await readMeta(id).catch(() => null)
      if (!meta || (ids.length === 0 && meta.ownerId)) continue // without ids, only scenes nobody owns
      await writeMeta({ ...meta, ownerId: Number(owner.id) })
      changed++
      console.log(`${id}  ${meta.fileName}  → ${login}`)
    }
    console.log(`${changed} scène(s) attribuée(s).`)
  } else if (command === 'create-user') {
    const [login, name = login] = args
    if (!login) throw new Error('usage: create-user <login> "<name>"')
    const password = await askHidden('Mot de passe (10 caractères minimum) : ')
    const user = createUser({ login, name, password })
    console.log(`Compte « ${user.login} » créé (id ${user.id}, 0 crédit).`)
  } else if (command === 'credits') {
    const [login, amount, ...why] = args
    const user = db.prepare('SELECT id FROM users WHERE login = ?').get(login ?? '')
    if (!user) throw new Error(`Compte « ${login} » introuvable.`)
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()
    if (!admin) throw new Error('Aucun compte admin : créez-en un avec create-admin.')
    const balance = adjustCredits(Number(user.id), Number(amount), why.join(' '), Number(admin.id))
    console.log(`« ${login} » : ${Number(amount) > 0 ? '+' : ''}${Number(amount)} → solde ${balance} crédit(s).`)
  } else if (command === 'history') {
    const [login] = args
    const user = db.prepare('SELECT id, credits FROM users WHERE login = ?').get(login ?? '')
    if (!user) throw new Error(`Compte « ${login} » introuvable.`)
    const rows = db.prepare('SELECT at, kind, delta, balance_after, outcome, detail FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(user.id)
    for (const r of rows) {
      const delta = Number(r.delta)
      console.log(`${new Date(Number(r.at)).toISOString().slice(0, 16).replace('T', ' ')}\t${r.kind}\t${delta > 0 ? '+' : ''}${delta}\t→ ${r.balance_after}\t${r.outcome ?? ''}\t${r.detail ?? ''}`)
    }
    console.log(`Solde : ${user.credits} crédit(s).`)
  } else if (command === 'password') {
    const [login] = args
    const user = db.prepare('SELECT id FROM users WHERE login = ?').get(login ?? '')
    if (!user) throw new Error(`Compte « ${login} » introuvable.`)
    setPassword(Number(user.id), await askHidden('Nouveau mot de passe (10 caractères minimum) : '))
    console.log(`Mot de passe de « ${login} » changé.`)
  } else if (command === 'suspend' || command === 'activate') {
    const [login] = args
    const res = db.prepare('UPDATE users SET status = ? WHERE login = ?').run(command === 'suspend' ? 'suspended' : 'active', login ?? '')
    if (!res.changes) throw new Error(`Compte « ${login} » introuvable.`)
    if (command === 'suspend') db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE login = ?)').run(login)
    console.log(`« ${login} » : ${command === 'suspend' ? 'suspendu (déconnecté partout)' : 'réactivé'}.`)
  } else if (command === 'list') {
    for (const u of db.prepare('SELECT id, login, name, role, status, credits FROM users ORDER BY id').all()) {
      console.log(`${u.id}\t${u.login}\t${u.role}\t${u.status}\t${u.credits} crédits\t${u.name}`)
    }
  } else {
    console.log('commands: create-admin | create-user | credits | history | password | suspend | activate | assign-scenes | list (see the top of this file)')
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
