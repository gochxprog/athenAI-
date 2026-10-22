// El agente de cada puesto: un robot sentado frente a su escritorio (mira hacia −z, al teclado y al monitor).
// Nivel 2 (trabajando): visor y LED a tope, teclea y mira alrededor. Nivel 1 (listo): encendido y tranquilo, las
// manos quietas sobre el teclado. Nivel 0 (apagado): gris, sin luz y con la cabeza baja.
import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Accesorio } from '@/data/agentes';
import type { Nivel } from '@/motores/agentes/sala';

type V3 = [number, number, number];
const CUERPO: Record<Nivel, string> = { 0: '#34363b', 1: '#aeb3bc', 2: '#d9dde4' };
const JUNTA = '#1b1d21';
const SILLA = '#16171a';

/** Una pieza alargada (brazo, pierna) entre dos puntos. */
function Hueso({ de, a, r, children }: { de: V3; a: V3; r: number; children: ReactNode }) {
  const { pos, giro, largo } = useMemo(() => {
    const [p, q] = [new THREE.Vector3(...de), new THREE.Vector3(...a)];
    const d = q.clone().sub(p);
    return { pos: p.add(q).multiplyScalar(0.5), giro: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), largo: d.length() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de.join(), a.join()]);
  return (
    <mesh position={pos} quaternion={giro} castShadow>
      <capsuleGeometry args={[r, Math.max(0.001, largo - r), 6, 12]} />
      {children}
    </mesh>
  );
}

function Silla() {
  const mat = <meshStandardMaterial color={SILLA} metalness={0.5} roughness={0.5} />;
  return (
    <group>
      <mesh position={[0, 0.45, 0.02]}><boxGeometry args={[0.46, 0.06, 0.44]} />{mat}</mesh>
      <mesh position={[0, 0.8, 0.25]} rotation={[0.12, 0, 0]}><boxGeometry args={[0.44, 0.52, 0.05]} />{mat}</mesh>
      <mesh position={[0, 0.22, 0.02]}><cylinderGeometry args={[0.03, 0.03, 0.42, 10]} />{mat}</mesh>
      {[0, Math.PI / 2].map((r) => <mesh key={r} position={[0, 0.03, 0.02]} rotation={[0, r + Math.PI / 4, 0]}><boxGeometry args={[0.5, 0.03, 0.05]} />{mat}</mesh>)}
    </group>
  );
}

export function Robot({ color, accesorio, nivel, seleccionado }: { color: string; accesorio: Accesorio; nivel: Nivel; seleccionado: boolean }) {
  const cabeza = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const manos = useRef<(THREE.Group | null)[]>([]);
  const fase = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + fase;
    if (cabeza.current) {
      cabeza.current.rotation.y = nivel === 2 ? Math.sin(t * 0.6) * 0.3 : nivel ? Math.sin(t * 0.25) * 0.08 : 0;
      cabeza.current.rotation.x = nivel ? -0.12 + Math.sin(t * 1.1) * (nivel === 2 ? 0.06 : 0.02) : 0.38;
    }
    if (torso.current) torso.current.position.y = nivel ? Math.sin(t * 1.6) * 0.008 : -0.02;
    // Teclea solo si trabaja.
    manos.current.forEach((m, i) => m && (m.position.y = nivel === 2 ? Math.max(0, Math.sin(t * 13 + i * 2.1)) * 0.022 : 0));
  });
  const cuerpo = <meshStandardMaterial color={CUERPO[nivel]} metalness={0.6} roughness={0.28} />;
  const junta = <meshStandardMaterial color={JUNTA} metalness={0.4} roughness={0.6} />;
  const luz = nivel === 2 ? 1 : nivel ? 0.55 : 0.07;
  return (
    <group>
      <Silla />
      {/* Piernas (sentado) */}
      {[-0.1, 0.1].map((x) => (
        <group key={x}>
          <Hueso de={[x, 0.53, 0]} a={[x, 0.52, -0.32]} r={0.055}>{junta}</Hueso>
          <Hueso de={[x, 0.52, -0.32]} a={[x, 0.06, -0.34]} r={0.045}>{junta}</Hueso>
        </group>
      ))}
      <group ref={torso}>
        <mesh position={[0, 0.86, 0]} castShadow><capsuleGeometry args={[0.17, 0.26, 8, 20]} />{cuerpo}</mesh>
        {/* LED del pecho y de la espalda, del color del agente. */}
        <mesh position={[0, 0.92, -0.171]}><boxGeometry args={[0.12, 0.022, 0.01]} /><meshBasicMaterial color={color} transparent opacity={luz} toneMapped={false} /></mesh>
        <mesh position={[0, 0.88, 0.171]}><boxGeometry args={[0.035, 0.3, 0.01]} /><meshBasicMaterial color={color} transparent opacity={luz} toneMapped={false} /></mesh>
        {/* Brazos hasta el teclado */}
        {[-1, 1].map((l, i) => (
          <group key={l}>
            <mesh position={[l * 0.21, 1.02, 0]}><sphereGeometry args={[0.068, 16, 12]} />{cuerpo}</mesh>
            <Hueso de={[l * 0.22, 1.0, 0]} a={[l * 0.25, 0.83, -0.16]} r={0.042}>{cuerpo}</Hueso>
            <group ref={(el) => (manos.current[i] = el)}>
              <Hueso de={[l * 0.25, 0.83, -0.16]} a={[l * 0.12, 0.79, -0.42]} r={0.036}>{junta}</Hueso>
              <mesh position={[l * 0.12, 0.785, -0.44]}><sphereGeometry args={[0.04, 12, 10]} />{junta}</mesh>
            </group>
          </group>
        ))}
        <mesh position={[0, 1.15, 0]}><cylinderGeometry args={[0.045, 0.055, 0.08, 12]} />{junta}</mesh>
        <group ref={cabeza} position={[0, 1.32, 0]}>
          <mesh castShadow><sphereGeometry args={[0.15, 32, 24]} />{cuerpo}</mesh>
          {/* Visor envolvente: la luz que dice si el agente está encendido. */}
          <mesh position={[0, 0.01, 0]} rotation={[Math.PI / 2, 0, -Math.PI / 2 - 0.95]}>
            <torusGeometry args={[0.148, 0.026, 8, 32, 1.9]} />
            <meshStandardMaterial color={nivel ? color : '#26282c'} emissive={color} emissiveIntensity={nivel === 2 ? (seleccionado ? 3.2 : 2.4) : nivel ? 1.1 : 0} toneMapped={false} />
          </mesh>
          <AccesorioCabeza tipo={accesorio} vivo={nivel > 0} />
        </group>
      </group>
    </group>
  );
}

/** Gris grafito mate de los accesorios (sin color: el color de cada agente es solo la luz de su puesto). */
const MATE = '#2a2c31';
const MATE_CLARO = '#8e929a';

/** El accesorio va dentro del grupo de la cabeza (se mueve con ella). La cara (visor) mira hacia −z. */
function AccesorioCabeza({ tipo, vivo }: { tipo: Accesorio; vivo: boolean }) {
  const mat = <meshStandardMaterial color={MATE} metalness={0.1} roughness={0.9} transparent opacity={vivo ? 1 : 0.55} />;
  switch (tipo) {
    case 'antena':
      return (
        <group>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.14, 8]} />
            <meshStandardMaterial color="#8e929a" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.29, 0]}>
            <sphereGeometry args={[0.028, 16, 16]} />
            <meshStandardMaterial color={MATE_CLARO} emissive="#ffffff" emissiveIntensity={vivo ? 0.35 : 0} roughness={0.6} />
          </mesh>
        </group>
      );
    case 'auriculares':
      return (
        <group>
          <mesh>
            <torusGeometry args={[0.165, 0.014, 8, 24, Math.PI]} />
            {mat}
          </mesh>
          {[-0.165, 0.165].map((x) => (
            <mesh key={x} position={[x, -0.01, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.04, 20]} />
              {mat}
            </mesh>
          ))}
        </group>
      );
    case 'sombrero':
      return (
        <group position={[0, 0.1, 0]}>
          <mesh>
            <cylinderGeometry args={[0.27, 0.27, 0.014, 32]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.065, 0]}>
            <cylinderGeometry args={[0.12, 0.14, 0.12, 24]} />
            {mat}
          </mesh>
        </group>
      );
    case 'gorra':
      return (
        <group>
          <mesh position={[0, 0.03, 0]}>
            <sphereGeometry args={[0.158, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            {mat}
          </mesh>
          {/* Al revés: la visera hacia la nuca (+z). */}
          <mesh position={[0, 0.05, 0.17]}>
            <boxGeometry args={[0.2, 0.012, 0.12]} />
            {mat}
          </mesh>
        </group>
      );
    case 'birrete':
      return (
        <group position={[0, 0.13, 0]}>
          <mesh>
            <cylinderGeometry args={[0.13, 0.14, 0.07, 24]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.045, 0]} rotation={[0, Math.PI / 4, 0]}>
            <boxGeometry args={[0.3, 0.015, 0.3]} />
            {mat}
          </mesh>
          <mesh position={[0.13, -0.02, -0.13]}>
            <sphereGeometry args={[0.018, 10, 10]} />
            <meshStandardMaterial color={MATE_CLARO} roughness={0.9} />
          </mesh>
        </group>
      );
    case 'cinta':
      return (
        <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.148, 0.022, 10, 32]} />
          {mat}
        </mesh>
      );
    case 'gorro':
      return (
        <group>
          <mesh position={[0, 0.03, 0]}>
            <sphereGeometry args={[0.16, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshStandardMaterial color={MATE_CLARO} roughness={0.95} />
          </mesh>
        </group>
      );
    case 'boina':
      return (
        <mesh position={[0.02, 0.12, 0]} rotation={[0, 0, -0.25]} scale={[1, 0.35, 1]}>
          <sphereGeometry args={[0.17, 24, 16]} />
          {mat}
        </mesh>
      );
    case 'casco':
      return (
        <group>
          <mesh position={[0, 0.02, 0]}>
            <sphereGeometry args={[0.172, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[0.03, 0.04, 0.3]} />
            {mat}
          </mesh>
        </group>
      );
    case 'visera':
      return (
        <group>
          <mesh position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.15, 0.016, 10, 32]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.07, -0.19]} rotation={[0.25, 0, 0]}>
            <boxGeometry args={[0.2, 0.01, 0.1]} />
            {mat}
          </mesh>
        </group>
      );
  }
}

