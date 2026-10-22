// Monte Carlo (v2): las trayectorias que calculó el Juez salen disparadas una tras otra con una chispa en la punta,
// coloreadas por dónde terminan (arriba fucsia/morado, abajo verde). Luego las bandas P5/P50/P95 en blanco y, a la
// derecha, la distribución del resultado final. Canvas 2D: solo anima lo ya calculado, no simula nada aquí.
import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ResultadoMc } from '@/motores/juez/monteCarlo';

const pct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: d })} %`;
// Paleta por posición final (0 = la peor, 1 = la mejor): verde abajo, morado arriba y fucsia en lo más alto.
const TONOS: [number, [number, number, number]][] = [[0, [34, 227, 154]], [0.5, [52, 211, 153]], [0.5001, [139, 92, 246]], [0.8, [192, 70, 255]], [1, [255, 62, 200]]];
function tono(t: number, a = 1) {
  const i = Math.max(1, TONOS.findIndex(([p]) => p >= t));
  const [[p0, c0], [p1, c1]] = [TONOS[i - 1], TONOS[i]];
  const k = (t - p0) / (p1 - p0 || 1);
  return `rgba(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k)).join(',')},${a})`;
}
const ease = (x: number) => 1 - (1 - x) ** 3;
const DURA = 900; // ms que tarda cada trayectoria en recorrerse
const PASO = 28; // ms entre una salida y la siguiente
const BINS = 28;

export default function MonteCarlo({ mc }: { mc: ResultadoMc }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [corrida, setCorrida] = useState(0);
  const [foco, setFoco] = useState<number | null>(null);
  const [fin, setFin] = useState(false);
  // Tras la animación, tocar una línea solo redibuja (no la repite).
  const hecho = useRef(false);
  useEffect(() => void (hecho.current = false), [mc, corrida]);

  // Retornos (fracción) de cada camino y de las bandas; rango y color de cada camino por su posición final.
  const d = useMemo(() => {
    // Las curvas vienen como capital relativo al de partida (empiezan en su primer valor): se pasan a retorno.
    const base = mc.bandas.p50[0] || 1;
    const r = (c: number[]) => c.map((v) => v / base - 1);
    const caminos = mc.caminos.map(r);
    const bandas = { p5: r(mc.bandas.p5), p50: r(mc.bandas.p50), p95: r(mc.bandas.p95) };
    const finales = caminos.map((c) => c.at(-1)!);
    const orden = [...finales].sort((a, b) => a - b);
    const todos = [...caminos.flat(), ...bandas.p5, ...bandas.p95, 0];
    const [lo, hi] = [Math.min(...todos), Math.max(...todos)];
    const dd = caminos.map((c) => c.reduce((m, v, i) => Math.max(m, 1 - (1 + v) / (1 + Math.max(...c.slice(0, i + 1)))), 0));
    return { caminos, bandas, lo, hi, dd, rango: finales.map((f) => orden.indexOf(f) / Math.max(1, orden.length - 1)) };
  }, [mc]);

  const hist = useMemo(() => {
    const m = mc.muestras;
    const [lo, hi] = [Math.min(...m), Math.max(...m)];
    const c = new Array(BINS).fill(0);
    m.forEach((v) => (c[Math.min(BINS - 1, Math.floor(((v - lo) / (hi - lo || 1)) * BINS))] += 1));
    return { c, lo, hi, max: Math.max(...c, 1), perdida: m.filter((v) => v < 0).length / (m.length || 1) };
  }, [mc]);

  useEffect(() => {
    const cv = lienzo.current!;
    const ctx = cv.getContext('2d')!;
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    const total = (d.caminos.length - 1) * PASO + DURA + 700;
    let raf = 0;
    const dibujar = (ahora: number) => {
      const t = quieto || hecho.current ? total : ahora - t0;
      const dpr = Math.min(2, devicePixelRatio);
      const [w, h] = [cv.clientWidth, cv.clientHeight];
      if (cv.width !== w * dpr) [cv.width, cv.height] = [w * dpr, h * dpr];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const pasos = d.caminos[0].length;
      const x = (i: number) => 6 + (i / (pasos - 1)) * (w - 12);
      const y = (v: number) => 10 + (1 - (v - d.lo) / (d.hi - d.lo || 1)) * (h - 20);
      const linea = (c: number[], hasta = c.length - 1) => {
        ctx.beginPath();
        for (let i = 0; i <= hasta; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, x(i), y(c[i]));
      };
      // Cero: lo que separa ganar de perder.
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      linea(new Array(pasos).fill(0));
      ctx.stroke();
      ctx.setLineDash([]);
      // Trayectorias: brillo aditivo, la recién salida más intensa; la enfocada resalta y las demás se apagan.
      ctx.globalCompositeOperation = 'lighter';
      d.caminos.forEach((c, k) => {
        const p = Math.min(1, Math.max(0, (t - k * PASO) / DURA));
        if (!p) return;
        const hasta = Math.max(1, Math.round(ease(p) * (pasos - 1)));
        const a = foco === null ? 0.28 + (1 - p) * 0.5 : foco === k ? 1 : 0.07;
        ctx.strokeStyle = tono(d.rango[k], a);
        ctx.lineWidth = foco === k ? 2.2 : 1.1;
        linea(c, hasta);
        ctx.stroke();
        if (p < 1) {
          // Chispa en la punta mientras corre.
          ctx.fillStyle = tono(d.rango[k], 1);
          ctx.shadowColor = tono(d.rango[k], 1);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(x(hasta), y(c[hasta]), 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });
      ctx.globalCompositeOperation = 'source-over';
      // Bandas P5 / P50 / P95 cuando ya salió todo.
      const b = Math.min(1, Math.max(0, (t - total + 700) / 600));
      if (b > 0) {
        ctx.globalAlpha = b;
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        linea(d.bandas.p95);
        for (let i = pasos - 1; i >= 0; i--) ctx.lineTo(x(i), y(d.bandas.p5[i]));
        ctx.fill();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,.7)';
        ctx.lineWidth = 1;
        [d.bandas.p95, d.bandas.p5].forEach((s) => (linea(s), ctx.stroke()));
        ctx.setLineDash([]);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        linea(d.bandas.p50);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (t < total) raf = requestAnimationFrame(dibujar);
      else {
        hecho.current = true;
        setFin(true);
      }
    };
    if (!hecho.current) setFin(false);
    raf = requestAnimationFrame(dibujar);
    return () => cancelAnimationFrame(raf);
  }, [d, corrida, foco]);

  // Tocar o pasar el ratón: la trayectoria más cercana en vertical a ese punto.
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!fin) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - 6) / (r.width - 12)) * (d.caminos[0].length - 1));
    const v = d.lo + (1 - (e.clientY - r.top - 10) / (r.height - 20)) * (d.hi - d.lo);
    let mejor = null as number | null;
    d.caminos.forEach((c, k) => (mejor === null || Math.abs(c[i] - v) < Math.abs(d.caminos[mejor][i] - v)) && (mejor = k));
    setFoco(mejor);
  };

  const n = d.caminos.length;
  return (
    <div className="mc-v2">
      <div className="mc-cab">
        <span className="mono">{mc.simulaciones.toLocaleString('es-ES')} simulaciones ({mc.metodo === 'bootstrap' ? 'bootstrap' : 'reordenando'}) de {mc.operaciones} operaciones fuera de muestra · se dibujan {n}</span>
        <button className="boton" onClick={() => (setFoco(null), setCorrida((c) => c + 1))}><RotateCcw size={12} /> Repetir</button>
      </div>
      <div className="mc-cuerpo">
        <div className="mc-lienzo">
          <canvas ref={lienzo} onPointerMove={mover} onPointerLeave={() => setFoco(null)} />
          {foco !== null && (
            <div className="mc-cartel mono">
              Trayectoria {foco + 1} · termina <b style={{ color: tono(d.rango[foco]) }}>{pct(d.caminos[foco].at(-1)!)}</b> · peor caída {pct(-d.dd[foco])}
            </div>
          )}
          <div className="mc-ley mono"><i style={{ background: tono(1) }} /> mejores <i style={{ background: tono(0.65) }} /> sobre la mediana <i style={{ background: tono(0.2) }} /> bajo la mediana <i className="blanca" /> P5 · P50 · P95</div>
        </div>
        <div className="mc-dist">
          <span className="et">Resultado final</span>
          <small className="mono">{pct(hist.hi, 0)}</small>
          <div className="mc-barras">
            {hist.c.map((c, i) => {
              const v = hist.lo + ((i + 0.5) / BINS) * (hist.hi - hist.lo);
              const t = Math.min(1, Math.max(0, (v - mc.p5) / (mc.p95 - mc.p5 || 1)));
              return <i key={`${corrida}-${i}`} style={{ width: `${(c / hist.max) * 100}%`, background: v < 0 ? 'transparent' : tono(t, 0.85), borderColor: tono(t), animationDelay: `${0.4 + (BINS - i) * 0.04}s` }} />;
            })}
          </div>
          <small className="mono">{pct(hist.lo, 0)}</small>
        </div>
      </div>
      <div className="datos">
        {([['P5 final', pct(mc.p5)], ['P50 final', pct(mc.p50)], ['P95 final', pct(mc.p95)], ['Prob. de pérdida', pct(hist.perdida).replace('+', '')], ['Caída P95', pct(-mc.ddP95)], ['Prob. de ruina', pct(mc.probRuina).replace('+', '')]] as const).map(([k, v]) => (
          <div key={k} className="dato"><span className="et">{k}</span><b className="cifra">{v}</b></div>
        ))}
      </div>
    </div>
  );
}
