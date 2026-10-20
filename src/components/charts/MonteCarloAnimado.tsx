import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import { crearAleatorio, percentil } from '@/lib/random';
import { drawdown, type SimulacionEstrategia } from '@/lib/backtest';
import useProgreso from '@/hooks/useProgreso';
import { num, pct } from '@/lib/format';

const TOTAL = 2000;
const VISIBLES = 140;
const W = 1000;
const H = 280;
const BINS = 28;
const DURACION = 4200;

/**
 * Monte Carlo por remuestreo (bootstrap) de las operaciones Out-of-Sample:
 * se reordenan y remuestrean los trades reales para ver el abanico de resultados posibles.
 */
export default function MonteCarloAnimado({ sim, clave }: { sim: SimulacionEstrategia; clave: string }) {
  const [corrida, setCorrida] = useState(0);
  const t = useProgreso(DURACION, `${clave}-${corrida}`);

  const datos = useMemo(() => {
    const rand = crearAleatorio(4049 + corrida * 977 + sim.retornosOOS.length);
    const r = sim.retornosOOS;
    const pasos = r.length + 1;
    const caminos: number[][] = [];
    const finales: number[] = [];
    const peoresDD: number[] = [];
    for (let p = 0; p < TOTAL; p++) {
      const c = [1];
      for (let i = 0; i < r.length; i++) c.push(c[i] * (1 + r[Math.floor(rand() * r.length)]));
      if (p < VISIBLES) caminos.push(c);
      finales.push(c[c.length - 1] - 1);
      peoresDD.push(Math.min(...drawdown(c)));
    }
    const bandas = { p5: [] as number[], p50: [] as number[], p95: [] as number[], p10: [] as number[], p90: [] as number[] };
    for (let i = 0; i < pasos; i++) {
      const col = caminos.map((c) => c[i]).sort((a, b) => a - b);
      bandas.p5.push(percentil(col, 0.05));
      bandas.p10.push(percentil(col, 0.1));
      bandas.p50.push(percentil(col, 0.5));
      bandas.p90.push(percentil(col, 0.9));
      bandas.p95.push(percentil(col, 0.95));
    }
    const ordenados = [...finales].sort((a, b) => a - b);
    const minF = ordenados[0];
    const maxF = ordenados[ordenados.length - 1];
    const bin = finales.map((f) => Math.min(BINS - 1, Math.floor(((f - minF) / (maxF - minF || 1)) * BINS)));
    const todos = caminos.flat();
    return {
      caminos,
      bandas,
      pasos,
      finales,
      bin,
      minF,
      maxF,
      min: Math.min(...todos, ...bandas.p5),
      max: Math.max(...todos, ...bandas.p95),
      p5: percentil(ordenados, 0.05),
      p50: percentil(ordenados, 0.5),
      p95: percentil(ordenados, 0.95),
      perdida: finales.filter((f) => f < 0).length / TOTAL,
      ddP95: percentil([...peoresDD].sort((a, b) => a - b), 0.05),
    };
  }, [sim, corrida]);

  const n = Math.floor(t * TOTAL);
  const visibles = Math.ceil(t * VISIBLES);
  const terminado = t >= 1;
  const x = (i: number) => (i / (datos.pasos - 1)) * W;
  const y = (v: number) => H - ((v - datos.min) / (datos.max - datos.min)) * H;
  const camino = (c: number[]) => c.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const banda = (sup: number[], inf: number[]) => `${camino(sup)}${[...inf].reverse().map((v, i) => `L${x(inf.length - 1 - i).toFixed(1)},${y(v).toFixed(1)}`).join('')}Z`;

  // Histograma de resultados finales, construido con las primeras n trayectorias.
  const conteo = useMemo(() => {
    const c = new Array(BINS).fill(0);
    for (let i = 0; i < n; i++) c[datos.bin[i]] += 1;
    return c;
  }, [n, datos]);
  const maxConteo = Math.max(...conteo, 1);
  const binCero = Math.floor(((0 - datos.minF) / (datos.maxF - datos.minF || 1)) * BINS);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="cifra text-[11px] text-plata-400">
          Trayectorias simuladas <span className="text-white">{num(n)}</span> / {num(TOTAL)} · remuestreo de {sim.retornosOOS.length} operaciones Out-of-Sample
        </p>
        <button onClick={() => setCorrida((c) => c + 1)} className="flex items-center gap-1.5 rounded-md border border-borde px-2.5 py-1.5 text-[11px] text-plata-200 transition-colors hover:border-plata-400 hover:text-white">
          <RotateCcw size={12} /> Repetir simulación
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="relative h-[280px]">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
            {datos.caminos.slice(0, visibles).map((c, i) => (
              <motion.path key={`${corrida}-${i}`} d={camino(c)} fill="none" stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" initial={{ strokeOpacity: 0.7 }} animate={{ strokeOpacity: 0.07 }} transition={{ duration: 1.2 }} />
            ))}
            <AnimatePresence>
              {terminado && (
                <motion.g key={`bandas-${corrida}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
                  <path d={banda(datos.bandas.p95, datos.bandas.p5)} fill="rgba(255,255,255,0.06)" />
                  <path d={banda(datos.bandas.p90, datos.bandas.p10)} fill="rgba(255,255,255,0.08)" />
                  <path d={camino(datos.bandas.p95)} fill="none" stroke="rgba(255,255,255,0.6)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                  <path d={camino(datos.bandas.p5)} fill="none" stroke="rgba(255,255,255,0.6)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                  <path d={camino(datos.bandas.p90)} fill="none" stroke="rgba(255,255,255,0.35)" vectorEffect="non-scaling-stroke" />
                  <path d={camino(datos.bandas.p10)} fill="none" stroke="rgba(255,255,255,0.35)" vectorEffect="non-scaling-stroke" />
                  <path d={camino(datos.bandas.p50)} fill="none" stroke="#fff" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
                </motion.g>
              )}
            </AnimatePresence>
          </svg>
          {terminado && (
            <div className="pointer-events-none absolute right-1 top-0 space-y-0.5 text-right font-mono text-[9.5px] text-plata-300">
              <p>P95 · P90</p>
              <p className="text-white">P50</p>
              <p>P10 · P5</p>
            </div>
          )}
        </div>

        {/* Distribución del resultado final */}
        <div>
          <p className="etiqueta mb-1">Resultado final · distribución</p>
          <p className="cifra mb-1 text-[9.5px] text-plata-500">{pct(datos.maxF, 0)}</p>
          <div className="flex h-[220px] flex-col-reverse gap-[2px]">
            {conteo.map((c, i) => (
              <div key={i} className="flex h-full items-center gap-2">
                <div className="h-full flex-1">
                  <div className={`h-full rounded-r-sm transition-[width] duration-150 ${i < binCero ? 'border border-plata-500' : 'bg-plata-200'}`} style={{ width: `${(c / maxConteo) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="cifra mt-1 text-[9.5px] text-plata-500">{pct(datos.minF, 0)}</p>
          <p className="mt-1 text-[10px] text-plata-500">Huecas: trayectorias que terminan en pérdida</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-borde-suave pt-3 sm:grid-cols-5">
        <Dato k="P5 final" v={terminado ? pct(datos.p5, 1) : '…'} />
        <Dato k="P50 final" v={terminado ? pct(datos.p50, 1) : '…'} />
        <Dato k="P95 final" v={terminado ? pct(datos.p95, 1) : '…'} />
        <Dato k="Prob. de pérdida" v={terminado ? pct(datos.perdida, 1) : '…'} />
        <Dato k="Drawdown P95" v={terminado ? pct(datos.ddP95, 1) : '…'} />
      </div>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="etiqueta">{k}</p>
      <p className="cifra mt-1 text-sm text-white">{v}</p>
    </div>
  );
}
