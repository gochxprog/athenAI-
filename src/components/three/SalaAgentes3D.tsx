import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Grid, Html, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { AGENTES, CAPAS, ESTILO_AGENTE, type Accesorio, type AgenteId } from '@/data/agentes';
import { ALTO, ANCHO, PANTALLAS } from './pantallas';
import MuroSala from './MuroSala';
import type { DatosMuro } from './muro';

/** Filas por capa (detectores delante, ejecución al fondo), mirando hacia el núcleo de datos. */
const FILAS: Record<1 | 2 | 3, { z: number; paso: number }> = {
  1: { z: 0, paso: 3.2 },
  2: { z: -2.9, paso: 2.9 },
  3: { z: -5.8, paso: 3.2 },
};
const NUCLEO: [number, number, number] = [0, 0, 2.6];

const PUESTOS = (() => {
  const out = {} as Record<AgenteId, { pos: [number, number, number]; rot: number }>;
  for (const capa of [1, 2, 3] as const) {
    const lista = AGENTES.filter((a) => a.capa === capa);
    const { z, paso } = FILAS[capa];
    lista.forEach((a, i) => {
      const x = (i - (lista.length - 1) / 2) * paso;
      // Ligeramente girado hacia el centro de la sala.
      out[a.id] = { pos: [x, 0, z], rot: -Math.atan2(x, 10) };
    });
  }
  return out;
})();

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

const GRIS_OSCURO = '#1a1b1e';
const GRIS = '#2c2e33';
const GRIS_CLARO = '#8e929a';

interface Props {
  seleccion: AgenteId | null;
  onSeleccion: (id: AgenteId) => void;
  /** Texto de estado bajo el nombre de cada agente. */
  estados: Record<AgenteId, string>;
  /** Rótulo del núcleo: fuente y activos. */
  etiquetaDatos: string;
  /** Pantalla gigante en la pared del fondo (sin datos no se pinta). */
  muro?: DatosMuro;
  /** Quién trabaja de verdad ahora (por defecto: los que tienen motor). */
  activos?: Partial<Record<AgenteId, boolean>>;
}

/** Núcleo de datos de mercado: icosaedro que respira en el centro de la sala. */
function NucleoDatos({ etiqueta }: { etiqueta: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.rotation.y = t * 0.35;
    ref.current.rotation.x = Math.sin(t * 0.3) * 0.3;
    ref.current.position.y = 1.15 + Math.sin(t * 1.2) * 0.06;
  });
  return (
    <group position={NUCLEO}>
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
        <p className="whitespace-nowrap text-[9px] uppercase tracking-[0.2em] text-plata-400">{etiqueta}</p>
      </Html>
    </group>
  );
}

/** Paquetes de datos que viajan del núcleo a cada puesto en arco. */
function FlujoPaquetes({ vivo }: { vivo: (a: (typeof AGENTES)[number]) => boolean }) {
  // Un paquete hacia cada agente que trabaja (se rehace solo cuando cambia quién trabaja).
  const ids = AGENTES.filter(vivo).map((a) => a.id).join();
  const curvas = useMemo(
    () =>
      (ids.split(',').filter(Boolean) as AgenteId[]).map((id) => {
        const { pos } = PUESTOS[id];
        const ini = new THREE.Vector3(NUCLEO[0], 1.15, NUCLEO[2]);
        const fin = new THREE.Vector3(pos[0], 1.05, pos[2] + 0.4);
        return new THREE.QuadraticBezierCurve3(ini, new THREE.Vector3((ini.x + fin.x) / 2, 2.2, (ini.z + fin.z) / 2), fin);
      }),
    [ids],
  );
  const trazos = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12 });
    return curvas.map((c) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.getPoints(40)), mat));
  }, [curvas]);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const paquetes = useMemo(() => Array.from({ length: curvas.length * 5 }, (_, i) => ({ curva: i % curvas.length, fase: (i / (curvas.length * 5)) * 4 + Math.random() * 0.2, vel: 0.35 + Math.random() * 0.2 })), [curvas.length]);
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

function Monitor({ id, color, activo, apagado }: { id: AgenteId; color: string; activo: boolean; apagado: boolean }) {
  // Cada agente muestra en su pantalla algo de su trabajo (dibujo en un canvas; solo decoración).
  const { lienzo, textura } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = ANCHO;
    c.height = ALTO;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { lienzo: c, textura: tex };
  }, []);
  useEffect(() => () => textura.dispose(), [textura]);
  const ultimo = useRef(-1);
  useFrame(({ clock }) => {
    // Sin motor: un solo cuadro quieto. Con motor: ~10 cuadros por segundo (más rápido si está seleccionado).
    const t = apagado ? 0 : clock.elapsedTime * (activo ? 1.6 : 1);
    if (apagado ? ultimo.current === 0 : clock.elapsedTime - ultimo.current < 0.1) return;
    ultimo.current = apagado ? 0 : clock.elapsedTime;
    const g = lienzo.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0b0c0e';
    g.fillRect(0, 0, ANCHO, ALTO);
    PANTALLAS[id](g, t, color);
    textura.needsUpdate = true;
  });
  return (
    <group position={[0, 0.98, -0.28]} rotation={[-0.12, 0, 0]}>
      <RoundedBox args={[0.78, 0.48, 0.03]} radius={0.015}>
        <meshStandardMaterial color={GRIS_OSCURO} metalness={0.6} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0, 0.017]}>
        <planeGeometry args={[0.72, 0.42]} />
        <meshBasicMaterial map={textura} toneMapped={false} transparent opacity={apagado ? 0.35 : 1} />
      </mesh>
      <mesh position={[0, -0.32, 0.05]}>
        <boxGeometry args={[0.05, 0.18, 0.05]} />
        <meshStandardMaterial color={GRIS} metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Puesto({ id, seleccionado, onSeleccion, estado, vivo }: { id: AgenteId; seleccionado: boolean; onSeleccion: (id: AgenteId) => void; estado: string; vivo: boolean }) {
  const { pos, rot } = PUESTOS[id];
  const agente = AGENTES.find((a) => a.id === id)!;
  const estilo = ESTILO_AGENTE[id];
  const cabeza = useRef<THREE.Group>(null);
  const cuerpo = useRef<THREE.Group>(null);
  const anillo = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const fase = useMemo(() => Math.random() * 10, []);

  // En pantallas estrechas el rótulo solo lleva el nombre (los 10 puestos no caben con dos líneas).
  const compacto = useThree((st) => st.size.width) < 700;
  useFrame(({ clock }) => {
    // Sin motor: el agente está quieto (cabeza baja, sin respirar).
    const t = vivo ? clock.elapsedTime + fase : fase;
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

      {/* Luz LED del puesto en su color: un aro fino en el suelo con un halo muy suave, y una tira bajo el
          borde del escritorio. Encendida si el agente trabaja; casi apagada si aún no tiene motor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0.15]}>
        <circleGeometry args={[0.74, 48]} />
        <meshBasicMaterial color={estilo.color} transparent opacity={vivo ? (seleccionado ? 0.08 : 0.04) : 0.012} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0.15]}>
        <ringGeometry args={[0.735, 0.75, 96]} />
        <meshBasicMaterial color={estilo.color} transparent opacity={vivo ? (seleccionado ? 0.95 : 0.6) : 0.1} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.692, 0.152]}>
        <boxGeometry args={[1.22, 0.008, 0.006]} />
        <meshBasicMaterial color={estilo.color} transparent opacity={vivo ? 0.85 : 0.1} toneMapped={false} />
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
      <Monitor id={id} color={estilo.color} activo={vivo && (seleccionado || hover)} apagado={!vivo} />
      <mesh position={[0, 0.755, 0.0]}>
        <boxGeometry args={[0.42, 0.015, 0.14]} />
        <meshStandardMaterial color={GRIS_OSCURO} />
      </mesh>

      {/* Zona de toque amplia e invisible: facilita seleccionar al agente en pantallas táctiles */}
      <mesh position={[0, 0.85, 0.3]}>
        <cylinderGeometry args={[0.55, 0.55, 1.7, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Agente */}
      <group ref={cuerpo} position={[0, 0, 0.5]}>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.16, 0.2, 0.08, 24]} />
          <meshStandardMaterial color={GRIS_OSCURO} metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.78, 0]} castShadow>
          <capsuleGeometry args={[0.17, 0.36, 8, 20]} />
          <meshStandardMaterial color={vivo ? GRIS_CLARO : GRIS} metalness={0.75} roughness={0.28} />
        </mesh>
        <group ref={cabeza} position={[0, 1.22, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.15, 32, 32]} />
            <meshStandardMaterial color={vivo ? '#c5c8ce' : '#4a4d53'} metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Visor */}
          <mesh position={[0, 0.01, -0.12]} rotation={[0, Math.PI, 0]}>
            <boxGeometry args={[0.2, 0.035, 0.06]} />
            <meshStandardMaterial color={vivo ? '#ffffff' : '#3a3c40'} emissive="#ffffff" emissiveIntensity={vivo ? (seleccionado ? 2.2 : 1.2) : 0} />
          </mesh>
          <AccesorioCabeza tipo={estilo.accesorio} vivo={vivo} />
        </group>
      </group>

      <Html position={[0, 1.78, 0.5]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={() => onSeleccion(id)}
          className={`block cursor-pointer whitespace-nowrap rounded-md border text-center ${compacto ? 'px-1.5 py-1' : 'px-2.5 py-1.5'} backdrop-blur transition-colors ${seleccionado ? 'border-white bg-white text-black' : vivo ? 'border-borde bg-black/70 text-white hover:border-plata-300' : 'border-borde-suave bg-black/60 text-plata-400 hover:border-plata-500'}`}
        >
          <p className={`${compacto ? 'text-[9px]' : 'text-[11px]'} flex items-center justify-center gap-1.5 font-medium leading-none`}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: estilo.color, opacity: vivo ? 1 : 0.45 }} />
            {agente.nombre}
          </p>
          {!compacto && <p className={`mt-0.5 text-[9px] uppercase tracking-[0.14em] ${seleccionado ? 'text-black/60' : 'text-plata-500'}`}>{estado}</p>}
        </button>
      </Html>
    </group>
  );
}

function Sala() {
  // Aristas de la sala para dar profundidad sin paredes sólidas.
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(17, 5, 12)), []);
  return (
    <lineSegments geometry={geo} position={[0, 2.5, -1.8]}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.08} />
    </lineSegments>
  );
}

/** Aleja la cámara en pantallas estrechas para que los diez puestos queden siempre a la vista. */
function AjusteCamara() {
  const { camera, size } = useThree();
  useEffect(() => {
    const factor = Math.max(1, 1.9 / (size.width / size.height));
    camera.position.set(0, 6.2 * factor, 9.6 * factor);
    camera.lookAt(0, 0.9, -2.2);
  }, [camera, size.width, size.height]);
  return null;
}

/** Rótulo de cada anillo (capa). */
function RotulosCapas() {
  const compacto = useThree((st) => st.size.width) < 700;
  if (compacto) return null;
  return (
    <>
      {([1, 2, 3] as const).map((c) => (
        <Html key={c} position={[-7.4, 0.02, FILAS[c].z + 0.4]} center style={{ pointerEvents: 'none' }}>
          <p className="whitespace-nowrap text-[8.5px] uppercase tracking-[0.2em] text-plata-600">
            Capa {c} · {CAPAS[c]}
          </p>
        </Html>
      ))}
    </>
  );
}

export default function SalaAgentes3D({ seleccion, onSeleccion, estados, etiquetaDatos, muro, activos }: Props) {
  const vivo = (a: (typeof AGENTES)[number]) => activos?.[a.id] ?? a.real;
  return (
    <Canvas shadows camera={{ position: [0, 6.2, 9.6], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}>
      <AjusteCamara />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 3, -2]} intensity={0.35} />
      <Sala />
      <Grid position={[0, 0, 0]} args={[20, 20]} cellSize={0.5} cellThickness={0.5} cellColor="#2a2a2e" sectionSize={2} sectionThickness={0.8} sectionColor="#45484e" fadeDistance={14} fadeStrength={1.5} infiniteGrid />
      <ContactShadows position={[0, 0.005, 0]} opacity={0.6} scale={12} blur={2.4} far={3} />
      <NucleoDatos etiqueta={etiquetaDatos} />
      <FlujoPaquetes vivo={vivo} />
      {muro && <MuroSala datos={muro} posicion={[0, 3.0, -7.0]} />}
      <RotulosCapas />
      {AGENTES.map((a) => (
        <Puesto key={a.id} id={a.id} seleccionado={seleccion === a.id} onSeleccion={onSeleccion} estado={estados[a.id]} vivo={vivo(a)} />
      ))}
      <OrbitControls target={[0, 0.9, -2.2]} enablePan={false} minDistance={5} maxDistance={24} minPolarAngle={0.5} maxPolarAngle={1.35} enableDamping />
    </Canvas>
  );
}
