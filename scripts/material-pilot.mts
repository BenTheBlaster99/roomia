// AI material pilot (7 Nov, ChatGPT step 7): a better base-colour texture for a few materials, made ONCE from the
// material's own texture (or its colour), applied to the model before Cycles so Cycles, the splat and the walk share it.
// Base colour only; roughness/metal untouched. Cached by material name + source hash; the original stays the reference.
//
// npx tsx --env-file=.env.local scripts/material-pilot.mts <sceneId> <model.glb> '<json [{name, kind, repeat}]>' [--dry]
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { toFile } from 'openai'
import { extractImageBase64 } from '../lib/extract-image-b64'
import { GPT_IMAGE_MODEL, getOpenAIClient } from '../lib/openai-client'
import { sceneDir } from '../lib/scene-store'

const [sceneId, modelPath, listJson, flag] = process.argv.slice(2)
const list = JSON.parse(listJson) as { name: string; kind: string; repeat?: number }[]
const dry = flag === '--dry'

const HINT: Record<string, string> = {
  paint: 'a painted plaster wall: extremely subtle, fine, even surface variation only (faint trowel softness, micro grain); no pores, no cracks, no stains, no visible pattern',
  stone: 'a natural stone (granite or marble) slab: keep the exact vein size, vein density, vein direction and grain of the reference; only make it sharper and more natural',
  fabric: 'an upholstery fabric: a fine, regular weave at the scale of the reference; no folds, no seams, no stitching',
  leather: 'a leather upholstery: fine natural grain at the scale of the reference; no seams, no wrinkles, no stitching',
  wood: 'a wood veneer: keep grain direction and plank width; only sharper natural grain',
}
const prompt = (kind: string) => `Create a seamless, tileable architectural material base-color (albedo) texture from the supplied reference: ${HINT[kind] ?? HINT.paint}.
Preserve: the original material identity, its dominant hue and colour distribution, its pattern and characteristic features, its physical feature scale, its natural directionality.
Do not: invent new veins, patterns, knots or decorative details; change it into another material; add lighting, shadows, ambient occlusion, reflections or highlights; add perspective, objects, borders or visible seams; exaggerate contrast or texture.
Output: a flat orthographic surface under perfectly uniform illumination, no baked lighting, no specular highlights, seamless on all four edges, albedo only.`

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(modelPath)
const out = path.join(sceneDir(sceneId), 'materials-ai')
await mkdir(out, { recursive: true })
const client = dry ? null : getOpenAIClient()
const results: Record<string, unknown>[] = []
const madeByHash = new Map<string, string>()
for (const item of list) {
  const mat = doc.getRoot().listMaterials().find(m => m.getName() === item.name)
  if (!mat) {
    console.log('MISSING', item.name)
    continue
  }
  const tex = mat.getBaseColorTexture()
  const factor = mat.getBaseColorFactor()
  let ref: Buffer
  if (tex?.getImage()) {
    // the material's own texture, tinted by its factor as Blender shows it, at least 1024 px
    const img = sharp(Buffer.from(tex.getImage()!)).removeAlpha()
    const meta = await img.metadata()
    const s = Math.max(1024, Math.min(2048, Math.max(meta.width ?? 1024, meta.height ?? 1024)))
    ref = await img.resize(s, s, { fit: 'fill' }).linear(factor.slice(0, 3).map(v => v) as unknown as number[], [0, 0, 0]).png().toBuffer()
  } else {
    // a flat colour: the swatch itself (linear factor -> sRGB)
    const srgb = factor.slice(0, 3).map(c => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)))
    ref = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: srgb[0], g: srgb[1], b: srgb[2] } } }).png().toBuffer()
  }
  const hash = createHash('sha1').update(ref).update(item.kind).digest('hex').slice(0, 10)
  const safe = item.name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40) || 'mat'
  const file = path.join(out, `${safe}-${hash}.jpg`)
  await writeFile(path.join(out, `${safe}-ref.png`), ref)
  // the same colour and kind as another material in this run: the same texture (one image)
  if (madeByHash.has(hash)) {
    console.log('SHARED', item.name, madeByHash.get(hash))
    results.push({ ...item, file: madeByHash.get(hash), ref: path.join(out, `${safe}-ref.png`), shared: true })
    continue
  }
  if (await stat(file).catch(() => null)) {
    madeByHash.set(hash, file)
    console.log('CACHED', item.name, file)
    results.push({ ...item, file, ref: path.join(out, `${safe}-ref.png`), cached: true })
    continue
  }
  if (dry) {
    console.log('DRY', item.name, tex ? 'texture' : 'colour', hash)
    continue
  }
  const t0 = Date.now()
  const response = await client!.images.edit(
    { model: GPT_IMAGE_MODEL, image: await toFile(ref, 'ref.png', { type: 'image/png' }), prompt: prompt(item.kind), quality: 'high', input_fidelity: 'high',
      output_format: 'jpeg', response_format: 'b64_json', size: '1024x1024' } as never,
    { maxRetries: 0, timeout: 170_000 },
  )
  const b64 = await extractImageBase64(response)
  let img = Buffer.from(b64, 'base64')
  // make it tile: blend each edge with the opposite one over 8% (the model's "seamless" is not always exact)
  const raw = await sharp(img).resize(1024, 1024).removeAlpha().raw().toBuffer()
  const N = 1024, B = Math.round(N * 0.08)
  const px = new Float32Array(raw)
  const get = (x: number, y: number, c: number) => px[(y * N + x) * 3 + c]
  const outPx = Buffer.alloc(N * N * 3)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      for (let c = 0; c < 3; c++) {
        let v = get(x, y, c)
        const wx = x < B ? 0.5 * (1 - x / B) : x >= N - B ? 0.5 * (1 - (N - 1 - x) / B) : 0
        const wy = y < B ? 0.5 * (1 - y / B) : y >= N - B ? 0.5 * (1 - (N - 1 - y) / B) : 0
        if (wx > 0) v = v * (1 - wx) + get(N - 1 - x, y, c) * wx
        if (wy > 0) v = v * (1 - wy) + get(x, N - 1 - y, c) * wy
        outPx[(y * N + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(v)))
      }
  img = await sharp(outPx, { raw: { width: N, height: N, channels: 3 } }).jpeg({ quality: 93 }).toBuffer()
  await writeFile(file, img)
  madeByHash.set(hash, file)
  console.log('MADE', item.name, `${((Date.now() - t0) / 1000).toFixed(0)}s`, file)
  results.push({ ...item, file, ref: path.join(out, `${safe}-ref.png`), seconds: (Date.now() - t0) / 1000 })
}
await writeFile(path.join(out, 'pilot.json'), JSON.stringify(results, null, 1))
console.log(`DONE ${results.length} materials`)
