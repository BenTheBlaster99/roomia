// The copy of the published tours for when the PC is off (lib/tour-mirror.ts, cloudflare/tour-fallback/).
//   npx tsx --env-file=.env.local scripts/tour-mirror.mts <id>... | --all   [--folder <dir>] [--upload]
// --folder writes the copy to a local folder (to test it); --upload sends what changed to R2. The Studio must be running.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { collectStatic, collectTour, uploadToR2, writeToFolder } from '../lib/tour-mirror'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const folder = args.includes('--folder') ? args[args.indexOf('--folder') + 1] : null
const scenes = process.env.SCENES_DIR ?? path.join(process.cwd(), '.scenes')
let ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--folder')
if (flag('--all')) {
  ids = []
  for (const id of await readdir(scenes)) {
    const meta = JSON.parse(await readFile(path.join(scenes, id, 'meta.json'), 'utf8').catch(() => '{}'))
    if (meta.published && meta.status === 'ready') ids.push(id)
  }
}
const dist = path.join(process.cwd(), process.env.ROOMIA_DIST ?? '.next')
const objects = await collectStatic(dist)
console.log(`static: ${objects.length} files from ${dist}`)
for (const id of ids) {
  const o = await collectTour(id)
  console.log(`${id}: ${o.length} files, ${(o.reduce((n, x) => n + x.body.length, 0) / 1e6).toFixed(1)} MB`)
  objects.push(...o)
}
if (folder) await writeToFolder(folder, objects)
if (flag('--upload')) console.log('R2:', await uploadToR2(objects))
process.exit(0)
