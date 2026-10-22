// Encima del cerebro: líneas finas desde cada tarjeta, destellos que corren por ellas (entran desde las fuentes y
// salen hacia las métricas) y el anillo con los agentes. Canvas 2D, un solo bucle, sin re-renders de React.
import { useEffect, useRef } from 'react';

export interface AgenteAnillo { nombre: string; activo: boolean }
interface Destello { linea: number; t: number; vel: number }

export default function Hilos({ agentes, pulsos }: { agentes: AgenteAnillo[]; pulsos: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const datos = useRef({ agentes, pulsos, vistos: pulsos });
  datos.current.agentes = agentes;
  datos.current.pulsos = pulsos;

  useEffect(() => {
    const c = ref.current!;
    const x = c.getContext('2d')!;
    const escena = c.parentElement!;
    const destellos: Destello[] = [];
    let lineas: { a: [number, number]; b: [number, number]; sale: boolean }[] = [];
    let centro = { x: 0, y: 0, r: 100, lim: 100 };
    let cuadro = 0;
    let giro = 0;
    let ultimo = performance.now();

    const medir = () => {
      const e = escena.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio);
      c.width = e.width * dpr;
      c.height = e.height * dpr;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cer = escena.querySelector('.cerebro')!.getBoundingClientRect();
      centro = { x: cer.left - e.left + cer.width / 2, y: cer.top - e.top + cer.height / 2, r: Math.min(cer.width, cer.height) * 0.36, lim: Math.min(cer.width, cer.height) / 2 - 30 };
      lineas = [...escena.querySelectorAll<HTMLElement>('.tarjeta.izq, .tarjeta.der')].flatMap((t) => {
        const r = t.getBoundingClientRect();
        const sale = t.classList.contains('der');
        const borde = (sale ? r.left : r.right) - e.left;
        // Solo si la tarjeta está al lado del cerebro (en el celular van debajo y no llevan línea).
        if (sale ? borde < centro.x + centro.r : borde > centro.x - centro.r) return [];
        const y = r.top - e.top + r.height / 2;
        const fin: [number, number] = [centro.x + (sale ? 1 : -1) * centro.r * 0.82, centro.y + (y - centro.y) * 0.35];
        return [{ a: [borde + (sale ? -4 : 4), y] as [number, number], b: fin, sale }];
      });
    };
    const punto = (l: (typeof lineas)[number], t: number): [number, number] => {
      const [ax, ay] = l.a;
      const [bx, by] = l.b;
      const mx = (ax + bx) / 2;
      const u = 1 - t;
      // Curva cúbica con tangentes horizontales (como un cable).
      return [u ** 3 * ax + 3 * u * u * t * mx + 3 * u * t * t * mx + t ** 3 * bx, u ** 3 * ay + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * by];
    };

    const dibujar = (ahora: number) => {
      cuadro = requestAnimationFrame(dibujar);
      const dt = Math.min(0.05, (ahora - ultimo) / 1000);
      ultimo = ahora;
      const d = datos.current;
      x.clearRect(0, 0, c.width, c.height);
      // Líneas finas.
      x.lineWidth = 1;
      for (const l of lineas) {
        const g = x.createLinearGradient(l.a[0], 0, l.b[0], 0);
        g.addColorStop(0, 'rgba(255,255,255,0.32)');
        g.addColorStop(1, 'rgba(255,255,255,0.04)');
        x.strokeStyle = g;
        x.beginPath();
        for (let i = 0; i <= 40; i++) {
          const [px, py] = punto(l, i / 40);
          if (i) x.lineTo(px, py);
          else x.moveTo(px, py);
        }
        x.stroke();
      }
      // Destellos: uno de vez en cuando por línea y una ráfaga cuando llegan datos nuevos.
      if (lineas.length && Math.random() < dt * 1.6) destellos.push({ linea: Math.floor(Math.random() * lineas.length), t: 0, vel: 0.35 + Math.random() * 0.3 });
      if (d.pulsos !== d.vistos) {
        d.vistos = d.pulsos;
        lineas.forEach((l, i) => !l.sale && destellos.push({ linea: i, t: 0, vel: 0.6 }));
      }
      for (let i = destellos.length - 1; i >= 0; i--) {
        const s = destellos[i];
        const l = lineas[s.linea];
        s.t += dt * s.vel;
        if (!l || s.t >= 1) {
          destellos.splice(i, 1);
          continue;
        }
        // Las fuentes entran al cerebro; las métricas salen de él.
        const [px, py] = punto(l, l.sale ? 1 - s.t : s.t);
        const brillo = Math.sin(s.t * Math.PI);
        const halo = x.createRadialGradient(px, py, 0, px, py, 7);
        halo.addColorStop(0, `rgba(255,255,255,${0.95 * brillo})`);
        halo.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = halo;
        x.beginPath();
        x.arc(px, py, 7, 0, Math.PI * 2);
        x.fill();
      }
      // Anillo de agentes.
      giro += dt * 0.04;
      // El anillo de agentes cabe con sus nombres dentro del área del cerebro (sin chocar con las tarjetas ni cortarse).
      const ra = Math.min(centro.r * 1.42, centro.lim);
      x.strokeStyle = 'rgba(255,255,255,0.09)';
      x.beginPath();
      x.ellipse(centro.x, centro.y, ra, ra * 0.92, 0, 0, Math.PI * 2);
      x.stroke();
      x.font = '9px "JetBrains Mono", monospace';
      x.textAlign = 'center';
      d.agentes.forEach((a, i) => {
        const f = (i / d.agentes.length) * Math.PI * 2 - Math.PI / 2 + giro;
        const px = centro.x + Math.cos(f) * ra;
        const py = centro.y + Math.sin(f) * ra * 0.92;
        x.beginPath();
        x.arc(px, py, a.activo ? 3.5 : 3, 0, Math.PI * 2);
        x.fillStyle = a.activo ? '#fff' : '#000';
        x.strokeStyle = a.activo ? '#fff' : 'rgba(255,255,255,0.35)';
        if (a.activo) {
          x.shadowColor = '#fff';
          x.shadowBlur = 10;
        }
        x.fill();
        x.stroke();
        x.shadowBlur = 0;
        x.fillStyle = a.activo ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)';
        x.fillText(a.nombre.toUpperCase(), px, py - 9);
      });
    };

    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(escena);
    // Las tarjetas cambian de alto al llegar los datos: se vuelven a medir de vez en cuando.
    const otraVez = setInterval(medir, 2_000);
    cuadro = requestAnimationFrame(dibujar);
    return () => {
      cancelAnimationFrame(cuadro);
      clearInterval(otraVez);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="hilos" aria-hidden />;
}
