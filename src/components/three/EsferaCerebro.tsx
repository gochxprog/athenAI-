import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// -----------------------------------------------------------------------------
// Cerebro de Deep Learning: esfera de partículas (nodos = neuronas, líneas = sinapsis)
// con haces de señal que entran desde las Fuentes de datos y salen hacia el Motor.
// Three.js puro: un único render loop, sin re-renders de React.
// -----------------------------------------------------------------------------

const RADIO = 1.6;
const NODOS_SUPERFICIE = 2600;
const NODOS_NUCLEO = 700;
const ENLACES_SUPERFICIE = 3;
const ENLACES_NUCLEO = 2;
const ENLACES_RADIALES = 110;

const HILOS_ENTRADA = 6;
const HILOS_SALIDA = 4;
const POOL_ENTRADA = 200;
const POOL_SALIDA = 140;
const POOL_IMPULSOS = 160;
const RITMO_ENTRADA = 16; // partículas / s
const RITMO_SALIDA = 9;
const RITMO_IMPULSOS = 22;
const TIEMPO_NUCLEO = 0.7;
const AUTO_ROTACION = 0.07;
const FOV = 36;

const VERTEX_NODOS = /* glsl */ `
  uniform float uEscala;
  uniform float uCerca;
  uniform float uLejos;
  uniform float uTiempo;
  attribute float aTam;
  attribute float aBase;
  attribute float aBrillo;
  varying float vAlfa;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float prof = -mv.z;
    float atenuacion = 1.0 - smoothstep(uCerca, uLejos, prof) * 0.78;
    // Onda de activación que recorre la esfera de polo a polo.
    float onda = 0.78 + 0.22 * sin(uTiempo * 1.4 - position.y * 2.6);
    vAlfa = aBase * atenuacion * onda + aBrillo;
    gl_PointSize = aTam * (1.0 + aBrillo * 2.6) * uEscala / prof;
    gl_Position = projectionMatrix * mv;
  }
`;

const VERTEX_SENAL = /* glsl */ `
  uniform float uEscala;
  attribute float aAlfa;
  attribute float aTam;
  varying float vAlfa;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vAlfa = aAlfa;
    gl_PointSize = aTam * uEscala / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_PUNTO = /* glsl */ `
  varying float vAlfa;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(1.0), a * vAlfa);
  }
`;

// --- Geometría --------------------------------------------------------------
function esferaFibonacci(n: number, r: number, ruido: number) {
  const out = new Float32Array(n * 3);
  const aureo = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rr = Math.sqrt(1 - y * y);
    const k = r * (1 + (Math.random() - 0.5) * ruido);
    out[i * 3] = Math.cos(aureo * i) * rr * k;
    out[i * 3 + 1] = y * k;
    out[i * 3 + 2] = Math.sin(aureo * i) * rr * k;
  }
  return out;
}

function bolaAleatoria(n: number, r: number) {
  const out = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.randomDirection().multiplyScalar(r * Math.cbrt(Math.random()));
    v.toArray(out, i * 3);
  }
  return out;
}

function enlazarVecinos(pos: Float32Array, desde: number, hasta: number, k: number, pares: Set<number>, ady: number[][]) {
  const mejores: { j: number; d: number }[] = [];
  for (let i = desde; i < hasta; i++) {
    mejores.length = 0;
    const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2];
    for (let j = desde; j < hasta; j++) {
      if (j === i) continue;
      const dx = pos[j * 3] - ix, dy = pos[j * 3 + 1] - iy, dz = pos[j * 3 + 2] - iz;
      const d = dx * dx + dy * dy + dz * dz;
      if (mejores.length < k || d < mejores[mejores.length - 1].d) {
        let s = mejores.length;
        while (s > 0 && mejores[s - 1].d > d) s--;
        mejores.splice(s, 0, { j, d });
        if (mejores.length > k) mejores.pop();
      }
    }
    for (const m of mejores) agregarPar(i, m.j, pares, ady);
  }
}

function agregarPar(a: number, b: number, pares: Set<number>, ady: number[][]) {
  const x = Math.min(a, b), y = Math.max(a, b);
  const clave = x * 100000 + y;
  if (pares.has(clave)) return;
  pares.add(clave);
  ady[x].push(y);
  ady[y].push(x);
}

function construirRed() {
  const total = NODOS_SUPERFICIE + NODOS_NUCLEO;
  const pos = new Float32Array(total * 3);
  pos.set(esferaFibonacci(NODOS_SUPERFICIE, RADIO, 0.035), 0);
  pos.set(bolaAleatoria(NODOS_NUCLEO, RADIO * 0.82), NODOS_SUPERFICIE * 3);

  const tam = new Float32Array(total);
  const base = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const sup = i < NODOS_SUPERFICIE;
    tam[i] = sup ? 0.9 + Math.random() * 1.0 : 0.6 + Math.random() * 0.6;
    base[i] = sup ? 0.48 + Math.random() * 0.42 : 0.2 + Math.random() * 0.25;
  }

  const pares = new Set<number>();
  const ady: number[][] = Array.from({ length: total }, () => []);
  enlazarVecinos(pos, 0, NODOS_SUPERFICIE, ENLACES_SUPERFICIE, pares, ady);
  enlazarVecinos(pos, NODOS_SUPERFICIE, total, ENLACES_NUCLEO, pares, ady);
  for (let n = 0; n < ENLACES_RADIALES; n++) {
    agregarPar(Math.floor(Math.random() * NODOS_SUPERFICIE), NODOS_SUPERFICIE + Math.floor(Math.random() * NODOS_NUCLEO), pares, ady);
  }

  const lineas = new Float32Array(pares.size * 6);
  let o = 0;
  for (const clave of pares) {
    const a = Math.floor(clave / 100000);
    const b = clave % 100000;
    lineas.set(pos.subarray(a * 3, a * 3 + 3), o);
    lineas.set(pos.subarray(b * 3, b * 3 + 3), o + 3);
    o += 6;
  }
  return { pos, tam, base, ady, lineas, total, sinapsis: pares.size };
}

/** Haces Bézier desde los bordes del viewport hasta la superficie de la esfera. */
function construirCurvas(medioAncho: number, medioAlto: number, izq: number[], der: number[]) {
  const entradas: THREE.CubicBezierCurve3[] = [];
  izq.forEach((ry) => {
    const y0 = ry * medioAlto;
    for (let k = 0; k < HILOS_ENTRADA; k++) {
      const off = k - (HILOS_ENTRADA - 1) / 2;
      const ini = new THREE.Vector3(-medioAncho - 0.02, y0 + off * 0.028, 0);
      const fin = new THREE.Vector3(-1, ry * 0.75 + off * 0.1, 0.35 + off * 0.05).normalize().multiplyScalar(RADIO);
      const c1 = new THREE.Vector3(THREE.MathUtils.lerp(ini.x, fin.x, 0.5), ini.y, 0);
      const c2 = new THREE.Vector3(fin.x - RADIO * 0.55, fin.y, fin.z * 0.6);
      entradas.push(new THREE.CubicBezierCurve3(ini, c1, c2, fin));
    }
  });
  const salidas: THREE.CubicBezierCurve3[] = [];
  der.forEach((ry) => {
    const y1 = ry * medioAlto;
    for (let k = 0; k < HILOS_SALIDA; k++) {
      const off = k - (HILOS_SALIDA - 1) / 2;
      const ini = new THREE.Vector3(1, ry * 0.75 + off * 0.1, 0.3 + off * 0.05).normalize().multiplyScalar(RADIO);
      const fin = new THREE.Vector3(medioAncho + 0.02, y1 + off * 0.025, 0);
      const c1 = new THREE.Vector3(ini.x + RADIO * 0.55, ini.y, ini.z * 0.6);
      const c2 = new THREE.Vector3(THREE.MathUtils.lerp(ini.x, fin.x, 0.55), fin.y, 0);
      salidas.push(new THREE.CubicBezierCurve3(ini, c1, c2, fin));
    }
  });
  return { entradas, salidas };
}

function curvasAGeometria(curvas: THREE.Curve<THREE.Vector3>[], segmentos = 56) {
  const pts: THREE.Vector3[] = [];
  for (const c of curvas) {
    const m = c.getPoints(segmentos);
    for (let i = 0; i < m.length - 1; i++) pts.push(m[i], m[i + 1]);
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function texturaHalo() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

// --- Componente ---------------------------------------------------------------
interface Props {
  /** Alturas relativas (−1 abajo … 1 arriba) de las tarjetas de la izquierda. */
  anclasIzq?: number[];
  /** Alturas relativas de las tarjetas de la derecha. */
  anclasDer?: number[];
  /** Intensidad del flujo (0 … 1); 0 deja la esfera en reposo. */
  actividad?: number;
  onListo?: (info: { nodos: number; sinapsis: number }) => void;
  className?: string;
}

export default function EsferaCerebro({ anclasIzq = [0.62, 0, -0.62], anclasDer = [0.62, 0, -0.62], actividad = 1, onListo, className = '' }: Props) {
  const contRef = useRef<HTMLDivElement>(null);
  const anclas = useRef({ izq: anclasIzq, der: anclasDer, rehacer: () => {} });
  const actividadRef = useRef(actividad);
  const listoRef = useRef(onListo);
  actividadRef.current = actividad;
  listoRef.current = onListo;

  useEffect(() => {
    anclas.current.izq = anclasIzq;
    anclas.current.der = anclasDer;
    anclas.current.rehacer();
  }, [anclasIzq.join(','), anclasDer.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cont = contRef.current;
    const refAnclas = anclas.current;
    if (!cont) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      cont.dataset.sinWebgl = 'true';
      return;
    }
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const movimiento = reducido ? 0.3 : 1;

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    cont.appendChild(canvas);

    const escena = new THREE.Scene();
    const camara = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

    // Red neuronal
    const red = construirRed();
    const cerebro = new THREE.Group();
    cerebro.rotation.x = 0.18;
    escena.add(cerebro);

    const brillo = new Float32Array(red.total);
    const geoNodos = new THREE.BufferGeometry();
    geoNodos.setAttribute('position', new THREE.BufferAttribute(red.pos, 3));
    geoNodos.setAttribute('aTam', new THREE.BufferAttribute(red.tam, 1));
    geoNodos.setAttribute('aBase', new THREE.BufferAttribute(red.base, 1));
    const attrBrillo = new THREE.BufferAttribute(brillo, 1).setUsage(THREE.DynamicDrawUsage);
    geoNodos.setAttribute('aBrillo', attrBrillo);

    const uniforms = {
      uEscala: { value: 10 },
      uCerca: { value: 0 },
      uLejos: { value: 1 },
      uTiempo: { value: 0 },
    };
    const matNodos = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_NODOS,
      fragmentShader: FRAGMENT_PUNTO,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    cerebro.add(new THREE.Points(geoNodos, matNodos));

    const geoSinapsis = new THREE.BufferGeometry();
    geoSinapsis.setAttribute('position', new THREE.BufferAttribute(red.lineas, 3));
    const matSinapsis = new THREE.LineBasicMaterial({ color: 0xd9dbdf, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending });
    cerebro.add(new THREE.LineSegments(geoSinapsis, matSinapsis));

    // Anillos orbitales finos
    const matAnillo = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false });
    const anillos: THREE.LineLoop[] = [];
    [1.18, 1.32].forEach((f, i) => {
      const curva = new THREE.EllipseCurve(0, 0, RADIO * f, RADIO * f, 0, Math.PI * 2);
      const geo = new THREE.BufferGeometry().setFromPoints(curva.getPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y)));
      const anillo = new THREE.LineLoop(geo, matAnillo);
      anillo.rotation.x = i ? 1.2 : 0.3;
      anillo.rotation.z = i ? -0.4 : 0.25;
      escena.add(anillo);
      anillos.push(anillo);
    });

    const halo = texturaHalo();
    const nucleo = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    nucleo.scale.setScalar(RADIO * 1.7);
    escena.add(nucleo);

    // Haces de entrada / salida
    const matEntrada = new THREE.LineBasicMaterial({ color: 0xb8bbc2, transparent: true, opacity: 0.3, depthWrite: false });
    const matSalida = new THREE.LineDashedMaterial({ color: 0xb8bbc2, transparent: true, opacity: 0.38, dashSize: 0.025, gapSize: 0.05, depthWrite: false });
    const lineasEntrada = new THREE.LineSegments(new THREE.BufferGeometry(), matEntrada);
    const lineasSalida = new THREE.LineSegments(new THREE.BufferGeometry(), matSalida);
    escena.add(lineasEntrada, lineasSalida);
    let curvas = { entradas: [] as THREE.CubicBezierCurve3[], salidas: [] as THREE.CubicBezierCurve3[] };

    // Partículas de señal (espacio del mundo)
    const pool = POOL_ENTRADA + POOL_SALIDA;
    const posSenal = new Float32Array(pool * 3);
    const alfaSenal = new Float32Array(pool);
    const tamSenal = new Float32Array(pool).fill(2.6);
    const geoSenal = new THREE.BufferGeometry();
    const attrPosSenal = new THREE.BufferAttribute(posSenal, 3).setUsage(THREE.DynamicDrawUsage);
    const attrAlfaSenal = new THREE.BufferAttribute(alfaSenal, 1).setUsage(THREE.DynamicDrawUsage);
    geoSenal.setAttribute('position', attrPosSenal);
    geoSenal.setAttribute('aAlfa', attrAlfaSenal);
    geoSenal.setAttribute('aTam', new THREE.BufferAttribute(tamSenal, 1));
    const matSenal = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX_SENAL, fragmentShader: FRAGMENT_PUNTO, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const senales = new THREE.Points(geoSenal, matSenal);
    senales.frustumCulled = false;
    escena.add(senales);

    // Impulsos internos: recorren sinapsis de nodo en nodo (espacio local del cerebro)
    const posImp = new Float32Array(POOL_IMPULSOS * 3);
    const alfaImp = new Float32Array(POOL_IMPULSOS);
    const geoImp = new THREE.BufferGeometry();
    const attrPosImp = new THREE.BufferAttribute(posImp, 3).setUsage(THREE.DynamicDrawUsage);
    const attrAlfaImp = new THREE.BufferAttribute(alfaImp, 1).setUsage(THREE.DynamicDrawUsage);
    geoImp.setAttribute('position', attrPosImp);
    geoImp.setAttribute('aAlfa', attrAlfaImp);
    geoImp.setAttribute('aTam', new THREE.BufferAttribute(new Float32Array(POOL_IMPULSOS).fill(2.2), 1));
    const impulsosPts = new THREE.Points(geoImp, matSenal);
    impulsosPts.frustumCulled = false;
    cerebro.add(impulsosPts);

    type Particula = { salida: boolean; etapa: 0 | 1 | 2; curva: number; t: number; vel: number; entrada: THREE.Vector3 };
    const particulas: Particula[] = Array.from({ length: pool }, (_, i) => ({ salida: i >= POOL_ENTRADA, etapa: 0, curva: 0, t: 0, vel: 0, entrada: new THREE.Vector3() }));
    type Impulso = { vivo: boolean; a: number; b: number; t: number; vel: number; saltos: number };
    const impulsos: Impulso[] = Array.from({ length: POOL_IMPULSOS }, () => ({ vivo: false, a: 0, b: 0, t: 0, vel: 0, saltos: 0 }));

    const tmp = new THREE.Vector3();
    const local = new THREE.Vector3();

    const destello = (i: number, f: number) => {
      brillo[i] = Math.max(brillo[i], f);
      for (const n of red.ady[i]) brillo[n] = Math.max(brillo[n], f * 0.55);
    };

    const nodoCercano = (mundo: THREE.Vector3) => {
      cerebro.worldToLocal(local.copy(mundo));
      let mejor = 0;
      let mejorD = Infinity;
      const p = red.pos;
      for (let i = 0; i < NODOS_SUPERFICIE; i++) {
        const dx = p[i * 3] - local.x, dy = p[i * 3 + 1] - local.y, dz = p[i * 3 + 2] - local.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < mejorD) {
          mejorD = d;
          mejor = i;
        }
      }
      return mejor;
    };

    const lanzarImpulso = (desde: number) => {
      const imp = impulsos.find((x) => !x.vivo);
      const vecinos = red.ady[desde];
      if (!imp || !vecinos.length) return;
      imp.vivo = true;
      imp.a = desde;
      imp.b = vecinos[Math.floor(Math.random() * vecinos.length)];
      imp.t = 0;
      imp.vel = (2.2 + Math.random() * 1.8) * movimiento;
      imp.saltos = 3 + Math.floor(Math.random() * 5);
    };

    const emitir = (salida: boolean) => {
      const lista = salida ? curvas.salidas : curvas.entradas;
      if (!lista.length) return;
      const [d, h] = salida ? [POOL_ENTRADA, pool] : [0, POOL_ENTRADA];
      for (let i = d; i < h; i++) {
        const p = particulas[i];
        if (p.etapa !== 0) continue;
        p.etapa = 1;
        p.curva = Math.floor(Math.random() * lista.length);
        p.t = 0;
        p.vel = (0.26 + Math.random() * 0.3) * movimiento;
        if (salida) {
          lista[p.curva].getPoint(0, tmp);
          destello(nodoCercano(tmp), 0.9);
        }
        return;
      }
    };

    const actualizarSenales = (dt: number) => {
      for (let i = 0; i < pool; i++) {
        const p = particulas[i];
        if (p.etapa === 0) {
          alfaSenal[i] = 0;
          continue;
        }
        const lista = p.salida ? curvas.salidas : curvas.entradas;
        const curva = lista[p.curva];
        if (!curva) {
          p.etapa = 0;
          continue;
        }
        if (p.etapa === 1) {
          p.t += p.vel * dt;
          if (p.t >= 1) {
            if (p.salida) {
              p.etapa = 0;
              alfaSenal[i] = 0;
              continue;
            }
            curva.getPoint(1, p.entrada);
            const n = nodoCercano(p.entrada);
            destello(n, 1.4);
            lanzarImpulso(n);
            p.etapa = 2;
            p.t = 0;
          } else {
            curva.getPoint(p.t, tmp);
            tmp.toArray(posSenal, i * 3);
            const borde = Math.min(p.t / 0.08, (1 - p.t) / 0.08, 1);
            alfaSenal[i] = 0.95 * Math.max(borde, p.salida ? 0 : 0.35);
            continue;
          }
        }
        p.t += (dt / TIEMPO_NUCLEO) * movimiento;
        if (p.t >= 1) {
          p.etapa = 0;
          alfaSenal[i] = 0;
          continue;
        }
        tmp.copy(p.entrada).multiplyScalar(1 - p.t).toArray(posSenal, i * 3);
        alfaSenal[i] = 0.9 * (1 - p.t);
      }
      attrPosSenal.needsUpdate = true;
      attrAlfaSenal.needsUpdate = true;
    };

    const actualizarImpulsos = (dt: number) => {
      const p = red.pos;
      for (let i = 0; i < POOL_IMPULSOS; i++) {
        const imp = impulsos[i];
        if (!imp.vivo) {
          alfaImp[i] = 0;
          continue;
        }
        imp.t += imp.vel * dt;
        if (imp.t >= 1) {
          destello(imp.b, 0.75);
          imp.saltos -= 1;
          const vecinos = red.ady[imp.b];
          if (imp.saltos <= 0 || !vecinos.length) {
            imp.vivo = false;
            alfaImp[i] = 0;
            continue;
          }
          imp.a = imp.b;
          imp.b = vecinos[Math.floor(Math.random() * vecinos.length)];
          imp.t = 0;
        }
        const a = imp.a * 3, b = imp.b * 3;
        posImp[i * 3] = p[a] + (p[b] - p[a]) * imp.t;
        posImp[i * 3 + 1] = p[a + 1] + (p[b + 1] - p[a + 1]) * imp.t;
        posImp[i * 3 + 2] = p[a + 2] + (p[b + 2] - p[a + 2]) * imp.t;
        alfaImp[i] = 0.9;
      }
      attrPosImp.needsUpdate = true;
      attrAlfaImp.needsUpdate = true;
    };

    // Arrastrar para rotar
    const arrastre = { activo: false, x: 0, y: 0, vx: 0, vy: 0 };
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';
    const alPresionar = (e: PointerEvent) => {
      arrastre.activo = true;
      arrastre.x = e.clientX;
      arrastre.y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const alMover = (e: PointerEvent) => {
      if (!arrastre.activo) return;
      const dx = e.clientX - arrastre.x;
      const dy = e.clientY - arrastre.y;
      arrastre.x = e.clientX;
      arrastre.y = e.clientY;
      cerebro.rotation.y += dx * 0.005;
      cerebro.rotation.x = THREE.MathUtils.clamp(cerebro.rotation.x + dy * 0.005, -1.1, 1.1);
      arrastre.vx = dx * 0.3;
      arrastre.vy = dy * 0.3;
    };
    const alSoltar = (e: PointerEvent) => {
      arrastre.activo = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerdown', alPresionar);
    canvas.addEventListener('pointermove', alMover);
    canvas.addEventListener('pointerup', alSoltar);
    canvas.addEventListener('pointercancel', alSoltar);

    // Redimensionado + reconstrucción de haces
    let medio = { ancho: 1, alto: 1 };
    const rehacerCurvas = () => {
      curvas = construirCurvas(medio.ancho, medio.alto, refAnclas.izq, refAnclas.der);
      lineasEntrada.geometry.dispose();
      lineasSalida.geometry.dispose();
      lineasEntrada.geometry = curvasAGeometria(curvas.entradas);
      lineasSalida.geometry = curvasAGeometria(curvas.salidas);
      lineasSalida.computeLineDistances();
    };
    refAnclas.rehacer = rehacerCurvas;

    const redimensionar = () => {
      const w = Math.max(cont.clientWidth, 1);
      const h = Math.max(cont.clientHeight, 1);
      renderer.setSize(w, h, false);
      const aspecto = w / h;
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const dist = Math.max((RADIO * 1.4) / tan, (RADIO * 2.05) / (tan * aspecto));
      camara.aspect = aspecto;
      camara.position.set(0, 0, dist);
      camara.lookAt(0, 0, 0);
      camara.updateProjectionMatrix();
      uniforms.uEscala.value = h * 0.018 * renderer.getPixelRatio() * (dist / 5.5);
      uniforms.uCerca.value = dist - RADIO;
      uniforms.uLejos.value = dist + RADIO;
      medio = { alto: tan * dist, ancho: tan * dist * aspecto };
      rehacerCurvas();
    };
    const observador = new ResizeObserver(redimensionar);
    observador.observe(cont);
    redimensionar();

    // Bucle
    const reloj = new THREE.Clock();
    let accEntrada = 0;
    let accSalida = 0;
    let accImpulsos = 0;
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(reloj.getDelta(), 0.05);
      const t = reloj.elapsedTime;
      const act = actividadRef.current * movimiento;
      uniforms.uTiempo.value = t * movimiento;

      if (!arrastre.activo) {
        cerebro.rotation.y += (AUTO_ROTACION * movimiento + arrastre.vx * 0.05) * dt;
        cerebro.rotation.x = THREE.MathUtils.clamp(cerebro.rotation.x + arrastre.vy * 0.05 * dt, -1.1, 1.1);
        arrastre.vx *= Math.exp(-dt * 2.5);
        arrastre.vy *= Math.exp(-dt * 2.5);
      }
      cerebro.position.y = Math.sin(t * 0.6) * 0.03 * movimiento;
      const latido = 1 + Math.sin(t * 1.3) * 0.012 * movimiento;
      cerebro.scale.setScalar(latido);
      anillos[0].rotation.y += dt * 0.05 * movimiento;
      anillos[1].rotation.y -= dt * 0.035 * movimiento;

      accEntrada += dt * RITMO_ENTRADA * act;
      while (accEntrada >= 1) {
        emitir(false);
        accEntrada -= 1;
      }
      accSalida += dt * RITMO_SALIDA * act;
      while (accSalida >= 1) {
        emitir(true);
        accSalida -= 1;
      }
      accImpulsos += dt * RITMO_IMPULSOS * act;
      while (accImpulsos >= 1) {
        lanzarImpulso(Math.floor(Math.random() * red.total));
        accImpulsos -= 1;
      }

      actualizarSenales(dt);
      actualizarImpulsos(dt);

      const decaimiento = Math.exp(-dt * 3.2);
      for (let i = 0; i < brillo.length; i++) brillo[i] = brillo[i] > 0.002 ? brillo[i] * decaimiento : 0;
      attrBrillo.needsUpdate = true;
      nucleo.material.opacity = 0.7 + Math.sin(t * 1.4) * 0.18;

      renderer.render(escena, camara);
    };
    tick();
    listoRef.current?.({ nodos: red.total, sinapsis: red.sinapsis });

    return () => {
      cancelAnimationFrame(frame);
      observador.disconnect();
      refAnclas.rehacer = () => {};
      canvas.removeEventListener('pointerdown', alPresionar);
      canvas.removeEventListener('pointermove', alMover);
      canvas.removeEventListener('pointerup', alSoltar);
      canvas.removeEventListener('pointercancel', alSoltar);
      escena.traverse((o) => {
        const obj = o as THREE.Mesh;
        obj.geometry?.dispose();
      });
      [matNodos, matSinapsis, matEntrada, matSalida, matSenal, matAnillo, nucleo.material].forEach((m) => m.dispose());
      halo.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return <div ref={contRef} className={`relative h-full w-full ${className}`} />;
}
