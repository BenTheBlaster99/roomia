import * as THREE from 'three'

/**
 * Glass for the walk (18 Nov). SketchUp gives glass as a plain grey at 35-60 % opacity ("[Translucent Glass Gray]",
 * "Basic_Glass"): Blender renders it as real glass, but drawn as it is in real time a glass door in front of the eye is a
 * grey veil over the whole view. Untextured see-through materials become clear glass: faint, reflecting the room, and
 * never hiding what is behind them. Textured ones (a curtain, a printed film) are left as they are.
 */
export function clearGlass(root: THREE.Object3D) {
  const done = new Set<THREE.Material>()
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material || done.has(material)) continue
      done.add(material)
      const m = material as THREE.MeshStandardMaterial
      if (!m.transparent || m.map || m.opacity >= 0.95) continue
      m.opacity = Math.min(m.opacity, 0.12)
      m.depthWrite = false
      if ('roughness' in m) m.roughness = 0.05
      if ('metalness' in m) m.metalness = 0
      if ('envMapIntensity' in m) m.envMapIntensity = 1.5
      m.needsUpdate = true
    }
  })
}
