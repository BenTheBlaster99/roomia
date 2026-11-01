import { stat } from 'node:fs/promises'
import { Logger, NodeIO, Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

const TEXTURE_SIZE = 1024

/**
 * Roomia Explorer's model (31 Oct): the scene Blender baked (explore.glb) made light enough to walk through in a browser.
 * The baked surfaces are drawn unlit, their texture times the baked light, so their normals go (a third of the file on
 * the Ecolodge). The walls keep their second UV map, the lightmap's (TEXCOORD_1, so `prune` must keep attributes no
 * material names), and the furniture its light per vertex (COLOR_0, log-encoded: 16 bits). Glass and lamps keep their
 * normals. Then the usual: shared vertices welded, quantized, meshopt, textures to WebP at 1024 px.
 */
export async function packExploreGlb(src: string, dst: string): Promise<{ inBytes: number; outBytes: number }> {
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read(src)
  doc.setLogger(new Logger(Logger.Verbosity.WARN))
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) {
        mesh.removePrimitive(prim)
        continue
      }
      const lightmapped = !!prim.getAttribute('TEXCOORD_1')
      if (!lightmapped && !prim.getAttribute('COLOR_0')) continue
      prim.setAttribute('NORMAL', null)
      // the lightmap's UVs need a TEXCOORD_0 before them; the furniture's first UVs only serve a texture
      if (!lightmapped && !prim.getMaterial()?.getBaseColorTexture()) prim.setAttribute('TEXCOORD_0', null)
    }
  }
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true }),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeTexcoord: 16, quantizeColor: 16 }),
  )
  await io.write(dst, doc)
  return { inBytes: (await stat(src)).size, outBytes: (await stat(dst)).size }
}
