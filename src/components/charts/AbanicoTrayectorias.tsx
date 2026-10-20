import { useMemo, useRef, useState } from 'react';
import { conSigno, num } from '@/lib/format';

export interface DatosAbanico {
  caminos: number[][];
  bandas?: { p5: number[]; p50: number[]; p95: number[] };
}

const W = 1000;
const H = 280;

function metricasCamino(c: number[]) {
  let pico = -Infinity;
  let peor = 0;
  for (const v of c) {
    if (v > pico) pico = v;
    peor = Math.min(peor, v / pico - 1);
  }
  return { final: c[c.length - 1] - 1, maximo: Math.max(...c) - 1, minimo: Math.min(...c) - 1, peorCaida: peor };
}

/**
 * Abanico de trayectorias (Monte Carlo). Al pasar el ratón o el dedo, se resalta la trayectoria más cercana
 * y aparece su cartel con sus métricas.
 */
export default function AbanicoTrayectorias({ datos, opacidad = 0.09, alto = H }: { datos: DatosAbanico; opacidad?: number; alto?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ i: number; px: number; py: number } | null>(null);
  const { caminos, bandas } = datos;
  const pasos = caminos[0]?.length ?? 0;

  const escala = useMemo(() => {
    const todos = [...caminos.flat(), ...(bandas ? [...bandas.p5, ...bandas.p95] : [])];
    return { min: Math.min(...todos, 1), max: Math.max(...todos, 1) };
  }, [caminos, bandas]);
  const metricas = useMemo(() => caminos.map(metricasCamino), [caminos]);
  if (pasos < 2) return null;

  const x = (i: number) => (i / (pasos - 1)) * W;
  const y = (v: number) => alto - 6 - ((v - escala.min) / (escala.max - escala.min || 1)) * (alto - 12);
  const linea = (c: number[]) => c.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const mover = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const fx = (e.clientX - r.left) / r.width;
    const fy = ((e.clientY - r.top) / r.height) * alto;
    const k = Math.max(0, Math.min(pasos - 1, Math.round(fx * (pasos - 1))));
    let mejor = 0;
    let d = Infinity;
    caminos.forEach((c, i) => {
      const dd = Math.abs(y(c[k]) - fy);
      if (dd < d) {
        d = dd;
        mejor = i;
      }
    });
    setSel({ i: mejor, px: e.clientX - r.left, py: e.clientY - r.top });
  };

  const m = sel ? metricas[sel.i] : null;
  const ancho = ref.current?.clientWidth ?? 0;

  return (
    <div ref={ref} className="relative touch-none select-none" style={{ height: alto }} onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setSel(null)} data-abanico>
      <svg viewBox={`0 0 ${W} ${alto}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
        {caminos.map((c, i) => (
          <path key={i} d={linea(c)} fill="none" stroke="#fff" strokeOpacity={sel ? (sel.i === i ? 0 : opacidad * 0.6) : opacidad} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {bandas && (
          <>
            <path d={linea(bandas.p95)} fill="none" stroke="rgba(255,255,255,0.55)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            <path d={linea(bandas.p5)} fill="none" stroke="rgba(255,255,255,0.55)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            <path d={linea(bandas.p50)} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {sel && <path d={linea(caminos[sel.i])} fill="none" stroke="#fff" strokeWidth={2.2} vectorEffect="non-scaling-stroke" />}
      </svg>
      {bandas && !sel && (
        <div className="pointer-events-none absolute right-1 top-0 space-y-0.5 text-right font-mono text-[9.5px] text-plata-400">
          <p>P95 (discontinua)</p>
          <p className="text-white">P50</p>
          <p>P5 (discontinua)</p>
        </div>
      )}
      {sel && m && (
        <div
          className="pointer-events-none absolute z-10 w-48 rounded-lg border border-plata-400 bg-black/90 p-2.5 text-[10.5px] shadow-lg backdrop-blur"
          style={{ left: Math.min(Math.max(sel.px + 12, 0), Math.max(0, ancho - 200)), top: Math.max(0, sel.py - 90) }}
          data-cartel
        >
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-plata-400">Trayectoria {sel.i + 1}</p>
          {[
            ['Resultado final', conSigno(m.final * 100, 1, '%')],
            ['Peor caída', conSigno(m.peorCaida * 100, 1, '%')],
            ['Máximo alcanzado', conSigno(m.maximo * 100, 1, '%')],
            ['Mínimo', conSigno(m.minimo * 100, 1, '%')],
          ].map(([k, v]) => (
            <p key={k} className="flex justify-between gap-2">
              <span className="text-plata-400">{k}</span>
              <span className="cifra text-white">{v}</span>
            </p>
          ))}
          <p className="mt-1 text-[9.5px] text-plata-500">{num(pasos - 1)} pasos · una de {num(caminos.length)} mostradas</p>
        </div>
      )}
    </div>
  );
}
