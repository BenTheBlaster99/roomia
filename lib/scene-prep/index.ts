import { rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { convertDaeToGlb } from './dae-to-glb'
import { readFile } from 'node:fs/promises'
import { fromSketchUpScenes, type SceneCamera } from '../scene-cameras'
import { buildTextureIndex, emptyTextureIndex } from './textures'
import { matchSkpTextures } from './skp-textures'
import { extractScene } from './unzip'
import { normalizeGlb } from './normalize-glb'
import { makeViewportGlb, type ViewportReport } from './viewport'

export interface PreparedScene {
  /** Full-quality GLB kept for server-side rendering. Never simplified. */
  sourcePath: string
  /** Light GLB Studio opens. */
  viewportPath: string
  report: ViewportReport & {
    convertSeconds: number
    totalSeconds: number
    embeddedTextures: number
    missingTextures: string[]
    cameraCount: number
  }
}

async function largest(files: string[], ext: string): Promise<string | null> {
  const matching = files.filter(f => extname(f).toLowerCase() === ext)
  let best: { file: string; size: number } | null = null
  for (const file of matching) {
    const { size } = await stat(file)
    if (!best || size > best.size) best = { file, size }
  }
  return best?.file ?? null
}

/**
 * Turns an uploaded scene (.glb, SketchUp's .dae, or a .zip holding a .dae and its texture
 * images) into a source GLB plus a light viewport GLB inside outDir. The upload is left untouched.
 */
export async function prepareScene(
  input: string,
  outDir: string,
  log: (line: string) => void = () => {},
): Promise<PreparedScene> {
  const t0 = performance.now()
  const ext = extname(input).toLowerCase()
  const name = basename(input, extname(input))
  const sourcePath = join(outDir, 'source.glb')
  const viewportPath = join(outDir, 'viewport.glb')

  let embeddedTextures = 0
  let missingTextures: string[] = []
  let cameras: SceneCamera[] = []

  if (ext === '.zip') {
    const unzipped = join(outDir, 'unzipped')
    const files = await extractScene(input, unzipped)
    log(`zip: ${files.length} files extracted`)
    try {
      const dae = await largest(files, '.dae')
      const glb = await largest(files, '.glb')
      if (dae) {
        const index = await buildTextureIndex(unzipped)
        // The .skp holds every texture of the model: use it for images the zip doesn't provide.
        const skp = await largest(files, '.skp')
        if (skp) {
          const match = await matchSkpTextures(await readFile(dae, 'utf8'), skp, join(outDir, 'skp-work'))
          for (const [image, file] of match.images) if (!index.byPath.has(image)) index.byPath.set(image, file)
          const { exact, suffix, fuzzy } = match.stats
          log(`skp: ${exact + suffix + fuzzy}/${match.texturedMaterials} textures found (${match.unmatched.length} unmatched)`)
        }
        const result = await convertDaeToGlb(dae, sourcePath, log, index)
        embeddedTextures = result.embeddedTextures
        missingTextures = result.missingTextures
        cameras = result.cameras
      } else if (glb) {
        await normalizeGlb(glb, sourcePath, log)
      } else {
        throw new Error('Le zip ne contient ni .dae ni .glb')
      }
      // A saved-scenes JSON (e.g. from the Z5 Camera Transfer extension) is authoritative.
      for (const file of files.filter(f => extname(f).toLowerCase() === '.json')) {
        const fromJson = fromSketchUpScenes(JSON.parse(await readFile(file, 'utf8').catch(() => 'null')))
        if (fromJson.length) {
          cameras = fromJson
          break
        }
      }
    } finally {
      await rm(unzipped, { recursive: true, force: true })
      await rm(join(outDir, 'skp-work'), { recursive: true, force: true })
    }
  } else if (ext === '.dae') {
    const result = await convertDaeToGlb(input, sourcePath, log, emptyTextureIndex())
    embeddedTextures = result.embeddedTextures
    missingTextures = result.missingTextures
    cameras = result.cameras
  } else if (ext === '.glb') {
    await normalizeGlb(input, sourcePath, log)
  } else {
    throw new Error(`Unsupported scene format "${ext}" for ${name}: use .zip, .dae or .glb`)
  }
  const convertSeconds = (performance.now() - t0) / 1000
  if (cameras.length) {
    await writeFile(join(outDir, 'cameras.json'), JSON.stringify(cameras))
    log(`scenes: ${cameras.length} saved views (${cameras.map(c => c.name).join(', ')})`)
  }

  const report = await makeViewportGlb(sourcePath, viewportPath, log)
  return {
    sourcePath,
    viewportPath,
    report: {
      ...report,
      convertSeconds,
      totalSeconds: (performance.now() - t0) / 1000,
      embeddedTextures,
      missingTextures,
      cameraCount: cameras.length,
    },
  }
}
