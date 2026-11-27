import { rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { assertDaeReadable, convertDaeToGlb } from './dae-to-glb'
import { readFile } from 'node:fs/promises'
import { fromSketchUpScenes, type SceneCamera } from '../scene-cameras'
import { buildTextureIndex, emptyTextureIndex } from './textures'
import { matchSkpTextures } from './skp-textures'
import { extractScene } from './unzip'
import { normalizeGlb } from './normalize-glb'
import { makeViewportGlb, type ViewportReport } from './viewport'
import { BLENDER_FORMATS, BLENDER_PRIORITY, convertWithBlender } from './blender-convert'

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
    /** Textures the exporter replaced with an "invalid Texture" image; removed from the scene. */
    placeholderTextures: number
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

/** The file a Blender-readable zip is made of: the highest-priority format, then the largest file of it. */
async function blenderFile(files: string[]): Promise<string | null> {
  for (const ext of BLENDER_PRIORITY) {
    const found = await largest(files, `.${ext}`)
    if (found) return found
  }
  return null
}

/** FBX, OBJ, STL, PLY, USD, Alembic, .blend (22 Nov): Blender makes the GLB, the usual preparation follows. */
async function prepareWithBlender(
  file: string,
  sourcePath: string,
  log: (line: string) => void,
): Promise<{ missingTextures: string[]; cameras: SceneCamera[]; placeholderTextures: number }> {
  const converted = join(dirname(sourcePath), 'converted.glb')
  try {
    const r = await convertWithBlender(file, converted, log)
    log(`blender: ${r.objects} objects, ${r.triangles} triangles, ${r.cameras.length} cameras (unit ${r.unit}, up ${r.upAxis})`)
    const placeholderTextures = await normalizeGlb(converted, sourcePath, log)
    return { missingTextures: r.missingTextures, cameras: r.cameras, placeholderTextures }
  } finally {
    await rm(converted, { force: true })
  }
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
  let placeholderTextures = 0

  if (ext === '.zip') {
    const unzipped = join(outDir, 'unzipped')
    const files = await extractScene(input, unzipped)
    log(`zip: ${files.length} files extracted`)
    try {
      const dae = await largest(files, '.dae')
      const glb = await largest(files, '.glb')
      if (dae) {
        await assertDaeReadable(dae)
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
        placeholderTextures = await normalizeGlb(glb, sourcePath, log)
      } else if (await largest(files, '.gltf')) {
        placeholderTextures = await normalizeGlb((await largest(files, '.gltf'))!, sourcePath, log)
      } else if (await blenderFile(files)) {
        const r = await prepareWithBlender((await blenderFile(files))!, sourcePath, log)
        missingTextures = r.missingTextures
        cameras = r.cameras
        placeholderTextures = r.placeholderTextures
      } else {
        throw new Error('Le zip ne contient aucun modèle 3D reconnu (.dae, .glb, .gltf, .fbx, .obj, .usd, .blend…)')
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
  } else if (ext === '.glb' || ext === '.gltf') {
    placeholderTextures = await normalizeGlb(input, sourcePath, log)
  } else if ((BLENDER_FORMATS as readonly string[]).includes(ext.slice(1))) {
    const r = await prepareWithBlender(input, sourcePath, log)
    missingTextures = r.missingTextures
    cameras = r.cameras
    placeholderTextures = r.placeholderTextures
  } else {
    throw new Error(`Unsupported scene format "${ext}" for ${name}: use .zip, .dae, .glb, .fbx, .obj, .usd or .blend`)
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
      placeholderTextures,
    },
  }
}
