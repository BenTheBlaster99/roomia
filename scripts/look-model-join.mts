// Fewer draw calls for a big walk model (7 Nov, Phase 8): F5's model is 4.9 M triangles in 3755 pieces, drawn several
// times a frame (colours, depth, gloss, mirror): 11 fps. Pieces with the same material are joined (no geometry lost).
// npx tsx scripts/look-model-join.mts <in.glb> <out.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dequantize, flatten, join, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const [src, dst] = process.argv.slice(2)
await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(src)
const count = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0)
const before = count()
// D5's light icons are hidden by the walk through their names, which joining loses: they go first
let gone = 0
for (const node of doc.getRoot().listNodes())
  if (/D5RenderLight/i.test(node.getName())) {
    node.traverse(n => n.setMesh(null))
    gone++
  }
await doc.transform(dequantize(), flatten(), join({ keepNamed: false }), prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeTexcoord: 16, quantizeNormal: 10 }))
await io.write(dst, doc)
console.log(`pieces ${before} -> ${count()}, ${gone} D5 icons removed`)
