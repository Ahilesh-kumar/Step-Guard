import React, { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Box, Sphere } from '@react-three/drei'

// Domain 4.31: 3D WebGL Kinematic Visualizer
// This uses hardware-accelerated GPU graphics directly in the browser.
// When the TENG voltage spikes, we visually represent the impact on the 3D model.

function FootVisualizer({ currentVoltage }) {
  const meshRef = useRef()

  // useFrame hooks into the browser's 60fps render loop
  useFrame(() => {
    if (meshRef.current) {
        // Slowly rotate naturally
        meshRef.current.rotation.y += 0.01

        // Map the TENG voltage (0 - 4000) to physical 3D "compression" mapping
        // If voltage is high (stepping), compress the shoe downwards
        const scaleFactor = Math.max(0.5, 1.0 - (currentVoltage / 5000))
        
        // Lerp for smooth animation interpolations
        meshRef.current.scale.y += (scaleFactor - meshRef.current.scale.y) * 0.1
    }
  })

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      {/* Abstract representation of a foot/shoe. 
          In production, replace with <primitive object={useGLTF('/shoe.gltf')} /> */}
      <boxGeometry args={[1.5, 0.5, 3]} />
      <meshStandardMaterial color={currentVoltage > 1500 ? "#ff4081" : "#00d084"} wireframe={false} />
    </mesh>
  )
}

export default function KinematicEngine({ liveVoltage }) {
  return (
    <div style={{ height: '300px', width: '100%', background: '#1e1e1e', borderRadius: '12px', border: '1px solid #333' }}>
      <Canvas camera={{ position: [4, 4, 4], fov: 40 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <FootVisualizer currentVoltage={liveVoltage} />
        <OrbitControls enableZoom={false} autoRotate={false} />
      </Canvas>
    </div>
  )
}
