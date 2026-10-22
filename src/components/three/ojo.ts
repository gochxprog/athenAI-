import * as THREE from 'three';

// Ojo dentro del cerebro: almendra de luz, pupila negra con un punto blanco y fibras que fluyen desde la pupila.
// Va pegado a los golpes del cerebro: se desplaza, se sacude y mira hacia donde entró el dato; parpadea solo.
type Golpe = { vivo: boolean; t: number; fuerza: number; dir: THREE.Vector3 };

const ANCHO = 0.52;
const ALTO = 0.19;
const FIBRAS = 1400;
const REMOLINO = 900;

const borde = (x: number, alto: number) => alto * Math.max(0, 1 - (x / ANCHO) ** 2);
/** Distancia desde (px, py) en la dirección (ca, sa) hasta el borde de la almendra: y = ±alto·(1 − x²/ancho²), resuelto
 * como una ecuación de 2.º grado (antes se buscaba a pasos: ~70.000 cuentas por cuadro). */
function hastaBorde(px: number, py: number, ca: number, sa: number): number {
  const s = sa >= 0 ? 1 : -1;
  const k = (ALTO * 0.96) / ANCHO ** 2;
  const a = k * ca * ca;
  const b = s * sa + 2 * k * px * ca;
  const c = s * py + k * px * px - ALTO * 0.96;
  const r = a < 1e-9 ? -c / b : (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
  return Math.min(ANCHO, Math.max(0.09, r));
}

function halo(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function crearOjo() {
  const grupo = new THREE.Group();
  grupo.renderOrder = 10;
  const sobre = { depthTest: false, depthWrite: false, transparent: true };
  let semilla = 11;
  const rnd = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;

  // Fondo oscuro de la almendra (para que el ojo se lea sobre la red del cerebro).
  const N = 64;
  const forma = new THREE.Shape();
  forma.moveTo(-ANCHO, 0);
  for (let i = 1; i <= N; i++) { const x = -ANCHO + (2 * ANCHO * i) / N; forma.lineTo(x, borde(x, ALTO)); }
  for (let i = N; i >= 0; i--) { const x = -ANCHO + (2 * ANCHO * i) / N; forma.lineTo(x, -borde(x, ALTO)); }
  const fondo = new THREE.Mesh(new THREE.ShapeGeometry(forma), new THREE.MeshBasicMaterial({ color: 0x050506, opacity: 0.92, ...sobre }));
  // Contorno: línea brillante + dos pasadas más anchas y tenues (brillo).
  const contornoGeo = new THREE.BufferGeometry().setFromPoints(forma.getPoints(N * 2).map((p) => new THREE.Vector3(p.x, p.y, 0)));
  const contornos = [1, 1.025, 1.06].map((e, i) => {
    const l = new THREE.LineLoop(contornoGeo, new THREE.LineBasicMaterial({ color: 0xffffff, opacity: [1, 0.45, 0.18][i], blending: THREE.AdditiveBlending, ...sobre }));
    l.scale.setScalar(e);
    return l;
  });

  // Fibras dentro de la almendra: trazos cortos que salen de la pupila hacia el borde.
  const fib = Array.from({ length: FIBRAS }, () => ({ a: rnd() * Math.PI * 2, u: rnd(), v: 0.15 + rnd() * 0.35, luz: 0.3 + rnd() * 0.7 }));
  const posF = new Float32Array(FIBRAS * 6);
  const colF = new Float32Array(FIBRAS * 6);
  const geoF = new THREE.BufferGeometry();
  geoF.setAttribute('position', new THREE.BufferAttribute(posF, 3));
  geoF.setAttribute('color', new THREE.BufferAttribute(colF, 3));
  const fibras = new THREE.LineSegments(geoF, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, ...sobre }));

  // Remolino fuera de la almendra: trazos que giran alrededor del ojo y se apagan lejos.
  const rem = Array.from({ length: REMOLINO }, () => ({ a: rnd() * Math.PI * 2, r: 0.3 + rnd() ** 0.7 * 0.75, w: 0.25 + rnd() * 0.5, luz: rnd() }));
  const posR = new Float32Array(REMOLINO * 6);
  const colR = new Float32Array(REMOLINO * 6);
  const geoR = new THREE.BufferGeometry();
  geoR.setAttribute('position', new THREE.BufferAttribute(posR, 3));
  geoR.setAttribute('color', new THREE.BufferAttribute(colR, 3));
  const remolino = new THREE.LineSegments(geoR, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, ...sobre }));

  const iris = new THREE.Group();
  const pupila = new THREE.Mesh(new THREE.CircleGeometry(0.075, 48), new THREE.MeshBasicMaterial({ color: 0x000000, ...sobre }));
  const aro = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.082, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.25, ...sobre }));
  const luz = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), blending: THREE.AdditiveBlending, ...sobre }));
  luz.scale.setScalar(0.1);
  iris.add(pupila, aro, luz);

  const parpado = new THREE.Group();
  parpado.add(fondo, fibras, iris, ...contornos);
  grupo.add(remolino, parpado);
  grupo.traverse((o) => (o.renderOrder = 10));

  const mira = new THREE.Vector2();
  const objetivo = new THREE.Vector2();
  const empuje = new THREE.Vector2();
  const tmp = new THREE.Vector3();
  let sacudida = 0;
  let cierre = 0;
  let parpadeo = 0;
  let proximo = 3;
  let pupilaR = 1;

  const actualizar = (dt: number, t: number, golpes: Golpe[], giro: THREE.Quaternion) => {
    // Golpes del cerebro → empuje y sacudida; el ojo mira hacia el golpe más fuerte.
    empuje.set(0, 0);
    let fuerte = 0;
    for (const g of golpes) {
      if (!g.vivo) continue;
      const amp = g.fuerza * (1 - Math.exp(-g.t * 18)) * Math.exp(-g.t * 2.1) * Math.cos(g.t * 9);
      tmp.copy(g.dir).applyQuaternion(giro);
      empuje.x -= tmp.x * amp * 0.35;
      empuje.y -= tmp.y * amp * 0.35;
      if (g.t < 0.08 && Math.abs(g.fuerza) > fuerte) {
        fuerte = Math.abs(g.fuerza);
        objetivo.set(tmp.x, tmp.y).normalize();
      }
    }
    if (fuerte > 0.2) {
      sacudida = Math.min(1, sacudida + fuerte * 1.6);
      pupilaR = 1.35;
      if (fuerte > 0.3) parpadeo = 1;
    }
    sacudida *= Math.exp(-dt * 5);
    pupilaR += (1 - pupilaR) * dt * 1.5;
    objetivo.multiplyScalar(Math.exp(-dt * 0.6));
    mira.lerp(objetivo, 1 - Math.exp(-dt * 6));

    if (t >= proximo) {
      parpadeo = 1;
      proximo = t + 4 + Math.random() * 5;
    }
    parpadeo = Math.max(0, parpadeo - dt * 5);
    cierre = Math.sin(parpadeo * Math.PI);

    const sx = Math.sin(t * 57) * sacudida * 0.03;
    const sy = Math.cos(t * 43) * sacudida * 0.025;
    grupo.position.set(empuje.x + sx, empuje.y + sy, 0);
    parpado.scale.y = Math.max(0.04, 1 - cierre);
    iris.position.set(mira.x * ANCHO * 0.45, mira.y * ALTO * 0.45, 0);
    iris.scale.setScalar(pupilaR);
    luz.material.opacity = 0.85 + Math.sin(t * 3) * 0.15;

    // Fibras: nacen en la pupila y corren hacia el borde de la almendra.
    const px = iris.position.x;
    const py = iris.position.y;
    for (let i = 0; i < FIBRAS; i++) {
      const f = fib[i];
      f.u += dt * f.v * (1 + sacudida * 2);
      if (f.u > 1) f.u -= 1;
      const ca = Math.cos(f.a);
      const sa = Math.sin(f.a);
      const lim = hastaBorde(px, py, ca, sa);
      const r0 = 0.085 * pupilaR + (lim - 0.085 * pupilaR) * f.u;
      const r1 = Math.min(lim, r0 + 0.025 + f.u * 0.02);
      const k = i * 6;
      posF[k] = px + ca * r0; posF[k + 1] = py + sa * r0; posF[k + 2] = 0;
      posF[k + 3] = px + ca * r1; posF[k + 4] = py + sa * r1; posF[k + 5] = 0;
      const b = f.luz * (1 - f.u * 0.8) * (0.38 + sacudida * 0.4);
      colF.fill(b, k, k + 6);
    }
    geoF.attributes.position.needsUpdate = true;
    geoF.attributes.color.needsUpdate = true;

    // Remolino: gira alrededor, más rápido cerca del ojo.
    for (let i = 0; i < REMOLINO; i++) {
      const q = rem[i];
      q.a += dt * q.w * (0.5 / q.r) * (1 + sacudida);
      const a1 = q.a + 0.05 + 0.03 / q.r;
      const k = i * 6;
      posR[k] = Math.cos(q.a) * q.r; posR[k + 1] = Math.sin(q.a) * q.r * 0.62; posR[k + 2] = 0;
      posR[k + 3] = Math.cos(a1) * q.r; posR[k + 4] = Math.sin(a1) * q.r * 0.62; posR[k + 5] = 0;
      const b = q.luz * Math.max(0, 1 - (q.r - 0.3) / 0.8) * 0.9;
      colR.fill(b, k, k + 6);
    }
    geoR.attributes.position.needsUpdate = true;
    geoR.attributes.color.needsUpdate = true;
  };

  return { grupo, actualizar };
}
