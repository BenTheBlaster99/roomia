import * as THREE from 'three'

let cached: { objectUrl: string; source: THREE.Group } | null = null

function disposeObject(root: THREE.Object3D) {
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const mat of materials) {
      mat.dispose()
    }
  })
}

export function setImportedSource(objectUrl: string, source: THREE.Group) {
  if (cached && cached.objectUrl !== objectUrl) {
    disposeObject(cached.source)
    URL.revokeObjectURL(cached.objectUrl)
  }
  cached = { objectUrl, source }
}

export function getImportedSource(objectUrl: string): THREE.Group | null {
  if (cached?.objectUrl === objectUrl) return cached.source
  return null
}

export function clearImportedSource() {
  if (!cached) return
  disposeObject(cached.source)
  URL.revokeObjectURL(cached.objectUrl)
  cached = null
}
