import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Grid, Html, MeshReflectorMaterial, OrbitControls, RoundedBox } from '@react-three/drei';
import type { OrbitControls as Orbita } from 'three-stdlib';
import * as THREE from 'three';
import { AGENTES, ESTILO_AGENTE, type AgenteId } from '@/data/agentes';
import type { Nivel } from '@/motores/agentes/sala';
import { Robot } from './AgenteRobot';
import PrimeraPersona, { type Inicio } from './PrimeraPersona';
import { ALTO, ANCHO, PANTALLAS } from './pantallas';
import MuroSala from './MuroSala';
import type { DatosMuro } from './muro';

/** La pantalla gigante en la pared del fondo: todos los puestos la miran, como en una sala de control. */
const MURO: [number, number, number] = [0, 3.0, -7.0];
/** Núcleo de datos: flota delante de la pantalla y manda paquetes a cada puesto. */
const NUCLEO: [number, number, number] = [0, 0, -5.1];
/** Dos columnas frente a frente a lo largo del pasillo central (izquierda: los que leen los datos; derecha: los que
 *  deciden y operan), cada puesto girado un poco hacia la pantalla. El Juez, en el medio, de cara a todos. */
const IZQUIERDA: AgenteId[] = ['vigia', 'flujo', 'rastreador', 'etiquetador', 'lector'];
const DERECHA: AgenteId[] = ['programador', 'sintetizador', 'guardian', 'ejecutor'];
const COLUMNA_X = 3.6;
const HACIA_PANTALLA = 0.35;

const PUESTOS = (() => {
  const out = {} as Record<AgenteId, { pos: [number, number, number]; rot: number }>;
  const columna = (ids: AgenteId[], lado: -1 | 1) =>
    ids.forEach((id, i) => {
      const z = -4.4 + (i * 6) / (ids.length - 1);
      // El agente mira al pasillo (hacia el otro lado) y un poco hacia la pantalla.
      out[id] = { pos: [lado * COLUMNA_X, 0, z], rot: Math.atan2(lado * Math.cos(HACIA_PANTALLA), Math.sin(HACIA_PANTALLA)) };
    });
  columna(IZQUIERDA, -1);
  columna(DERECHA, 1);
  out.juez = { pos: [0, 0, -1.4], rot: Math.PI };
  return out;
})();

/** Celular o pantalla táctil: sin suavizado y a resolución normal. */
const MOVIL = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const GRIS_OSCURO = '#1a1b1e';
const GRIS = '#2c2e33';

interface Props {
  seleccion: AgenteId | null;
  onSeleccion: (id: AgenteId) => void;
  /** Texto de estado bajo el nombre de cada agente. */
  estados: Record<AgenteId, string>;
  /** Pantalla gigante en la pared del fondo (sin datos no se pinta). */
  muro?: DatosMuro;
  /** Cuánto se enciende cada agente según el orquestador (por defecto: listo si tiene motor). */
  niveles?: Partial<Record<AgenteId, Nivel>>;
}

/** Lo que no se puede atravesar en primera persona: cada puesto (escritorio + silla) y el núcleo. */
const OBSTACULOS: [number, number, number][] = [
  ...Object.values(PUESTOS).map(({ pos: [x, , z], rot }) => [x + 0.15 * Math.sin(rot), z + 0.15 * Math.cos(rot), 0.95] as [number, number, number]),
  [NUCLEO[0], NUCLEO[2], 0.7],
];

/** Halo redondo y suave (para la luz de cada puesto en el suelo y en el escritorio). */
let brillo: THREE.Texture | null = null;
const texturaBrillo = () =>
  (brillo ??= (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })());

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
        const fin = new THREE.Vector3(pos[0], 1.05, pos[2]);
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
    // Sin motor: un solo cuadro quieto. Con motor: ~2 cuadros por segundo (más rápido si está seleccionado).
    const t = apagado ? 0 : clock.elapsedTime * (activo ? 1.6 : 1);
    if (apagado ? ultimo.current === 0 : clock.elapsedTime - ultimo.current < 0.5) return;
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

function Puesto({ id, seleccionado, onSeleccion, estado, nivel }: { id: AgenteId; seleccionado: boolean; onSeleccion: (id: AgenteId) => void; estado: string; nivel: Nivel }) {
  const { pos, rot } = PUESTOS[id];
  const agente = AGENTES.find((a) => a.id === id)!;
  const estilo = ESTILO_AGENTE[id];
  const anillo = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  // En pantallas estrechas el rótulo solo lleva el nombre (los 10 puestos no caben con dos líneas).
  const compacto = useThree((st) => st.size.width) < 700;
  useFrame(({ clock }) => {
    if (!anillo.current) return;
    anillo.current.rotation.z = clock.elapsedTime * 0.5;
    (anillo.current.material as THREE.MeshBasicMaterial).opacity = seleccionado ? 0.9 : hover ? 0.5 : 0.15;
  });
  // Cuánta luz del color del agente: a tope si trabaja, media si está listo, casi nada si está apagado.
  const luz = nivel === 2 ? 1 : nivel ? 0.6 : 0.07;
  const halo = (opacidad: number) => <meshBasicMaterial map={texturaBrillo()} color={estilo.color} transparent opacity={opacidad} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />;

  return (
    <group
      position={pos}
      rotation={[0, rot, 0]}
      onClick={(e) => {
        e.stopPropagation();
        // Un arrastre (girar la sala o mirar en primera persona) no es un toque.
        if (e.delta < 8) onSeleccion(id);
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
      <mesh ref={anillo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0.15]}>
        <ringGeometry args={[0.86, 0.88, 64, 1, 0, Math.PI * 1.7]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.15} />
      </mesh>

      {/* La luz del puesto: halo suave en el suelo, aro LED, tira bajo el escritorio y el reflejo del monitor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0.1]}>
        <planeGeometry args={[2.4, 2.4]} />
        {halo(luz * (seleccionado ? 0.5 : 0.32))}
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0.15]}>
        <ringGeometry args={[0.8, 0.815, 96]} />
        <meshBasicMaterial color={estilo.color} transparent opacity={luz * (seleccionado ? 1 : 0.7)} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.692, 0.152]}>
        <boxGeometry args={[1.22, 0.008, 0.006]} />
        <meshBasicMaterial color={estilo.color} transparent opacity={luz * 0.9} toneMapped={false} />
      </mesh>

      {/* Escritorio, teclado y monitor */}
      <RoundedBox args={[1.3, 0.05, 0.7]} radius={0.01} position={[0, 0.72, -0.2]} castShadow>
        <meshStandardMaterial color={GRIS} metalness={0.4} roughness={0.55} />
      </RoundedBox>
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.36, -0.2]} castShadow>
          <boxGeometry args={[0.03, 0.72, 0.62]} />
          <meshStandardMaterial color={GRIS_OSCURO} metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.747, -0.2]}>
        <planeGeometry args={[1.1, 0.6]} />
        {halo(luz * 0.22)}
      </mesh>
      <Monitor id={id} color={estilo.color} activo={nivel === 2} apagado={nivel === 0} />
      <mesh position={[0, 0.755, 0.0]}>
        <boxGeometry args={[0.42, 0.015, 0.14]} />
        <meshStandardMaterial color={GRIS_OSCURO} emissive={estilo.color} emissiveIntensity={luz * 0.25} />
      </mesh>

      {/* Zona de toque amplia e invisible: facilita seleccionar al agente en pantallas táctiles */}
      <mesh position={[0, 0.85, 0.3]}>
        <cylinderGeometry args={[0.55, 0.55, 1.7, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <group position={[0, 0, 0.5]}>
        <Robot color={estilo.color} accesorio={estilo.accesorio} nivel={nivel} seleccionado={seleccionado} />
      </group>

      <Html position={[0, 1.9, 0.5]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={() => onSeleccion(id)}
          className={`block cursor-pointer whitespace-nowrap rounded-md border text-center ${compacto ? 'px-1.5 py-1' : 'px-2.5 py-1.5'} transition-colors ${seleccionado ? 'border-white bg-white text-black' : nivel ? 'border-borde bg-black/70 text-white hover:border-plata-300' : 'border-borde-suave bg-black/60 text-plata-400 hover:border-plata-500'}`}
        >
          <p className={`${compacto ? 'text-[9px]' : 'text-[11px]'} flex items-center justify-center gap-1.5 font-medium leading-none`}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: estilo.color, opacity: nivel ? 1 : 0.4, boxShadow: nivel === 2 ? `0 0 6px ${estilo.color}` : 'none' }} />
            {agente.nombre}
          </p>
          {!compacto && <p className={`mt-0.5 text-[9px] uppercase tracking-[0.14em] ${seleccionado ? 'text-black/60' : 'text-plata-500'}`}>{estado}</p>}
        </button>
      </Html>
    </group>
  );
}

/** La sala de control: piso negro satinado que refleja las luces (en el celular, sin reflejo), paredes con tiras
 *  de luz finas, las líneas del pasillo y las aristas del cuarto. */
function Sala() {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(18, 5.2, 15)), []);
  const tira = (opacidad: number) => <meshBasicMaterial color="#ffffff" transparent opacity={opacidad} toneMapped={false} />;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, -0.5]}>
        <planeGeometry args={[18, 15]} />
        {MOVIL ? (
          <meshStandardMaterial color="#08080a" metalness={0.2} roughness={0.95} />
        ) : (
          <MeshReflectorMaterial resolution={512} blur={[300, 80]} mixBlur={1} mixStrength={6} mirror={0.4} roughness={0.85} depthScale={0.6} minDepthThreshold={0.4} maxDepthThreshold={1.3} color="#07070a" metalness={0.6} />
        )}
      </mesh>
      <mesh position={[0, 2.6, -7.5]}>
        <planeGeometry args={[18, 5.2]} />
        <meshStandardMaterial color="#0d0e12" roughness={0.85} />
      </mesh>
      {[-1, 1].map((l) => (
        <group key={l}>
          <mesh position={[l * 9, 2.6, -0.5]} rotation={[0, -l * (Math.PI / 2), 0]}>
            <planeGeometry args={[15, 5.2]} />
            <meshStandardMaterial color="#0a0b0e" roughness={0.9} />
          </mesh>
          {[-6, -3, 0, 3, 6].map((z) => (
            <mesh key={z} position={[l * 8.97, 1.9, z]}>
              <boxGeometry args={[0.02, 2.8, 0.025]} />
              {tira(0.16)}
            </mesh>
          ))}
          {/* Líneas del pasillo en el suelo */}
          <mesh position={[l * 1.75, 0.004, -0.2]}>
            <boxGeometry args={[0.015, 0.002, 11.5]} />
            {tira(0.12)}
          </mesh>
        </group>
      ))}
      <lineSegments geometry={geo} position={[0, 2.6, -0.5]}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.06} />
      </lineSegments>
    </group>
  );
}

/** Cámara de frente y arriba, sobre el pasillo: las dos columnas, el Juez y la pantalla al fondo (más lejos en pantallas estrechas para que quepa todo). */
const MIRA: [number, number, number] = [0, 0.9, -1.8];
function AjusteCamara() {
  const { camera, size } = useThree();
  useEffect(() => {
    // En el celular se acerca más de la cuenta: se ven el centro y la pantalla; los lados, girando con el dedo.
    const factor = Math.max(1, 1.75 / (size.width / size.height)) ** 0.42;
    camera.position.set(0, 0.9 + 7.6 * factor, -1.8 + 12.3 * factor);
    camera.lookAt(...MIRA);
  }, [camera, size.width, size.height]);
  return null;
}

/** Al acercarse de más con el zoom se entra caminando: donde estaba la cámara (dentro de la sala), mirando al centro. */
const ENTRAR_A = 5.4;
const entradaDesde = (c: THREE.Camera): Inicio => {
  const x = Math.max(-7, Math.min(7, c.position.x));
  const z = Math.max(-5, Math.min(6.4, c.position.z));
  return { x, z, yaw: Math.atan2(-(MIRA[0] - x), -(MIRA[2] - z)) };
};
const boton: CSSProperties = { pointerEvents: 'auto', background: 'rgba(0,0,0,.72)', border: '1px solid rgba(255,255,255,.22)', color: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 12, backdropFilter: 'none' };

export default function SalaAgentes3D({ seleccion, onSeleccion, estados, muro, niveles }: Props) {
  const nivelDe = (a: (typeof AGENTES)[number]): Nivel => niveles?.[a.id] ?? (a.real ? 1 : 0);
  // Fuera de la vista (scroll u otra pestaña), la sala no se dibuja: cero GPU.
  const [lienzo, setLienzo] = useState<HTMLCanvasElement | null>(null);
  const [enVista, setEnVista] = useState(true);
  const [fp, setFp] = useState<Inicio | null>(null);
  const avance = useRef(0);
  useEffect(() => {
    if (!lienzo) return;
    const o = new IntersectionObserver(([e]) => setEnVista(e.isIntersecting));
    o.observe(lienzo);
    return () => o.disconnect();
  }, [lienzo]);
  useEffect(() => {
    if (!fp) return;
    const salir = (e: KeyboardEvent) => e.key === 'Escape' && setFp(null);
    window.addEventListener('keydown', salir);
    return () => window.removeEventListener('keydown', salir);
  }, [fp]);
  const pedal = (v: number) => ({ onPointerDown: () => (avance.current = v), onPointerUp: () => (avance.current = 0), onPointerLeave: () => (avance.current = 0), onPointerCancel: () => (avance.current = 0) });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas frameloop={enVista ? 'always' : 'never'} onCreated={({ gl }) => setLienzo(gl.domElement)} camera={{ position: [0, 8.5, 10.5], fov: 50 }} dpr={[1, MOVIL ? 1 : 1.5]} gl={{ antialias: !MOVIL, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}>
        {!fp && <AjusteCamara />}
        <fog attach="fog" args={['#000000', 18, 40]} />
        <hemisphereLight args={['#cdd5ff', '#040405', 0.55]} />
        <ambientLight intensity={0.15} />
        <directionalLight position={[3, 9, 8]} intensity={1.15} />
        <directionalLight position={[-7, 4, -3]} intensity={0.35} color="#9fb0ff" />
        <Sala />
        <Grid position={[0, 0.002, 0]} args={[20, 20]} cellSize={0.5} cellThickness={0.4} cellColor="#16171a" sectionSize={2} sectionThickness={0.7} sectionColor="#26282d" fadeDistance={16} fadeStrength={1.5} infiniteGrid />
        <ContactShadows position={[0, 0.005, 0]} opacity={0.7} scale={16} blur={2.4} far={3} frames={1} />
        <NucleoDatos />
        <FlujoPaquetes vivo={(a) => nivelDe(a) === 2} />
        {muro && <MuroSala datos={muro} posicion={MURO} />}
        {AGENTES.map((a) => (
          <Puesto key={a.id} id={a.id} seleccionado={seleccion === a.id} onSeleccion={onSeleccion} estado={estados[a.id]} nivel={nivelDe(a)} />
        ))}
        {fp ? (
          <PrimeraPersona inicio={fp} obstaculos={OBSTACULOS} avance={avance} />
        ) : (
          <OrbitControls target={MIRA} enablePan={false} minDistance={5} maxDistance={24} minPolarAngle={0.5} maxPolarAngle={1.35} enableDamping onEnd={(e) => {
            const c = e?.target as Orbita | undefined;
            if (c && c.getDistance() < ENTRAR_A) setFp(entradaDesde(c.object));
          }} />
        )}
      </Canvas>
      <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, pointerEvents: 'none', zIndex: 30 }}>
        {fp ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
              <button type="button" style={boton} onClick={() => setFp(null)}>◀ Vista general</button>
              <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,.6)', background: 'rgba(0,0,0,.5)', padding: '3px 7px', borderRadius: 6 }}>{MOVIL ? 'Arrastra para mirar · pellizca o ▲ ▼ para caminar' : 'Arrastra para mirar · rueda, W A S D o flechas para caminar · Esc para salir'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button type="button" aria-label="Avanzar" style={{ ...boton, padding: '10px 16px', touchAction: 'none' }} {...pedal(1)}>▲</button>
              <button type="button" aria-label="Retroceder" style={{ ...boton, padding: '10px 16px', touchAction: 'none' }} {...pedal(-1)}>▼</button>
            </div>
          </>
        ) : (
          <button type="button" style={{ ...boton, marginLeft: 'auto' }} onClick={() => setFp({ x: 0, z: 5.6, yaw: 0 })}>{MOVIL ? 'Primera persona' : 'Entrar a la sala · primera persona'}</button>
        )}
      </div>
    </div>
  );
}
