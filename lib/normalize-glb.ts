import * as THREE from 'three'

export interface ModelDims {
  width: number
  depth: number
  height: number
}

export interface NormalizeGlbOptions {
  /** Skip uniform rescale when the model is already exported in metres. */
  preserveScale?: boolean
  /** Extra correction for generated assets exported Z-up instead of Three.js Y-up. */
  zUpToYUp?: boolean
}

function updateWorldMatrices(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
}

function measureBox(root: THREE.Object3D) {
  updateWorldMatrices(root)
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  const center = new THREE.Vector3()
  box.getCenter(center)
  return { box, size, center }
}

function autoCorrectOrientation(scene: THREE.Object3D) {
  const container = new THREE.Group()
  container.add(scene)
  // Orientation is baked at generation time (orient_for_room_view in generate.py).
  // Re-guessing from bounding-box ratios here double-rotates ambiguous shapes like chairs.
  return container
}

/** Fix PBR/vertex-color materials so AI models aren't dark or untextured in Three.js. */
export function configureGlbMaterials(root: THREE.Object3D) {
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    if (mesh.geometry.attributes.COLOR_0) {
      mesh.material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.72,
        metalness: 0.04,
      })
      return
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of materials) {
      if (!mat) continue
      const standard = mat as THREE.MeshStandardMaterial
      if (standard.map) {
        standard.map.colorSpace = THREE.SRGBColorSpace
        standard.map.needsUpdate = true
      }
      if (typeof standard.metalness === 'number') {
        standard.metalness = Math.min(standard.metalness, 0.12)
      } else {
        standard.metalness = 0.04
      }
      if (typeof standard.roughness === 'number') {
        standard.roughness = Math.max(standard.roughness, 0.55)
      } else {
        standard.roughness = 0.72
      }
      standard.needsUpdate = true
    }
  })
}

/**
 * Normalize a loaded GLTF scene for the Roomia studio:
 * Y-up, footprint centered on X/Z, bottom on Y=0, scaled to category dimensions.
 */
export function normalizeGlbScene(
  scene: THREE.Object3D,
  dims: ModelDims,
  options: NormalizeGlbOptions = {},
): THREE.Object3D {
  const root = autoCorrectOrientation(scene.clone(true))
  if (options.zUpToYUp) {
    root.rotation.x -= Math.PI / 2
    root.updateMatrixWorld(true)
  }
  configureGlbMaterials(root)

  if (!options.preserveScale) {
    const { size } = measureBox(root)
    const scale = Math.min(
      size.x > 0 ? dims.width / size.x : 1,
      size.y > 0 ? dims.height / size.y : 1,
      size.z > 0 ? dims.depth / size.z : 1,
    )
    root.scale.setScalar(scale)
  }

  const { box, center } = measureBox(root)
  root.position.set(-center.x, -box.min.y, -center.z)
  root.updateMatrixWorld(true)
  return root
}
