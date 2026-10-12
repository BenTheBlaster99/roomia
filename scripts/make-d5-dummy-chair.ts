import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO, Primitive } from '@gltf-transform/core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'd5-tests/d5-dummy-chair.glb')

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
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ])
  const idx = new Uint16Array([
    0, 1, 2, 0, 2, 3, 1, 5, 6, 1, 6, 2, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7, 3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0,
  ])
  const position = doc.createAccessor(`${name}-pos`).setType('VEC3').setArray(pos).setBuffer(buffer)
  const indices = doc.createAccessor(`${name}-idx`).setType('SCALAR').setArray(idx).setBuffer(buffer)
  const material = doc
    .createMaterial(name)
    .setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.55)
  const prim = doc
    .createPrimitive()
    .setMode(Primitive.Mode.TRIANGLES)
    .setAttribute('POSITION', position)
    .setIndices(indices)
    .setMaterial(material)
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim))
}

async function main() {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('dummy-chair')
  doc.getRoot().setDefaultScene(scene)

  const wood: [number, number, number] = [0.55, 0.32, 0.16]
  const seatW = 0.5
  const seatD = 0.48
  const seatY0 = 0.45
  const seatY1 = 0.5
  const leg = 0.045
  const inset = 0.04
  const hx = seatW / 2
  const hz = seatD / 2

  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const cx = sx * (hx - inset)
    const cz = sz * (hz - inset)
    scene.addChild(
      addBox(
        doc,
        buffer,
        `leg-${sx}-${sz}`,
        [cx - leg / 2, 0, cz - leg / 2],
        [cx + leg / 2, seatY0, cz + leg / 2],
        wood,
      ),
    )
  }

  scene.addChild(addBox(doc, buffer, 'seat', [-hx, seatY0, -hz], [hx, seatY1, hz], [0.62, 0.38, 0.2]))
  scene.addChild(
    addBox(doc, buffer, 'back', [-hx, seatY1, -hz], [hx, 1.0, -hz + 0.05], [0.5, 0.28, 0.14]),
  )

  await new NodeIO().write(out, doc)
  console.log('wrote', out)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
