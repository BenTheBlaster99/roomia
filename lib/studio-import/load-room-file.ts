import * as THREE from 'three'
import type { LoadableRoomFormat } from './formats'

const GREY_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWPYt28fAAR4Ajt+FXWXAAAAAElFTkSuQmCC'

function toGroup(object: THREE.Object3D): THREE.Group {
  if (object instanceof THREE.Group) return object
  const group = new THREE.Group()
  group.add(object)
  return group
}

export async function loadRoomObject(
  url: string,
  format: LoadableRoomFormat,
): Promise<THREE.Group> {
  switch (format) {
    case 'dae': {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js')
      // A lone .dae can't carry its texture images; without them three draws those surfaces
      // black. Point every image at a light grey pixel instead.
      const manager = new THREE.LoadingManager()
      manager.setURLModifier(u => (/\.(jpe?g|png|gif|bmp|webp|tga|tiff?)$/i.test(u) ? GREY_PIXEL : u))
      const result = await new ColladaLoader(manager).loadAsync(url)
      if (!result) throw new Error('COLLADA illisible')
      return toGroup(result.scene)
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js')
      return toGroup(await new FBXLoader().loadAsync(url))
    }
    case 'obj': {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
      return toGroup(await new OBJLoader().loadAsync(url))
    }
    case 'glb':
    case 'gltf': {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
      const result = await new GLTFLoader().loadAsync(url)
      return toGroup(result.scene)
    }
    case 'stl': {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
      const geometry = await new STLLoader().loadAsync(url)
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: '#c8c2ba', roughness: 0.85, metalness: 0.05 }),
      )
      return toGroup(mesh)
    }
    default: {
      const _never: never = format
      throw new Error(`Unsupported format: ${_never}`)
    }
  }
}

/** Parses a GLB already in memory (the light copy from the server), no blob URL involved. */
export async function loadRoomObjectFromGlbBuffer(buffer: ArrayBuffer): Promise<THREE.Group> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
  const result = await new GLTFLoader().parseAsync(buffer, '')
  return toGroup(result.scene)
}
