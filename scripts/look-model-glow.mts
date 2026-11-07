// The walk model's glowing parts (7 Nov, look recipe): the recipe's glow materials are emission only, so the export
// gives them no base colour and the walk (model colour x splat light) drew them black. They become white.
// npx tsx scripts/look-model-glow.mts <model.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const file = process.argv[2]
await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(file)
let n = 0
for (const m of doc.getRoot().listMaterials()) {
  if (/^look_(glow|coveline|cap_glow)/.test(m.getName())) {
    console.log('glow material', m.getName(), m.getBaseColorFactor(), m.getEmissiveFactor())
    m.setBaseColorFactor([1, 1, 1, 1])
    m.setBaseColorTexture(null)
    n++
  }
}
await io.write(file, doc)
console.log(`${n} glow materials made white`)
