import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { HIPOTESIS, RELACIONES_HIPOTESIS, TEMAS, type EstadoHipotesis, type Hipotesis, type Tema } from '@/data/mock';
import { crearAleatorio } from '@/lib/random';

const CENTROS: Record<Tema, [number, number, number]> = {
  'Order Flow': [-2.3, 0.9, 0.2],
  Volatilidad: [2.2, 1.0, -0.4],
  'Mean Reversion': [-1.7, -1.3, -0.6],
  Momentum: [1.9, -1.1, 0.7],
};

const CAPAS = 6;
const NEURONAS_POR_CAPA = 420;

interface Props {
  estados: Record<string, EstadoHipotesis>;
  seleccion: string | null;
  temaActivo: Tema | null;
  onSeleccion: (id: string) => void;
}

/** Posición determinista de cada hipótesis alrededor del centro de su tema. */
function usePosiciones() {
  return useMemo(() => {
    const rand = crearAleatorio(7);
    const porTema: Record<string, number> = {};
    const mapa: Record<string, THREE.Vector3> = {};
    for (const h of HIPOTESIS) {
      const k = (porTema[h.tema] = (porTema[h.tema] ?? -1) + 1);
      const ang = (k / 4) * Math.PI * 2 + rand() * 0.6;
      const r = 0.75 + rand() * 0.35;
      const c = CENTROS[h.tema];
      mapa[h.id] = new THREE.Vector3(c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r * 0.8, c[2] + (rand() - 0.5) * 1.1);
    }
    return mapa;
  }, []);
}

const VERTEX_CAPAS = /* glsl */ `
  uniform float uTiempo;
  uniform float uEscala;
  attribute float aCapa;
  attribute float aBase;
  varying float vAlfa;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float ola = pow(max(0.0, sin(uTiempo * 1.1 - aCapa * 1.05)), 8.0);
    vAlfa = aBase + ola * 0.75;
    gl_PointSize = (1.4 + ola * 1.8) * uEscala / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlfa;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vec3(1.0), smoothstep(0.5, 0.0, d) * vAlfa);
  }
`;

/** Capas concéntricas de neuronas que se activan en ondas desde el núcleo hacia fuera. */
function CapasNeuronales() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const geo = useMemo(() => {
    const total = CAPAS * NEURONAS_POR_CAPA;
    const pos = new Float32Array(total * 3);
    const capa = new Float32Array(total);
    const base = new Float32Array(total);
    const rand = crearAleatorio(42);
    const v = new THREE.Vector3();
    for (let c = 0; c < CAPAS; c++) {
      const r = 1.1 + c * 0.75;
      for (let i = 0; i < NEURONAS_POR_CAPA; i++) {
        const k = c * NEURONAS_POR_CAPA + i;
        const y = 1 - (i / (NEURONAS_POR_CAPA - 1)) * 2;
        const rr = Math.sqrt(1 - y * y);
        const th = i * Math.PI * (3 - Math.sqrt(5)) + c;
        v.set(Math.cos(th) * rr, y * 0.78, Math.sin(th) * rr).multiplyScalar(r * (1 + (rand() - 0.5) * 0.06));
        v.toArray(pos, k * 3);
        capa[k] = c;
        base[k] = 0.05 + rand() * 0.1;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCapa', new THREE.BufferAttribute(capa, 1));
    g.setAttribute('aBase', new THREE.BufferAttribute(base, 1));
    return g;
  }, []);
  const uniforms = useMemo(() => ({ uTiempo: { value: 0 }, uEscala: { value: 18 } }), []);

  useFrame(({ clock, size }) => {
    uniforms.uTiempo.value = clock.elapsedTime;
    uniforms.uEscala.value = size.height * 0.03;
  });

  return (
    <points geometry={geo}>
      <shaderMaterial ref={mat} uniforms={uniforms} vertexShader={VERTEX_CAPAS} fragmentShader={FRAGMENT} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function NodoHipotesis({ h, pos, estado, seleccionado, atenuado, onSeleccion }: { h: Hipotesis; pos: THREE.Vector3; estado: EstadoHipotesis; seleccionado: boolean; atenuado: boolean; onSeleccion: (id: string) => void }) {
  const malla = useRef<THREE.Mesh>(null);
  const anillo = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const radio = 0.05 + Math.sqrt(h.ocurrencias) * 0.0036;
  const rechazada = estado === 'Rechazada';
  const fase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (malla.current) {
      const pulso = estado === 'En prueba' ? 1 + Math.sin(t * 3 + fase) * 0.18 : 1;
      malla.current.scale.setScalar(pulso * (hover || seleccionado ? 1.35 : 1));
    }
    if (anillo.current) {
      anillo.current.rotation.z = t * 0.6 + fase;
      anillo.current.lookAt(0, 0, 10);
    }
  });

  const opacidad = atenuado ? 0.15 : rechazada ? 0.45 : 1;
  const alClic = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSeleccion(h.id);
  };

  return (
    <group
      position={pos}
      onClick={alClic}
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
      {/* Zona de toque invisible, más grande que el nodo, para pantallas táctiles */}
      <mesh>
        <sphereGeometry args={[Math.max(radio * 3, 0.24), 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={malla}>
        <sphereGeometry args={[radio, 24, 24]} />
        {rechazada ? (
          <meshBasicMaterial color="#9a9da4" wireframe transparent opacity={opacidad} />
        ) : (
          <meshBasicMaterial color={estado === 'Aprobada' ? '#ffffff' : '#c9ccd2'} transparent opacity={opacidad} />
        )}
      </mesh>
      {/* Halo */}
      {!rechazada && (
        <mesh>
          <sphereGeometry args={[radio * 2.4, 16, 16]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={(atenuado ? 0.01 : 0.05) * (seleccionado ? 2.5 : 1)} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
      {(estado === 'Aprobada' || seleccionado) && (
        <mesh ref={anillo}>
          <ringGeometry args={[radio * 1.8, radio * 1.95, 48, 1, 0, Math.PI * 1.6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={atenuado ? 0.1 : 0.8} side={THREE.DoubleSide} />
        </mesh>
      )}
      {(hover || seleccionado) && (
        <Html position={[0, radio + 0.16, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap rounded border border-borde bg-black/85 px-2 py-1 font-mono text-[10px] text-plata-100 backdrop-blur">
            {h.id} · {estado}
          </div>
        </Html>
      )}
    </group>
  );
}

/** Señal que viaja entre dos hipótesis relacionadas. */
function Senal({ desde, hasta, retraso, atenuado }: { desde: THREE.Vector3; hasta: THREE.Vector3; retraso: number; atenuado: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const curva = useMemo(() => {
    const medio = desde.clone().add(hasta).multiplyScalar(0.5);
    medio.multiplyScalar(0.7);
    return new THREE.QuadraticBezierCurve3(desde, medio, hasta);
  }, [desde, hasta]);
  const vel = useMemo(() => 0.18 + Math.random() * 0.2, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime * vel + retraso) % 1;
    curva.getPoint(t, ref.current.position);
    const m = ref.current.material as THREE.MeshBasicMaterial;
    m.opacity = (atenuado ? 0.15 : 1) * Math.sin(t * Math.PI);
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.028, 8, 8]} />
      <meshBasicMaterial color="#ffffff" transparent />
    </mesh>
  );
}

function Escena({ estados, seleccion, temaActivo, onSeleccion }: Props) {
  const posiciones = usePosiciones();
  const grupo = useRef<THREE.Group>(null);
  const temaDe = useMemo(() => Object.fromEntries(HIPOTESIS.map((h) => [h.id, h.tema])), []);

  const curvas = useMemo(
    () =>
      RELACIONES_HIPOTESIS.map(([a, b]) => {
        const pa = posiciones[a], pb = posiciones[b];
        const medio = pa.clone().add(pb).multiplyScalar(0.5).multiplyScalar(0.7);
        return { a, b, pa, pb, puntos: new THREE.QuadraticBezierCurve3(pa, medio, pb).getPoints(32) };
      }),
    [posiciones],
  );

  useFrame((_, dt) => {
    if (grupo.current) grupo.current.rotation.y += dt * 0.03;
  });

  const atenuadoTema = (t: Tema) => temaActivo !== null && temaActivo !== t;

  return (
    <group ref={grupo}>
      <CapasNeuronales />

      {/* Rayos del tema: centro → hipótesis */}
      {HIPOTESIS.map((h) => (
        <Line key={`r-${h.id}`} points={[CENTROS[h.tema], posiciones[h.id].toArray()]} color="#ffffff" lineWidth={0.6} transparent opacity={atenuadoTema(h.tema) ? 0.03 : 0.14} />
      ))}

      {/* Relaciones entre hipótesis */}
      {curvas.map((c, i) => {
        const at = temaActivo !== null && temaDe[c.a] !== temaActivo && temaDe[c.b] !== temaActivo;
        const resaltada = seleccion === c.a || seleccion === c.b;
        return (
          <group key={`${c.a}-${c.b}`}>
            <Line points={c.puntos} color="#ffffff" lineWidth={resaltada ? 1.4 : 0.8} transparent opacity={at ? 0.04 : resaltada ? 0.7 : 0.26} dashed={!resaltada} dashSize={0.06} gapSize={0.05} />
            <Senal desde={c.pa} hasta={c.pb} retraso={i / curvas.length} atenuado={at} />
          </group>
        );
      })}

      {/* Centros de tema */}
      {TEMAS.map((t) => (
        <group key={t} position={CENTROS[t]}>
          <mesh>
            <octahedronGeometry args={[0.09, 0]} />
            <meshBasicMaterial color="#ffffff" wireframe transparent opacity={atenuadoTema(t) ? 0.15 : 0.8} />
          </mesh>
          <Html position={[0, -0.32, 0]} center style={{ pointerEvents: 'none' }}>
            <div className={`whitespace-nowrap text-center transition-opacity ${atenuadoTema(t) ? 'opacity-25' : 'opacity-100'}`}>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white">{t}</p>
              <p className="font-mono text-[9px] text-plata-500">{HIPOTESIS.filter((h) => h.tema === t).length} hipótesis</p>
            </div>
          </Html>
        </group>
      ))}

      {HIPOTESIS.map((h) => (
        <NodoHipotesis
          key={h.id}
          h={h}
          pos={posiciones[h.id]}
          estado={estados[h.id] ?? h.estado}
          seleccionado={seleccion === h.id}
          atenuado={atenuadoTema(h.tema)}
          onSeleccion={onSeleccion}
        />
      ))}
    </group>
  );
}

export default function Constelacion(props: Props) {
  return (
    <Canvas camera={{ position: [0, 0.6, 8.2], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <Escena {...props} />
      <OrbitControls enablePan={false} minDistance={5} maxDistance={12} autoRotate={false} enableDamping dampingFactor={0.08} rotateSpeed={0.6} />
    </Canvas>
  );
}
