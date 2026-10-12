import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'lib/studio-import/__fixtures__')
mkdirSync(join(root, 'public/studio-import-fixtures'), { recursive: true })
mkdirSync(join(root, 'sketchup-tests/fixtures'), { recursive: true })
for (const name of ['room-z-up-mm.dae', 'room-y-up-m.obj']) {
  cpSync(join(src, name), join(root, 'public/studio-import-fixtures', name))
  cpSync(join(src, name), join(root, 'sketchup-tests/fixtures', name))
}
