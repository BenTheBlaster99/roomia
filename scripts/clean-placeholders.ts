/**
 * One-off cleanup for scenes prepared before placeholder removal existed: drops the SimLab
 * "invalid Texture" images from each ready scene's source.glb and rebuilds its viewport.
 *
 *   npx tsx scripts/clean-placeholders.ts
 */
import { access, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { normalizeGlb, removePlaceholderTextures } from '../lib/scene-prep/normalize-glb'
import { makeViewportGlb } from '../lib/scene-prep/viewport'

const SCENES = path.join(process.cwd(), '.scenes')
const exists = (file: string) => access(file).then(() => true, () => false)

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  for (const id of await readdir(SCENES)) {
    const dir = path.join(SCENES, id)
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => 'null'))
    if (meta?.status !== 'ready' || meta.report?.placeholderTextures !== undefined) continue
    const source = path.join(dir, 'source.glb')
    // Temp names must end in .glb: gltf-transform picks the output format from the extension.
    const tmpSource = path.join(dir, 'source.tmp.glb')
    const tmpViewport = path.join(dir, 'viewport.tmp.glb')
    let removed: number
    if (await exists(source)) {
      const doc = await io.read(source)
      removed = await removePlaceholderTextures(doc)
      if (removed) await writeFile(tmpSource, await io.writeBinary(doc))
    } else {
      // Rebuild a lost source from the upload (GLB scenes only): normalizing now includes the cleanup.
      removed = await normalizeGlb(path.join(dir, 'original.glb'), tmpSource)
      if (!removed) await rename(tmpSource, source)
    }
    if (removed) {
      await rename(tmpSource, source)
      await makeViewportGlb(source, tmpViewport, () => {})
      await rename(tmpViewport, path.join(dir, 'viewport.glb'))
    }
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ ...meta, report: { ...meta.report, placeholderTextures: removed } }))
    console.log(`${id} (${meta.fileName}): ${removed} placeholder textures removed`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
