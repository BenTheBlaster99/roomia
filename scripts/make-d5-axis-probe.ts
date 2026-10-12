import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO, Primitive } from '@gltf-transform/core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'd5-tests/d5-axis-probe.glb')

/** Axis-aligned box from min to max (glTF Y-up, meters). */
function addBox(
  doc: Document,
  buffer: ReturnType<Document['createBuffer']>,
  name: string,
  min: [number, number, number],
  max: [number, number, number],
  rgb: [number, number, number],
) {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const pos = new Float32Array([
    x0, y0, z0,  x1, y0, z0,  x1, y1, z0,  x0, y1, z0,
    x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1,
  ])
  const idx = new Uint16Array([
    0, 1, 2, 0, 2, 3,
    1, 5, 6, 1, 6, 2,
    5, 4, 7, 5, 7, 6,
    4, 0, 3, 4, 3, 7,
    3, 2, 6, 3, 6, 7,
    4, 5, 1, 4, 1, 0,
  ])

  const position = doc
    .createAccessor(`${name}-pos`)
    .setType('VEC3')
    .setArray(pos)
    .setBuffer(buffer)
  const indices = doc
    .createAccessor(`${name}-idx`)
    .setType('SCALAR')
    .setArray(idx)
    .setBuffer(buffer)
  const material = doc
    .createMaterial(name)
    .setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.6)
  const prim = doc
    .createPrimitive()
    .setMode(Primitive.Mode.TRIANGLES)
    .setAttribute('POSITION', position)
    .setIndices(indices)
    .setMaterial(material)
  const mesh = doc.createMesh(name).addPrimitive(prim)
  return doc.createNode(name).setMesh(mesh)
}

async function main() {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('d5-axis-probe')
  doc.getRoot().setDefaultScene(scene)

  const t = 0.05
  // Standard glTF: +X red 1.0 m, +Y green 1.5 m (up), +Z blue 2.0 m. No extra rotation.
  scene.addChild(addBox(doc, buffer, 'X-red', [0, -t, -t], [1.0, t, t], [1, 0.08, 0.08]))
  scene.addChild(addBox(doc, buffer, 'Y-green', [-t, 0, -t], [t, 1.5, t], [0.12, 0.85, 0.18]))
  scene.addChild(addBox(doc, buffer, 'Z-blue', [-t, -t, 0], [t, t, 2.0], [0.15, 0.35, 1]))

  await new NodeIO().write(out, doc)
  console.log('wrote', out)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
