// Pantalla gigante en la pared del fondo de la sala 3D: precio vivo de cada mercado, la «radio» con lo último que
// hicieron los agentes y las cifras del día. Solo pinta lo que recibe (datos reales); sin datos, lo dice.
import { useEffect, useMemo, useRef } from 'react';
import { ALTO_MURO as H, ANCHO_MURO as W, pintarMuro, type DatosMuro } from './muro';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

/** La pantalla en la pared del fondo (detrás de la capa 3), un poco inclinada hacia la cámara. */
export default function MuroSala({ datos, posicion }: { datos: DatosMuro; posicion: [number, number, number] }) {
  const ref = useRef(datos);
  ref.current = datos;
  const { lienzo, textura } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { lienzo: c, textura: tex };
  }, []);
  useEffect(() => () => textura.dispose(), [textura]);
  const ultimo = useRef(-1);
  useFrame(({ clock }) => {
    // Dos cuadros por segundo bastan (el reloj y el punto EN VIVO).
    if (clock.elapsedTime - ultimo.current < 0.5) return;
    ultimo.current = clock.elapsedTime;
    const g = lienzo.getContext('2d');
    if (!g) return;
    pintarMuro(g, ref.current, Date.now());
    textura.needsUpdate = true;
  });
  const [w, h] = [12.5, 3.9];
  return (
    <group position={posicion} rotation={[0.08, 0, 0]}>
      <RoundedBox args={[w + 0.24, h + 0.24, 0.12]} radius={0.04} position={[0, 0, -0.07]}>
        <meshStandardMaterial color="#111215" metalness={0.7} roughness={0.35} />
      </RoundedBox>
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={textura} toneMapped={false} />
      </mesh>
      {/* Tira de luz bajo la pantalla y el reflejo en el suelo de la sala. */}
      <mesh position={[0, -h / 2 - 0.16, 0]}>
        <boxGeometry args={[w * 0.92, 0.012, 0.01]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0, 1.6]} intensity={3} distance={7} color="#cfd8ff" />
    </group>
  );
}
