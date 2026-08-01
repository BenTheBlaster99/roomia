import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useStudioStore } from '@/store/useStudioStore'
import { FLOOR_MATERIALS } from '@/lib/studio-constants'

export default function Room() {
  const { width, length, height, floorMaterial, wallColor } = useStudioStore(s => s.room)
  const captureMode = useStudioStore(s => s.captureMode)
  const floorColor = FLOOR_MATERIALS[floorMaterial]?.color ?? '#A0785A'
  const cx = width / 2, cz = length / 2

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color={floorColor} roughness={0.8} />
      </mesh>

      {/* Back wall (z = 0) */}
      <mesh position={[cx, height / 2, 0]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} side={THREE.FrontSide} />
      </mesh>

      {/* Left wall (x = 0) */}
      <mesh position={[0, height / 2, cz]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} side={THREE.FrontSide} />
      </mesh>

      {/* Right wall (x = width) */}
      <mesh position={[width, height / 2, cz]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial color={wallColor} roughness={0.9} side={THREE.FrontSide} />
      </mesh>

      {/* Ceiling */}
      <mesh position={[cx, height, cz]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#FAFAFA" roughness={1} side={THREE.FrontSide} />
      </mesh>

      {/* Baseboard */}
      <mesh position={[cx, 0.04, 0.01]}>
        <boxGeometry args={[width, 0.08, 0.02]} />
        <meshStandardMaterial color="#D4CFC8" />
      </mesh>
      <mesh position={[0.01, 0.04, cz]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[length, 0.08, 0.02]} />
        <meshStandardMaterial color="#D4CFC8" />
      </mesh>
      <mesh position={[width - 0.01, 0.04, cz]} rotation={[0, -Math.PI / 2, 0]}>
        <boxGeometry args={[length, 0.08, 0.02]} />
        <meshStandardMaterial color="#D4CFC8" />
      </mesh>

      {/* Measurement labels — hidden during photoreal capture */}
      {!captureMode && (
        <>
          <Html position={[cx, -0.3, length + 0.1]} center>
            <div className="text-xs font-bold text-amber-400 bg-zinc-900/80 px-2 py-0.5 rounded whitespace-nowrap">
              {width.toFixed(1)} m
            </div>
          </Html>
          <Html position={[-0.4, height / 2, cz]} center>
            <div className="text-xs font-bold text-amber-400 bg-zinc-900/80 px-2 py-0.5 rounded whitespace-nowrap">
              {length.toFixed(1)} m
            </div>
          </Html>
          <Html position={[width + 0.3, height / 2, 0]} center>
            <div className="text-xs font-bold text-amber-400 bg-zinc-900/80 px-2 py-0.5 rounded whitespace-nowrap">
              {height.toFixed(1)} m ↕
            </div>
          </Html>
        </>
      )}
    </group>
  )
}
