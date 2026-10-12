import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extractScene } from './unzip'

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&lt;|&gt;/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
const stripSuffix = (s: string) => s.replace(/_?\d+$/, '')

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1)
  return out
}

function similarity(a: string, b: string): number {
  const x = bigrams(a)
  const y = bigrams(b)
  let shared = 0
  for (const [k, n] of x) shared += Math.min(n, y.get(k) ?? 0)
  const total = [...x.values()].reduce((s, n) => s + n, 0) + [...y.values()].reduce((s, n) => s + n, 0)
  return total ? (2 * shared) / total : 0
}

export interface SkpTextureMatch {
  /** DAE image path (decoded, lower case, e.g. "cuisine belfar/wood_152.jpg") → extracted image file. */
  images: Map<string, string>
  stats: { exact: number; suffix: number; fuzzy: number }
  unmatched: string[]
  texturedMaterials: number
}

/**
 * A .skp is a zip (behind a short SketchUp header) that holds every texture of the model, one
 * folder per material. A .dae export only names its materials, so this pairs them up by
 * material name: exact first, then ignoring numeric suffixes, then by closest spelling.
 * Images are extracted into workDir; the caller removes it.
 */
export async function matchSkpTextures(
  daeText: string,
  skpPath: string,
  workDir: string,
): Promise<SkpTextureMatch> {
  const skp = await readFile(skpPath)
  const zipStart = skp.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  if (zipStart < 0) throw new Error('Ce .skp ne contient pas de textures lisibles (ancienne version de SketchUp ?)')
  await mkdir(workDir, { recursive: true })
  const plainZip = path.join(workDir, 'skp.zip')
  await writeFile(plainZip, skp.subarray(zipStart))
  const unzipped = path.join(workDir, 'skp')
  const files = await extractScene(plainZip, unzipped)

  // skp material folder → its largest image (skips the model thumbnails)
  const byMaterial = new Map<string, string>()
  for (const file of files) {
    const rel = path.relative(unzipped, file).split(path.sep)
    if (rel[0] !== 'materials' || rel.length < 3) continue
    const key = norm(rel[1])
    const current = byMaterial.get(key)
    if (!current || (await stat(file)).size > (await stat(current)).size) byMaterial.set(key, file)
  }

  const imagePath = new Map(
    [...daeText.matchAll(/<image id="([^"]+)">\s*<init_from>([^<]+)<\/init_from>/g)].map(m => [
      m[1],
      decodeURIComponent(m[2]),
    ]),
  )
  const effectImage = new Map<string, string>()
  for (const m of daeText.matchAll(/<effect id="([^"]+)">([\s\S]*?)<\/effect>/g)) {
    const surface = /<init_from>(ID\d+)<\/init_from>/.exec(m[2])
    if (surface && m[2].includes('<texture')) effectImage.set(m[1], surface[1])
  }
  const textured = [...daeText.matchAll(/<material id="[^"]*" name="([^"]*)">\s*<instance_effect url="#([^"]+)"/g)]
    .map(m => ({ name: m[1], image: imagePath.get(effectImage.get(m[2]) ?? '') }))
    .filter((m): m is { name: string; image: string } => Boolean(m.image))

  const keys = [...byMaterial.keys()]
  const result: SkpTextureMatch = {
    images: new Map(),
    stats: { exact: 0, suffix: 0, fuzzy: 0 },
    unmatched: [],
    texturedMaterials: textured.length,
  }
  for (const { name, image } of textured) {
    const k = norm(name)
    let hit: string | undefined = byMaterial.has(k) ? k : undefined
    let how: keyof SkpTextureMatch['stats'] = 'exact'
    if (!hit && byMaterial.has(stripSuffix(k))) [hit, how] = [stripSuffix(k), 'suffix']
    if (!hit) {
      const best = keys
        .map(c => ({ c, score: similarity(stripSuffix(k), stripSuffix(c)) }))
        .sort((a, b) => b.score - a.score)[0]
      if (best && best.score >= 0.8) [hit, how] = [best.c, 'fuzzy']
    }
    if (!hit) {
      result.unmatched.push(name)
      continue
    }
    result.stats[how]++
    result.images.set(image.replace(/\\/g, '/').toLowerCase(), byMaterial.get(hit)!)
  }
  return result
}
