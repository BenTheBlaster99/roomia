/**
 * Lays out the textures stored inside a .skp the way the matching .dae export expects, so the
 * pair can be inspected or zipped by hand. (Uploads of a zip holding both files do this
 * automatically.)
 *
 *   npx tsx scripts/skp-textures.ts <model.dae> <model.skp> <outDir>
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { matchSkpTextures } from '../lib/scene-prep/skp-textures'

async function main() {
  const [daePath, skpPath, outDir] = process.argv.slice(2)
  if (!outDir) throw new Error('usage: skp-textures.ts <model.dae> <model.skp> <outDir>')
  await rm(outDir, { recursive: true, force: true })
  const work = path.join(outDir, '.work')
  await mkdir(work, { recursive: true })

  const match = await matchSkpTextures(readFileSync(daePath, 'utf8'), skpPath, work)
  for (const [image, file] of match.images) {
    const target = path.join(outDir, image)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(file, target)
  }
  await copyFile(daePath, path.join(outDir, path.basename(daePath)))
  await rm(work, { recursive: true, force: true })

  const { exact, suffix, fuzzy } = match.stats
  console.log(`${match.texturedMaterials} textured materials in the dae`)
  console.log(`matched: ${exact} exact, ${suffix} by number-stripped name, ${fuzzy} by close spelling`)
  console.log(`unmatched (${match.unmatched.length}): ${match.unmatched.join(', ') || '-'}`)
  console.log(`images written: ${(await readdir(outDir)).length - 1} folder(s) -> ${outDir}`)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
