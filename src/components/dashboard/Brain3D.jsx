import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Parámetros de la red
// ---------------------------------------------------------------------------
const RADIUS = 1.6;
const SURFACE_NODES = 2400;
const CORE_NODES = 600;
const SURFACE_LINKS_PER_NODE = 3;
const CORE_LINKS_PER_NODE = 2;
const RADIAL_LINKS = 90;

const LEFT_BUNDLES = [0.62, 0, -0.62]; // altura relativa de los 3 paneles de entrada
const RIGHT_BUNDLES = [0.72, 0.24, -0.24, -0.72]; // altura relativa de los 4 paneles del motor
const STRANDS_IN = 5;
const STRANDS_OUT = 3;

const INPUT_POOL = 180;
const OUTPUT_POOL = 120;
const INPUT_RATE = 14; // partículas / s
const OUTPUT_RATE = 7;
const CORE_TRAVEL_TIME = 0.7; // s desde la superficie hasta el núcleo
const AMBIENT_FLASH_RATE = 2.5; // destellos espontáneos / s
const AUTO_ROTATE = 0.07; // rad / s

const FOV = 38;

// ---------------------------------------------------------------------------
// Shaders (puntos circulares suaves en blanco, con atenuación por profundidad)
// ---------------------------------------------------------------------------
const NODE_VERTEX = /* glsl */ `
  uniform float uScale;
  attribute float aSize;
  attribute float aBase;
  attribute float aGlow;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;
    float fade = 1.0 - smoothstep(uDepthNear, uDepthFar, depth) * 0.75;
    vAlpha = aBase * fade + aGlow;
    gl_PointSize = aSize * (1.0 + aGlow * 2.4) * uScale / depth;
    gl_Position = projectionMatrix * mv;
  }
`;

const SIGNAL_VERTEX = /* glsl */ `
  uniform float uScale;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vAlpha = aAlpha;
    gl_PointSize = 2.6 * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(1.0), a * vAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Construcción de la geometría
// ---------------------------------------------------------------------------
function fibonacciSphere(count, radius, jitter) {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const k = radius * (1 + (Math.random() - 0.5) * jitter);
    out[i * 3] = Math.cos(theta) * r * k;
    out[i * 3 + 1] = y * k;
    out[i * 3 + 2] = Math.sin(theta) * r * k;
  }
  return out;
}

function randomBall(count, radius) {
  const out = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(radius * Math.cbrt(Math.random()));
    v.toArray(out, i * 3);
  }
  return out;
}

/** k vecinos más cercanos de cada nodo en [from, to) buscando en [from, to). */
function nearestLinks(pos, from, to, k, pairs, adjacency) {
  const best = new Array(k);
  for (let i = from; i < to; i++) {
    best.fill(null);
    const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2];
    for (let j = from; j < to; j++) {
      if (j === i) continue;
      const dx = pos[j * 3] - ix, dy = pos[j * 3 + 1] - iy, dz = pos[j * 3 + 2] - iz;
      const d = dx * dx + dy * dy + dz * dz;
      for (let s = 0; s < k; s++) {
        if (!best[s] || d < best[s].d) {
          best.splice(s, 0, { j, d });
          best.length = k;
          break;
        }
      }
    }
    for (const b of best) {
      if (!b) continue;
      const a = Math.min(i, b.j), c = Math.max(i, b.j);
      const key = a * 100000 + c;
      if (pairs.has(key)) continue;
      pairs.add(key);
      adjacency[a].push(c);
      adjacency[c].push(a);
    }
  }
}

function buildNetwork() {
  const total = SURFACE_NODES + CORE_NODES;
  const positions = new Float32Array(total * 3);
  positions.set(fibonacciSphere(SURFACE_NODES, RADIUS, 0.035), 0);
  positions.set(randomBall(CORE_NODES, RADIUS * 0.82), SURFACE_NODES * 3);

  const sizes = new Float32Array(total);
  const base = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const surface = i < SURFACE_NODES;
    sizes[i] = surface ? 0.9 + Math.random() * 0.9 : 0.6 + Math.random() * 0.6;
    base[i] = surface ? 0.5 + Math.random() * 0.4 : 0.22 + Math.random() * 0.25;
  }

  const pairs = new Set();
  const adjacency = Array.from({ length: total }, () => []);
  nearestLinks(positions, 0, SURFACE_NODES, SURFACE_LINKS_PER_NODE, pairs, adjacency);
  nearestLinks(positions, SURFACE_NODES, total, CORE_LINKS_PER_NODE, pairs, adjacency);

  // Sinapsis radiales: núcleo -> superficie
  for (let n = 0; n < RADIAL_LINKS; n++) {
    const c = SURFACE_NODES + Math.floor(Math.random() * CORE_NODES);
    const s = Math.floor(Math.random() * SURFACE_NODES);
    const key = s * 100000 + c;
    if (pairs.has(key)) continue;
    pairs.add(key);
    adjacency[s].push(c);
    adjacency[c].push(s);
  }

  const linePositions = new Float32Array(pairs.size * 6);
  let o = 0;
  for (const key of pairs) {
    const a = Math.floor(key / 100000);
    const b = key % 100000;
    linePositions.set(positions.subarray(a * 3, a * 3 + 3), o);
    linePositions.set(positions.subarray(b * 3, b * 3 + 3), o + 3);
    o += 6;
  }

  return { positions, sizes, base, adjacency, linePositions, nodeCount: total, linkCount: pairs.size };
}

/** Curvas de señal desde los bordes del viewport hasta la superficie de la esfera. */
function buildCurves(halfW, halfH) {
  const inputs = [];
  LEFT_BUNDLES.forEach((ry) => {
    const y0 = ry * halfH * 0.92;
    for (let k = 0; k < STRANDS_IN; k++) {
      const off = k - (STRANDS_IN - 1) / 2;
      const start = new THREE.Vector3(-halfW - 0.05, y0 + off * 0.035, 0);
      const end = new THREE.Vector3(-1, ry * 0.85 + off * 0.11, 0.35 + off * 0.06).normalize().multiplyScalar(RADIUS);
      const c1 = new THREE.Vector3(THREE.MathUtils.lerp(start.x, end.x, 0.5), start.y, 0);
      const c2 = new THREE.Vector3(end.x - RADIUS * 0.55, end.y, end.z * 0.6);
      inputs.push(new THREE.CubicBezierCurve3(start, c1, c2, end));
    }
  });

  const outputs = [];
  RIGHT_BUNDLES.forEach((ry) => {
    const y1 = ry * halfH * 0.92;
    for (let k = 0; k < STRANDS_OUT; k++) {
      const off = k - (STRANDS_OUT - 1) / 2;
      const start = new THREE.Vector3(1, ry * 0.8 + off * 0.1, 0.3 + off * 0.05).normalize().multiplyScalar(RADIUS);
      const end = new THREE.Vector3(halfW + 0.05, y1 + off * 0.03, 0);
      const c1 = new THREE.Vector3(start.x + RADIUS * 0.55, start.y, start.z * 0.6);
      const c2 = new THREE.Vector3(THREE.MathUtils.lerp(start.x, end.x, 0.55), end.y, 0);
      outputs.push(new THREE.CubicBezierCurve3(start, c1, c2, end));
    }
  });

  return { inputs, outputs };
}

function curvesToGeometry(curves, segments = 48) {
  const pts = [];
  for (const curve of curves) {
    const sampled = curve.getPoints(segments);
    for (let i = 0; i < sampled.length - 1; i++) pts.push(sampled[i], sampled[i + 1]);
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export default function Brain3D({ onReady, onError }) {
  const containerRef = useRef(null);
  const [stats, setStats] = useState(null);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (err) {
      setFailed(true);
      callbacks.current.onError?.(err);
      return undefined;
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const motion = reducedMotion ? 0.3 : 1;

    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

    // --- Red neuronal --------------------------------------------------------
    const net = buildNetwork();
    const brain = new THREE.Group();
    brain.rotation.x = 0.18;
    scene.add(brain);

    const glow = new Float32Array(net.nodeCount);
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(net.positions, 3));
    nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(net.sizes, 1));
    nodeGeo.setAttribute('aBase', new THREE.BufferAttribute(net.base, 1));
    const glowAttr = new THREE.BufferAttribute(glow, 1).setUsage(THREE.DynamicDrawUsage);
    nodeGeo.setAttribute('aGlow', glowAttr);

    const uniforms = {
      uScale: { value: 10 },
      uDepthNear: { value: 0 },
      uDepthFar: { value: 1 },
    };
    const nodeMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `uniform float uDepthNear;\nuniform float uDepthFar;\n${NODE_VERTEX}`,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    brain.add(new THREE.Points(nodeGeo, nodeMat));

    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute('position', new THREE.BufferAttribute(net.linePositions, 3));
    const linkMat = new THREE.LineBasicMaterial({
      color: 0xc5c9d0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    brain.add(new THREE.LineSegments(linkGeo, linkMat));

    const glowTexture = makeGlowTexture();
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    core.scale.setScalar(RADIUS * 1.6);
    scene.add(core);

    // --- Conductos de señal ---------------------------------------------------
    const inMat = new THREE.LineBasicMaterial({ color: 0x9aa0aa, transparent: true, opacity: 0.32, depthWrite: false });
    const outMat = new THREE.LineDashedMaterial({
      color: 0x9aa0aa,
      transparent: true,
      opacity: 0.38,
      dashSize: 0.025,
      gapSize: 0.05,
      depthWrite: false,
    });
    const inLines = new THREE.LineSegments(new THREE.BufferGeometry(), inMat);
    const outLines = new THREE.LineSegments(new THREE.BufferGeometry(), outMat);
    scene.add(inLines, outLines);
    let curves = { inputs: [], outputs: [] };

    // --- Partículas de señal --------------------------------------------------
    const poolSize = INPUT_POOL + OUTPUT_POOL;
    const sigPos = new Float32Array(poolSize * 3);
    const sigAlpha = new Float32Array(poolSize);
    const sigGeo = new THREE.BufferGeometry();
    const sigPosAttr = new THREE.BufferAttribute(sigPos, 3).setUsage(THREE.DynamicDrawUsage);
    const sigAlphaAttr = new THREE.BufferAttribute(sigAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    sigGeo.setAttribute('position', sigPosAttr);
    sigGeo.setAttribute('aAlpha', sigAlphaAttr);
    const sigMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SIGNAL_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const signals = new THREE.Points(sigGeo, sigMat);
    signals.frustumCulled = false;
    scene.add(signals);

    // stage: 0 = libre, 1 = viajando por el conducto, 2 = penetrando hacia el núcleo
    const particles = Array.from({ length: poolSize }, (_, i) => ({
      output: i >= INPUT_POOL,
      stage: 0,
      curve: 0,
      t: 0,
      speed: 0,
      entry: new THREE.Vector3(),
    }));

    const tmp = new THREE.Vector3();
    const local = new THREE.Vector3();

    function flashNode(index, strength) {
      glow[index] = Math.max(glow[index], strength);
      for (const n of net.adjacency[index]) glow[n] = Math.max(glow[n], strength * 0.55);
    }

    function nearestSurfaceNode(worldPoint) {
      brain.worldToLocal(local.copy(worldPoint));
      let best = 0;
      let bestD = Infinity;
      const p = net.positions;
      for (let i = 0; i < SURFACE_NODES; i++) {
        const dx = p[i * 3] - local.x, dy = p[i * 3 + 1] - local.y, dz = p[i * 3 + 2] - local.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    function spawn(output) {
      const list = output ? curves.outputs : curves.inputs;
      if (!list.length) return;
      const from = output ? INPUT_POOL : 0;
      const to = output ? poolSize : INPUT_POOL;
      for (let i = from; i < to; i++) {
        const p = particles[i];
        if (p.stage !== 0) continue;
        p.stage = 1;
        p.curve = Math.floor(Math.random() * list.length);
        p.t = 0;
        p.speed = (0.28 + Math.random() * 0.3) * motion;
        if (output) {
          list[p.curve].getPoint(0, tmp);
          flashNode(nearestSurfaceNode(tmp), 0.9);
        }
        return;
      }
    }

    function updateParticles(dt) {
      for (let i = 0; i < poolSize; i++) {
        const p = particles[i];
        const o = i * 3;
        if (p.stage === 0) {
          sigAlpha[i] = 0;
          continue;
        }
        const list = p.output ? curves.outputs : curves.inputs;
        const curve = list[p.curve];
        if (!curve) {
          p.stage = 0;
          continue;
        }

        if (p.stage === 1) {
          p.t += p.speed * dt;
          if (p.t >= 1) {
            if (p.output) {
              p.stage = 0;
              sigAlpha[i] = 0;
              continue;
            }
            curve.getPoint(1, p.entry);
            flashNode(nearestSurfaceNode(p.entry), 1.4);
            p.stage = 2;
            p.t = 0;
          } else {
            curve.getPoint(p.t, tmp);
            tmp.toArray(sigPos, o);
            const edge = Math.min(p.t / 0.08, (1 - p.t) / 0.08, 1);
            sigAlpha[i] = 0.95 * Math.max(edge, p.output ? 0 : 0.35);
            continue;
          }
        }

        // stage 2: de la superficie hacia el centro, desvaneciéndose
        p.t += (dt / CORE_TRAVEL_TIME) * motion;
        if (p.t >= 1) {
          p.stage = 0;
          sigAlpha[i] = 0;
          continue;
        }
        tmp.copy(p.entry).multiplyScalar(1 - p.t);
        tmp.toArray(sigPos, o);
        sigAlpha[i] = 0.9 * (1 - p.t);
      }
      sigPosAttr.needsUpdate = true;
      sigAlphaAttr.needsUpdate = true;
    }

    // --- Interacción: arrastrar para rotar ------------------------------------
    const drag = { active: false, x: 0, y: 0, vx: 0, vy: 0 };
    const canvas = renderer.domElement;
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';

    const onPointerDown = (e) => {
      drag.active = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onPointerMove = (e) => {
      if (!drag.active) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      brain.rotation.y += dx * 0.005;
      brain.rotation.x = THREE.MathUtils.clamp(brain.rotation.x + dy * 0.005, -1.1, 1.1);
      drag.vx = dx * 0.3;
      drag.vy = dy * 0.3;
    };
    const onPointerUp = (e) => {
      drag.active = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    // --- Redimensionado -------------------------------------------------------
    function resize() {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      renderer.setSize(w, h, false);
      canvas.style.width = '100%';
      canvas.style.height = '100%';

      const aspect = w / h;
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      // Distancia mínima para que la esfera quepa con margen para los conductos.
      const dist = Math.max((RADIUS * 1.35) / tan, (RADIUS * 2.0) / (tan * aspect));
      camera.aspect = aspect;
      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      uniforms.uScale.value = h * 0.018 * renderer.getPixelRatio() * (dist / 5.5);
      uniforms.uDepthNear.value = dist - RADIUS;
      uniforms.uDepthFar.value = dist + RADIUS;

      const halfH = tan * dist;
      const halfW = halfH * aspect;
      curves = buildCurves(halfW, halfH);
      inLines.geometry.dispose();
      outLines.geometry.dispose();
      inLines.geometry = curvesToGeometry(curves.inputs);
      outLines.geometry = curvesToGeometry(curves.outputs);
      outLines.computeLineDistances();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    // --- Bucle de animación ---------------------------------------------------
    const clock = new THREE.Clock();
    let inAcc = 0;
    let outAcc = 0;
    let frame = 0;

    function tick() {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      if (!drag.active) {
        brain.rotation.y += (AUTO_ROTATE * motion + drag.vx * 0.05) * dt;
        brain.rotation.x = THREE.MathUtils.clamp(brain.rotation.x + drag.vy * 0.05 * dt, -1.1, 1.1);
        drag.vx *= Math.exp(-dt * 2.5);
        drag.vy *= Math.exp(-dt * 2.5);
      }
      brain.position.y = Math.sin(t * 0.6) * 0.03 * motion;

      inAcc += dt * INPUT_RATE * motion;
      while (inAcc >= 1) {
        spawn(false);
        inAcc -= 1;
      }
      outAcc += dt * OUTPUT_RATE * motion;
      while (outAcc >= 1) {
        spawn(true);
        outAcc -= 1;
      }
      if (Math.random() < dt * AMBIENT_FLASH_RATE * motion) {
        flashNode(Math.floor(Math.random() * net.nodeCount), 0.8);
      }

      updateParticles(dt);

      const decay = Math.exp(-dt * 3.2);
      for (let i = 0; i < glow.length; i++) {
        if (glow[i] > 0.002) glow[i] *= decay;
        else glow[i] = 0;
      }
      glowAttr.needsUpdate = true;

      core.material.opacity = 0.75 + Math.sin(t * 1.4) * 0.15;

      renderer.render(scene, camera);
    }
    tick();

    setStats({ nodes: net.nodeCount, links: net.linkCount });
    callbacks.current.onReady?.({ nodes: net.nodeCount, links: net.linkCount });

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      [nodeGeo, linkGeo, inLines.geometry, outLines.geometry, sigGeo].forEach((g) => g.dispose());
      [nodeMat, linkMat, inMat, outMat, sigMat, core.material].forEach((m) => m.dispose());
      glowTexture.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  const fmt = (n) => n.toLocaleString('es-ES');

  return (
    <div className="relative h-full min-h-[320px] w-full overflow-hidden" aria-label="Cerebro 3D: red neuronal">
      <div ref={containerRef} className="absolute inset-0" />

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-mono text-xs uppercase tracking-label text-cemento-300">WebGL no disponible en este navegador</p>
        </div>
      )}

      <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cemento-300">Núcleo Cognitivo</p>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-4 whitespace-nowrap font-mono text-[10px] uppercase tracking-label text-cemento-400">
        <span>Nodos {stats ? fmt(stats.nodes) : '--'}</span>
        <span>Sinapsis {stats ? fmt(stats.links) : '--'}</span>
        <span>Estado Standby</span>
      </div>
    </div>
  );
}
