import { readFile } from 'node:fs/promises'
import {
  Document,
  NodeIO,
  type Material,
  type Mesh,
  type Primitive,
  type Texture,
} from '@gltf-transform/core'
import { DOMParser } from '@xmldom/xmldom'
import * as THREE from 'three'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import { cleanCameraName, type SceneCamera } from '../scene-cameras'
import { GLASS_ALPHA, GLASS_NAME } from './normalize-glb'
import { emptyTextureIndex, readTexture, resolveTexture, type TextureIndex } from './textures'

type Log = (line: string) => void

/** Shown instead of a texture whose image file was not provided. */
const MISSING_TEXTURE_GREY = 0.75

export interface DaeConversion {
  /** Images found and embedded in the GLB. */
  embeddedTextures: number
  /** Image paths the DAE asked for that were not among the provided files. */
  missingTextures: string[]
  /** SketchUp scenes saved in the DAE, in the GLB's frame. */
  cameras: SceneCamera[]
}

function floats(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  if (!('isInterleavedBufferAttribute' in attr) && !attr.normalized && attr.array instanceof Float32Array) {
    return attr.array
  }
  const out = new Float32Array(attr.count * attr.itemSize)
  for (let i = 0; i < attr.count; i++) {
    out[i * attr.itemSize] = attr.getX(i)
    if (attr.itemSize > 1) out[i * attr.itemSize + 1] = attr.getY(i)
    if (attr.itemSize > 2) out[i * attr.itemSize + 2] = attr.getZ(i)
  }
  return out
}

/** COLLADA puts texture (0,0) at the bottom-left, glTF at the top-left. */
function flipV(uv: Float32Array): Float32Array {
  const out = new Float32Array(uv)
  for (let i = 1; i < out.length; i += 2) out[i] = 1 - out[i]
  return out
}

function textureUrl(material: THREE.Material): string | null {
  const map = (material as THREE.MeshPhongMaterial).map
  const url = map?.userData?.sourceUrl
  return typeof url === 'string' ? url : null
}

/**
 * COLLADA (SketchUp's usual export) → GLB, in metres and Y-up, exactly as Studio's
 * browser import would see it. Geometry is kept in full, and so are textures: images are
 * looked up in `textures` (the files unzipped next to the DAE) and embedded at full size.
 * Lines/points are left out.
 */
export async function convertDaeToGlb(
  input: string,
  output: string,
  log: Log = () => {},
  textures: TextureIndex = emptyTextureIndex(),
): Promise<DaeConversion> {
  const text = await readFile(input, 'utf8')

  // ColladaLoader wants a browser: give it an XML parser, and instead of fetching images
  // just remember which file each texture asks for.
  const prevDom = (globalThis as { DOMParser?: unknown }).DOMParser
  const prevLoad = THREE.TextureLoader.prototype.load
  ;(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser
  THREE.TextureLoader.prototype.load = (url: string) => {
    const placeholder = new THREE.Texture() as THREE.Texture<HTMLImageElement>
    placeholder.userData.sourceUrl = url
    return placeholder
  }
  let collada: ReturnType<ColladaLoader['parse']>
  try {
    collada = new ColladaLoader().parse(text, '')
  } finally {
    ;(globalThis as { DOMParser?: unknown }).DOMParser = prevDom
    THREE.TextureLoader.prototype.load = prevLoad
  }
  if (!collada) throw new Error('Fichier COLLADA illisible')
  collada.scene.updateMatrixWorld(true)

  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('scene')

  // Load each distinct image once, before building materials.
  const wanted = new Set<string>()
  collada.scene.traverse(obj => {
    const mats = (obj as THREE.Mesh).material
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      const url = textureUrl(m)
      if (url) wanted.add(url)
    }
  })
  const glbTextures = new Map<string, Texture | null>()
  const missingTextures: string[] = []
  for (const url of wanted) {
    const file = resolveTexture(textures, url)
    const data = file ? await readTexture(file) : null
    if (!data) {
      glbTextures.set(url, null)
      missingTextures.push(decodeURIComponent(url))
      continue
    }
    glbTextures.set(
      url,
      doc.createTexture(url.split('/').pop() ?? url).setImage(data.bytes).setMimeType(data.mimeType),
    )
  }

  const materials = new Map<string, Material>()
  const meshes = new Map<string, Mesh>()
  let skippedLines = 0
  const cameras: SceneCamera[] = []

  const accessor = (type: 'SCALAR' | 'VEC2' | 'VEC3', array: Float32Array | Uint32Array) =>
    doc.createAccessor().setType(type).setArray(array as Float32Array<ArrayBuffer>).setBuffer(buffer)

  function material(src: THREE.Material): Material {
    const cached = materials.get(src.uuid)
    if (cached) return cached
    const m = src as THREE.MeshPhongMaterial
    const alpha = m.transparent ? m.opacity : GLASS_NAME.test(src.name) ? GLASS_ALPHA : 1
    const out = doc
      .createMaterial(src.name)
      .setRoughnessFactor(0.8)
      .setMetallicFactor(0)
      .setDoubleSided(true)

    const url = textureUrl(src)
    const texture = url ? glbTextures.get(url) : null
    if (texture) {
      out.setBaseColorFactor([1, 1, 1, alpha]).setBaseColorTexture(texture)
    } else if (url) {
      out.setBaseColorFactor([MISSING_TEXTURE_GREY, MISSING_TEXTURE_GREY, MISSING_TEXTURE_GREY, alpha])
    } else {
      const c = m.color ?? new THREE.Color(1, 1, 1)
      out.setBaseColorFactor([c.r, c.g, c.b, alpha])
    }
    if (alpha < 1) out.setAlphaMode('BLEND')
    materials.set(src.uuid, out)
    return out
  }

  function primitive(geo: THREE.BufferGeometry, start: number, count: number, mat: THREE.Material): Primitive {
    const prim = doc.createPrimitive().setMaterial(material(mat))
    const position = geo.getAttribute('position')
    const normal = geo.getAttribute('normal')
    const uv = geo.getAttribute('uv')
    const index = geo.index

    if (index) {
      const slice = new Uint32Array(count)
      for (let i = 0; i < count; i++) slice[i] = index.getX(start + i)
      prim.setIndices(accessor('SCALAR', slice))
      prim.setAttribute('POSITION', accessor('VEC3', floats(position)))
      if (normal) prim.setAttribute('NORMAL', accessor('VEC3', floats(normal)))
      if (uv) prim.setAttribute('TEXCOORD_0', accessor('VEC2', flipV(floats(uv))))
    } else {
      prim.setAttribute('POSITION', accessor('VEC3', floats(position).slice(start * 3, (start + count) * 3)))
      if (normal) prim.setAttribute('NORMAL', accessor('VEC3', floats(normal).slice(start * 3, (start + count) * 3)))
      if (uv) prim.setAttribute('TEXCOORD_0', accessor('VEC2', flipV(floats(uv).slice(start * 2, (start + count) * 2))))
    }
    return prim
  }

  collada.scene.traverse(obj => {
    const camera = obj as THREE.PerspectiveCamera
    if (camera.isCamera) {
      // SketchUp writes the horizontal field of view into the DAE's yfov field.
      const position = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
      const forward = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld)
      const target = position.clone().addScaledVector(forward, 3)
      cameras.push({
        name: cleanCameraName(camera.name),
        position: position.toArray() as SceneCamera['position'],
        target: target.toArray() as SceneCamera['target'],
        hfov: camera.fov,
      })
      return
    }
    const src = obj as THREE.Mesh
    if ((obj as THREE.Line).isLine || (obj as THREE.Points).isPoints) {
      skippedLines++
      return
    }
    if (!src.isMesh || !src.geometry.getAttribute('position')) return

    const geo = src.geometry
    const mats = Array.isArray(src.material) ? src.material : [src.material]
    const key = `${geo.uuid}|${mats.map(m => m.uuid).join(',')}`
    let mesh = meshes.get(key)
    if (!mesh) {
      mesh = doc.createMesh(src.name)
      const total = geo.index ? geo.index.count : geo.getAttribute('position').count
      if (Array.isArray(src.material) && geo.groups.length) {
        for (const g of geo.groups) {
          const mat = src.material[g.materialIndex ?? 0]
          const count = Math.min(g.count, total - g.start)
          if (mat && count > 0) mesh.addPrimitive(primitive(geo, g.start, count, mat))
        }
      } else {
        mesh.addPrimitive(primitive(geo, 0, total, mats[0]))
      }
      meshes.set(key, mesh)
    }
    const node = doc.createNode(src.name).setMesh(mesh)
    node.setMatrix(src.matrixWorld.elements as unknown as Parameters<typeof node.setMatrix>[0])
    scene.addChild(node)
  })

  const embeddedTextures = glbTextures.size - missingTextures.length
  log(
    `dae: ${meshes.size} unique meshes, ${scene.listChildren().length} objects, ${skippedLines} lines skipped, ` +
      `${embeddedTextures}/${glbTextures.size} textures embedded`,
  )
  await new NodeIO().write(output, doc)
  return { embeddedTextures, missingTextures, cameras }
}
