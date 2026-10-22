// Gráficos del Juez: uPlot (canvas, ~45 KB, miles de puntos sin trabarse) para curvas y SVG para lo pequeño.
import { useEffect, useRef } from 'react';
import uPlot, { type AlignedData, type Options } from 'uplot';
import 'uplot/dist/uPlot.min.css';

const EJE = { stroke: '#8e929a', grid: { stroke: '#1f1f24', width: 1 }, ticks: { stroke: '#2c2c33', width: 1 }, font: '10px JetBrains Mono, monospace' };
const pct = (v: number, d = 1) => `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: d })} %`;

/** Contenedor de uPlot que se ajusta al ancho de su caja. */
export function Curvas({ datos, series, alto = 240, x = 'tiempo' }: { datos: AlignedData; series: Options['series']; alto?: number; x?: 'tiempo' | 'paso' }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = caja.current!;
    const u = new uPlot(
      {
        width: el.clientWidth,
        height: alto,
        legend: { show: false },
        cursor: { points: { show: false }, drag: { x: true, y: false } },
        scales: { x: { time: x === 'tiempo' } },
        axes: [{ ...EJE }, { ...EJE, size: 56, values: (_, v) => v.map((n) => pct(n - 1, 0)) }],
        series,
      },
      datos,
      el,
    );
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: alto }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [datos, series, alto, x]);
  return <div ref={caja} className="curvas" />;
}

/** Anillo de puntuación 0–100. */
export function Anillo({ valor, texto }: { valor: number | null; texto: string }) {
  const r = 44;
  const largo = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 110 110" className="anillo">
      <circle cx="55" cy="55" r={r} className="fondo" />
      <circle cx="55" cy="55" r={r} className="lleno" strokeDasharray={largo} strokeDashoffset={largo * (1 - (valor ?? 0) / 100)} />
      <text x="55" y="54" className="cifra">{valor === null ? '—' : Math.round(valor)}</text>
      <text x="55" y="72" className="sub">{texto}</text>
    </svg>
  );
}

/** Histograma (SVG) de una muestra con una línea en el valor real. */
export function Histograma({ muestra, real, formato = (v: number) => v.toFixed(2) }: { muestra: number[]; real: number; formato?: (v: number) => string }) {
  if (!muestra.length) return null;
  const [lo, hi] = [Math.min(...muestra, real), Math.max(...muestra, real)];
  const n = 32;
  const ancho = (hi - lo) / n || 1;
  const cubos = Array.from({ length: n }, (_, i) => muestra.filter((v) => Math.min(n - 1, Math.floor((v - lo) / ancho)) === i).length);
  const max = Math.max(...cubos, 1);
  const xr = ((real - lo) / (hi - lo || 1)) * 100;
  return (
    <div className="histograma">
      <svg viewBox="0 0 100 44" preserveAspectRatio="none">
        {cubos.map((c, i) => <rect key={i} x={(i / n) * 100 + 0.2} width={100 / n - 0.4} y={40 - (c / max) * 36} height={(c / max) * 36} />)}
        <line x1={xr} x2={xr} y1="0" y2="40" className="real" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* La etiqueta va fuera del SVG estirado para que la letra no se deforme. */}
      <span className="eti mono" style={xr > 70 ? { right: `${100 - xr + 1}%` } : { left: `${xr + 1}%` }}>tu estrategia · {formato(real)}</span>
    </div>
  );
}

/** Barras por ventana del Walk-Forward: rendimiento fuera de muestra (anualizado) de cada tramo, con su cifra. */
export function BarrasWf({ valores }: { valores: number[] }) {
  const max = Math.max(...valores.map(Math.abs), 1e-9);
  return (
    <div className="barras-wf">
      {valores.map((v, i) => (
        <div key={i} className="col-wf">
          <span className="cifra">{pct(v, 0)}</span>
          <div className="pista"><i className={v >= 0 ? 'pos' : 'neg'} style={{ height: `${(Math.abs(v) / max) * 100}%` }} /></div>
          <small>V{i + 1}</small>
        </div>
      ))}
    </div>
  );
}
