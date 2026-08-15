import * as THREE from 'three'

export interface ModelDims {
  width: number
  depth: number
  height: number
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

/** Fix PBR/vertex-color materials so AI models aren't dark or untextured in Three.js. */
export function configureGlbMaterials(root: THREE.Object3D) {
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    const applyPbr = (mat: THREE.Material) => {
      const standard = mat as THREE.MeshStandardMaterial
      // InstantMesh iso-surfaces are single-sided Swiss cheese; DoubleSide
      // hides the floor showing through backfaces on fabric.
      standard.side = THREE.DoubleSide
      standard.shadowSide = THREE.DoubleSide
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

    if (mesh.geometry.attributes.COLOR_0) {
      const existing = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const keepMap = (existing as THREE.MeshStandardMaterial | undefined)?.map
      mesh.material = new THREE.MeshStandardMaterial({
        vertexColors: !keepMap,
        map: keepMap ?? null,
        roughness: 0.72,
        metalness: 0.04,
        side: THREE.DoubleSide,
        shadowSide: THREE.DoubleSide,
      })
      applyPbr(mesh.material)
      return
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of materials) {
      if (mat) applyPbr(mat)
    }
  })
}

/**
 * Normalize a loaded GLTF scene for the Roomia studio:
 * footprint centered on X/Z, bottom on Y=0, scaled to category dimensions.
 *
 * Orientation is baked into generated GLBs by furniture-3d-gen. Runtime
 * rotation guessing caused double-rotation on ambiguous generated furniture.
 */
export function normalizeGlbScene(
  scene: THREE.Object3D,
  dims: ModelDims,
): THREE.Object3D {
  const root = scene.clone(true)
  configureGlbMaterials(root)

  const { size } = measureBox(root)
  const scale = Math.min(
    size.x > 0 ? dims.width / size.x : 1,
    size.y > 0 ? dims.height / size.y : 1,
    size.z > 0 ? dims.depth / size.z : 1,
  )
  root.scale.setScalar(scale)

  const { box, center } = measureBox(root)
  root.position.set(-center.x, -box.min.y, -center.z)
  root.updateMatrixWorld(true)
  return root
}
