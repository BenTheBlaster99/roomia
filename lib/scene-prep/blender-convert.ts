import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { SceneCamera } from '../scene-cameras'

/**
 * 22 Nov: formats beyond SketchUp's .dae and .glb. Blender (the one Roomia already renders with) reads FBX, OBJ, STL, PLY, USD, Alembic
 * and .blend; scripts/convert_to_glb.py turns any of them into a GLB in metres, Y-up, with its materials, textures and saved cameras,
 * and the usual preparation (normalizeGlb, the light viewport copy) follows.
 */
export const BLENDER_FORMATS = ['fbx', 'obj', 'stl', 'ply', 'usd', 'usda', 'usdc', 'usdz', 'abc', 'blend', 'ifc'] as const

/** Highest priority first: when a zip holds several, the first format found wins (IFC, FBX and USD carry units and axes; OBJ, STL, PLY do not). */
export const BLENDER_PRIORITY = ['ifc', 'fbx', 'usdz', 'usdc', 'usda', 'usd', 'blend', 'abc', 'obj', 'ply', 'stl'] as const

const TIMEOUT_MS = Number(process.env.ROOMIA_CONVERT_TIMEOUT_MS ?? 30 * 60_000)

export interface BlenderConversion {
  cameras: SceneCamera[]
  missingTextures: string[]
  unit: string
  scale: number
  upAxis: string
  objects: number
  triangles: number
  warnings: string[]
}

const ifcLib = () => {
  const root = path.join(/* turbopackIgnore: true */ process.cwd(), 'desktop')
  for (const d of [`pylib-ifc-${process.platform}`, 'pylib-ifc']) if (existsSync(path.join(root, d))) return path.join(root, d)
  return ''
}

const scriptPath = () => path.join(/* turbopackIgnore: true */ process.env.ROOMIA_SCRIPTS_DIR ?? path.join(process.cwd(), 'scripts'), 'convert_to_glb.py')

/** Converts one file with Blender (headless); throws a message fit for the person when it cannot. */
export async function convertWithBlender(
  input: string,
  outGlb: string,
  log: (line: string) => void = () => {},
  unit = 'auto',
): Promise<BlenderConversion> {
  const blender = process.env.ROOMIA_BLENDER ?? 'blender'
  const meta = outGlb.replace(/\.glb$/i, '') + '.convert.json'
  await rm(meta, { force: true })
  const args = ['-b', '--python', scriptPath(), '--', input, outGlb, meta, unit]
  const code = await new Promise<number>((resolve, reject) => {
    // IFC: the IfcOpenShell folder shipped with the app (desktop/pylib-ifc-<platform>), unless ROOMIA_IFC_LIB says otherwise
    const child = spawn(blender, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ROOMIA_IFC_LIB: process.env.ROOMIA_IFC_LIB ?? ifcLib() } })
    const tail: string[] = []
    const eat = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue
        tail.push(line)
        if (tail.length > 40) tail.shift()
        if (/^CONVERT_OK|^Error|Traceback|import failed|SystemExit/.test(line)) log(`convert: ${line.slice(0, 200)}`)
      }
    }
    child.stdout.on('data', eat)
    child.stderr.on('data', eat)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('La conversion du fichier a pris trop de temps. Exportez la scène en GLB pour un fichier plus léger.'))
    }, TIMEOUT_MS)
    child.on('error', err => {
      clearTimeout(timer)
      reject(new Error(`Blender est introuvable (${err.message}).`))
    })
    child.on('close', status => {
      clearTimeout(timer)
      if (status !== 0) {
        const why = tail.find(l => /the file holds no mesh|unsupported format|import failed/.test(l))
        reject(
          new Error(
            why?.includes('no mesh')
              ? 'Ce fichier ne contient aucune géométrie 3D.'
              : why?.includes('IFC reader')
                ? 'Le lecteur IFC n’est pas installé sur cette version de Roomia. Exportez en FBX, OBJ ou GLB.'
                : 'Ce fichier 3D n’a pas pu être lu. Réexportez-le en GLB ou FBX.',
          ),
        )
      } else resolve(0)
    })
  })
  void code
  const result = JSON.parse(await readFile(meta, 'utf8')) as BlenderConversion
  await rm(meta, { force: true })
  for (const w of result.warnings) log(`convert: ${w}`)
  return {
    ...result,
    cameras: result.cameras.map(c => ({ name: c.name, position: c.position, target: c.target, hfov: c.hfov })),
  }
}
