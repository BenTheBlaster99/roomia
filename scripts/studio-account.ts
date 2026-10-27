/**
 * Studio accounts from the command line (the first admin can't be created from the web page).
 *
 *   npx tsx scripts/studio-account.ts create-admin <login> "<name>"     # asks for the password
 *   npx tsx scripts/studio-account.ts assign-scenes <login> [sceneId…]  # give existing scenes to an account
 *   npx tsx scripts/studio-account.ts list
 *
 * Uses ROOMIA_DB_PATH (default .data/roomia.db) and SCENES_DIR (default .scenes).
 */
import { readdir } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { createUser } from '../lib/auth'
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
  } else if (command === 'list') {
    for (const u of db.prepare('SELECT id, login, name, role, status, credits FROM users ORDER BY id').all()) {
      console.log(`${u.id}\t${u.login}\t${u.role}\t${u.status}\t${u.credits} crédits\t${u.name}`)
    }
  } else {
    console.log('commands: create-admin <login> "<name>" | assign-scenes <login> [sceneId…] | list')
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
