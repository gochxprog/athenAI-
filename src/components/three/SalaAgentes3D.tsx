import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Grid, Html, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { AGENTES, type AgenteId } from '@/data/mock';

const PUESTOS: Record<AgenteId, { pos: [number, number, number]; rot: number }> = {
  rastreador: { pos: [-2.6, 0, -0.6], rot: 0.55 },
  lector: { pos: [-0.95, 0, -2.1], rot: 0.18 },
  sintetizador: { pos: [0.95, 0, -2.1], rot: -0.18 },
  flujo: { pos: [2.6, 0, -0.6], rot: -0.55 },
};

const GRIS_OSCURO = '#1a1b1e';
const GRIS = '#2c2e33';
const GRIS_CLARO = '#8e929a';

interface Props {
  seleccion: AgenteId | null;
  onSeleccion: (id: AgenteId) => void;
}

/** Núcleo de datos de mercado: icosaedro que respira en el centro de la sala. */
function NucleoDatos() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.rotation.y = t * 0.35;
    ref.current.rotation.x = Math.sin(t * 0.3) * 0.3;
    ref.current.position.y = 1.15 + Math.sin(t * 1.2) * 0.06;
  });
  return (
    <group>
      <group ref={ref}>
        <mesh>
          <icosahedronGeometry args={[0.36, 1]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.55} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.16, 0]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.4} />
        </mesh>
      </group>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.52, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.35} />
      </mesh>
      <pointLight position={[0, 1.2, 0]} intensity={6} distance={6} color="#ffffff" />
      <Html position={[0, 0.3, 0.75]} center style={{ pointerEvents: 'none' }}>
        <p className="whitespace-nowrap text-[9px] uppercase tracking-[0.2em] text-plata-400">Datos de mercado · BTCUSDT</p>
      </Html>
    </group>
  );
}

/** Paquetes de datos que viajan del núcleo a cada puesto en arco. */
function FlujoPaquetes() {
  const curvas = useMemo(
    () =>
      Object.values(PUESTOS).map(({ pos }) => {
        const fin = new THREE.Vector3(pos[0] * 0.82, 1.05, pos[2] * 0.82);
        return new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 1.15, 0), new THREE.Vector3(pos[0] * 0.45, 1.9, pos[2] * 0.45), fin);
      }),
    [],
  );
  const trazos = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12 });
    return curvas.map((c) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.getPoints(40)), mat));
  }, [curvas]);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const paquetes = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ curva: i % 4, fase: (i / 16) * 4 + Math.random() * 0.2, vel: 0.35 + Math.random() * 0.2 })), []);
  useFrame(({ clock }) => {
    paquetes.forEach((p, i) => {
      const m = refs.current[i];
      if (!m) return;
      const t = (clock.elapsedTime * p.vel + p.fase) % 1;
      curvas[p.curva].getPoint(t, m.position);
      (m.material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI);
    });
  });
  return (
    <group>
      {trazos.map((t, i) => (
        <primitive key={i} object={t} />
      ))}
      {paquetes.map((_, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)}>
          <boxGeometry args={[0.04, 0.04, 0.04]} />
          <meshBasicMaterial color="#ffffff" transparent />
        </mesh>
      ))}
    </group>
  );
}

function Monitor({ activo }: { activo: boolean }) {
  const lineas = useRef<(THREE.Mesh | null)[]>([]);
  const fases = useMemo(() => Array.from({ length: 6 }, () => Math.random() * 10), []);
  useFrame(({ clock }) => {
    lineas.current.forEach((l, i) => {
      if (!l) return;
      const t = clock.elapsedTime * (activo ? 1.6 : 0.6) + fases[i];
      l.scale.x = 0.25 + Math.abs(Math.sin(t)) * 0.75;
      l.position.x = -0.28 + (l.scale.x * 0.56) / 2;
    });
  });
  return (
    <group position={[0, 0.98, -0.28]} rotation={[-0.12, 0, 0]}>
      <RoundedBox args={[0.78, 0.48, 0.03]} radius={0.015}>
        <meshStandardMaterial color={GRIS_OSCURO} metalness={0.6} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0, 0.017]}>
        <planeGeometry args={[0.72, 0.42]} />
        <meshBasicMaterial color="#0b0c0e" />
      </mesh>
      {fases.map((_, i) => (
        <mesh key={i} ref={(el) => (lineas.current[i] = el)} position={[0, 0.15 - i * 0.06, 0.02]}>
          <planeGeometry args={[0.56, 0.012]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35 + (i % 3) * 0.2} />
        </mesh>
      ))}
      <mesh position={[0, -0.32, 0.05]}>
        <boxGeometry args={[0.05, 0.18, 0.05]} />
        <meshStandardMaterial color={GRIS} metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Puesto({ id, seleccionado, onSeleccion }: { id: AgenteId; seleccionado: boolean; onSeleccion: (id: AgenteId) => void }) {
  const { pos, rot } = PUESTOS[id];
  const agente = AGENTES.find((a) => a.id === id)!;
  const cabeza = useRef<THREE.Group>(null);
  const cuerpo = useRef<THREE.Group>(null);
  const anillo = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const fase = useMemo(() => Math.random() * 10, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + fase;
    if (cabeza.current) {
      cabeza.current.rotation.y = Math.sin(t * 0.7) * 0.25;
      cabeza.current.rotation.x = -0.15 + Math.sin(t * 1.3) * 0.06;
    }
    if (cuerpo.current) cuerpo.current.position.y = Math.sin(t * 1.8) * 0.012;
    if (anillo.current) {
      anillo.current.rotation.z = t * 0.5;
      const m = anillo.current.material as THREE.MeshBasicMaterial;
      m.opacity = seleccionado ? 0.9 : hover ? 0.5 : 0.18;
    }
  });

  return (
    <group
      position={pos}
      rotation={[0, rot, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSeleccion(id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = '';
      }}
    >
      {/* Anillo de selección */}
      <mesh ref={anillo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0.15]}>
        <ringGeometry args={[0.78, 0.8, 64, 1, 0, Math.PI * 1.7]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.2} />
      </mesh>

      {/* Escritorio */}
      <RoundedBox args={[1.3, 0.05, 0.7]} radius={0.01} position={[0, 0.72, -0.2]} castShadow>
        <meshStandardMaterial color={GRIS} metalness={0.4} roughness={0.55} />
      </RoundedBox>
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.36, -0.2]} castShadow>
          <boxGeometry args={[0.03, 0.72, 0.62]} />
          <meshStandardMaterial color={GRIS_OSCURO} metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <Monitor activo={seleccionado || hover} />
      <mesh position={[0, 0.755, 0.0]}>
        <boxGeometry args={[0.42, 0.015, 0.14]} />
        <meshStandardMaterial color={GRIS_OSCURO} />
      </mesh>

      {/* Agente */}
      <group ref={cuerpo} position={[0, 0, 0.5]}>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.16, 0.2, 0.08, 24]} />
          <meshStandardMaterial color={GRIS_OSCURO} metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.78, 0]} castShadow>
          <capsuleGeometry args={[0.17, 0.36, 8, 20]} />
          <meshStandardMaterial color={GRIS_CLARO} metalness={0.75} roughness={0.28} />
        </mesh>
        <group ref={cabeza} position={[0, 1.22, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.15, 32, 32]} />
            <meshStandardMaterial color="#c5c8ce" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Visor */}
          <mesh position={[0, 0.01, -0.12]} rotation={[0, Math.PI, 0]}>
            <boxGeometry args={[0.2, 0.035, 0.06]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={seleccionado ? 2.2 : 1.2} />
          </mesh>
        </group>
      </group>

      <Html position={[0, 1.78, 0.5]} center style={{ pointerEvents: 'none' }}>
        <div className={`whitespace-nowrap rounded-md border px-2 py-1 text-center backdrop-blur transition-colors ${seleccionado ? 'border-white bg-white text-black' : 'border-borde bg-black/70 text-white'}`}>
          <p className="text-[11px] font-medium leading-none">{agente.nombre}</p>
          <p className={`mt-0.5 text-[9px] uppercase tracking-[0.14em] ${seleccionado ? 'text-black/60' : 'text-plata-400'}`}>{agente.estado}</p>
        </div>
      </Html>
    </group>
  );
}

function Sala() {
  // Aristas de la sala para dar profundidad sin paredes sólidas.
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(10, 4, 8)), []);
  return (
    <lineSegments geometry={geo} position={[0, 2, -1]}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.08} />
    </lineSegments>
  );
}

export default function SalaAgentes3D({ seleccion, onSeleccion }: Props) {
  return (
    <Canvas shadows camera={{ position: [0, 3.4, 5.6], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}>
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 3, -2]} intensity={0.35} />
      <Sala />
      <Grid position={[0, 0, 0]} args={[20, 20]} cellSize={0.5} cellThickness={0.5} cellColor="#2a2a2e" sectionSize={2} sectionThickness={0.8} sectionColor="#45484e" fadeDistance={14} fadeStrength={1.5} infiniteGrid />
      <ContactShadows position={[0, 0.005, 0]} opacity={0.6} scale={12} blur={2.4} far={3} />
      <NucleoDatos />
      <FlujoPaquetes />
      {AGENTES.map((a) => (
        <Puesto key={a.id} id={a.id} seleccionado={seleccion === a.id} onSeleccion={onSeleccion} />
      ))}
      <OrbitControls target={[0, 0.9, -0.8]} enablePan={false} minDistance={4} maxDistance={10} minPolarAngle={0.5} maxPolarAngle={1.35} enableDamping autoRotate={seleccion === null} autoRotateSpeed={0.25} />
    </Canvas>
  );
}
