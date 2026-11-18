import { spawn } from 'node:child_process'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BLENDER } from './blender-render'
import { isMaterialFamily, type MaterialFamily } from './material-roles'
import { SCENES_DIR, sceneDir, sourcePath } from './scene-store'

/**
 * The PC's material library (18 Nov): what the designer said a material is, by its name, kept beside the projects folder so the
 * next project with the same library material (Sarah's "R250_G250_B250" walls, her "*33" mirror) needs no tag. The 360° render
 * reads it too (scripts/look_materials.py overlay: this project's tag, then the library, then Roomia's own guess).
 */
export const libraryPath = () => path.join(path.dirname(path.resolve(SCENES_DIR)), 'material-library.json')

export async function readLibrary(): Promise<Record<string, MaterialFamily>> {
  const raw = JSON.parse(await readFile(libraryPath(), 'utf8').catch(() => '{}')) as { families?: Record<string, unknown> }
  const out: Record<string, MaterialFamily> = {}
  for (const [name, family] of Object.entries(raw.families ?? {})) if (isMaterialFamily(family)) out[name] = family
  return out
}

/** Adds (or, with null, forgets) what these materials are. */
export async function rememberFamilies(changes: Record<string, MaterialFamily | null>) {
  const families: Record<string, MaterialFamily> = await readLibrary()
  for (const [name, family] of Object.entries(changes)) {
    if (!name || name.length > 200) continue
    if (family) families[name] = family
    else delete families[name]
  }
  await mkdir(path.dirname(libraryPath()), { recursive: true })
  await writeFile(libraryPath(), JSON.stringify({ families }, null, 1))
}

/** Roomia's own guess for a material: its family and how it was found ("name", "picture"), or what the designer said. */
export interface MaterialGuess {
  family: string
  why: 'name' | 'picture' | 'library' | 'tag'
  textured: boolean
}

const exists = (p: string) => access(p).then(() => true, () => false)

async function pythonExe(): Promise<string> {
  if (process.env.ROOMIA_LOOK_PYTHON) return process.env.ROOMIA_LOOK_PYTHON
  const dir = path.dirname(BLENDER)
  for (const p of [path.join(dir, '4.5', 'python', 'bin', 'python3.11'), path.join(dir, '4.5', 'python', 'bin', 'python.exe')]) if (await exists(p)) return p
  return 'python3'
}

/**
 * Every material's family as the next 360° render will use it (scripts/look_materials.py, the same code: name, picture, then the
 * designer's tags and the library on top). A few seconds the first time for a project (it reads the file's pictures), then cached.
 */
export async function guessFamilies(id: string): Promise<{ guesses: Record<string, MaterialGuess>; total: number }> {
  const out = path.join(sceneDir(id), 'look', 'auto', 'materials-classes.json')
  await mkdir(path.dirname(out), { recursive: true })
  const source = sourcePath(id)
  if (!(await stat(source).catch(() => null))) return { guesses: {}, total: 0 }
  const python = await pythonExe()
  const stdout = await new Promise<string>(resolve => {
    const child = spawn(python, [path.join(process.cwd(), 'scripts', 'look_materials.py'), source, out, sceneDir(id), '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    let acc = ''
    child.stdout.on('data', d => (acc += String(d)))
    child.on('close', () => resolve(acc))
    child.on('error', () => resolve(''))
  })
  const line = stdout.split('\n').find(l => l.startsWith('MATERIALS_JSON '))
  if (!line) return { guesses: {}, total: 0 }
  return JSON.parse(line.slice('MATERIALS_JSON '.length)) as { guesses: Record<string, MaterialGuess>; total: number }
}
