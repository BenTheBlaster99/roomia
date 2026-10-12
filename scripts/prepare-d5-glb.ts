import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { clearNodeTransform, flatten, getBounds } from '@gltf-transform/functions'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const src = join(root, 'd5-tests/roomia-chair-01.glb')

/** glTF quat xyzw. +90 / -90 around X. */
const PLUS_X: [number, number, number, number] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
const MINUS_X: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]

async function bake(rotation: [number, number, number, number], outName: string) {
  const doc = await io.read(src)
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  if (!scene) throw new Error('no scene')

  const wrapper = doc.createNode('d5-orient').setRotation(rotation)
  for (const child of [...scene.listChildren()]) {
    scene.removeChild(child)
    wrapper.addChild(child)
  }
  scene.addChild(wrapper)

  await doc.transform(flatten())

  for (const node of scene.listChildren()) {
    if (!node.getMesh()) continue
    clearNodeTransform(node)
  }

  const { min, max } = getBounds(scene)
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  console.log(
    outName,
    'size',
    size.map(n => n.toFixed(3)).join(' x '),
    'min',
    min.map(n => n.toFixed(3)).join(', '),
  )

  const out = join(root, 'd5-tests', outName)
  await io.write(out, doc)
}

async function main() {
  await bake(PLUS_X, 'roomia-chair-01-d5.glb')
  await bake(MINUS_X, 'roomia-chair-01-d5-alt.glb')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
