// Monte Carlo (estilo de la antigua pantalla) con el resultado REAL del Juez: las trayectorias que calculó el motor
// se dibujan poco a poco, luego sus bandas P5 / P50 / P95, y a la derecha se llena la distribución del resultado
// final. Solo es la animación de lo ya calculado: no se simula nada aquí.
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import useProgreso from '@/hooks/useProgreso';
import AbanicoTrayectorias from '@/components/charts/AbanicoTrayectorias';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { conSigno, num } from '@/lib/format';

const W = 1000;
const H = 280;
const BINS = 28;
const pct = (v: number, d = 1) => conSigno(v * 100, d, '%');
/** Orden de aparición repartido (determinista): el histograma se llena por todos lados a la vez. */
const repartido = (n: number) => Array.from({ length: n }, (_, k) => (k * 7919) % n);

export default function MonteCarloJuez({ r }: { r: RespuestaLaboratorio }) {
  const mc = r.resultado.monteCarlo;
  const [corrida, setCorrida] = useState(0);
  const t = useProgreso(4200, `${r.hasta}-${corrida}`);

  const datos = useMemo(() => {
    if (!mc || !mc.caminos.length) return null;
    const todos = [...mc.caminos.flat(), ...mc.bandas.p5, ...mc.bandas.p95];
    const fin = mc.muestras;
    const minF = Math.min(...fin);
    const maxF = Math.max(...fin);
    const orden = repartido(fin.length);
    const bin = orden.map((i) => Math.min(BINS - 1, Math.floor(((fin[i] - minF) / (maxF - minF || 1)) * BINS)));
    return { min: Math.min(...todos), max: Math.max(...todos), minF, maxF, bin, perdida: fin.filter((x) => x < 0).length / (fin.length || 1) };
  }, [mc]);

  const n = datos ? Math.floor(t * datos.bin.length) : 0;
  const conteo = useMemo(() => {
    const c = new Array(BINS).fill(0);
    if (datos) for (let i = 0; i < n; i += 1) c[datos.bin[i]] += 1;
    return c;
  }, [n, datos]);

  if (!mc || !datos) return <p className="text-xs text-plata-400">Hacen falta al menos 5 operaciones fuera de muestra para el Monte Carlo.</p>;

  const pasos = mc.caminos[0].length;
  const visibles = Math.ceil(t * mc.caminos.length);
  const terminado = t >= 1;
  const x = (i: number) => (i / Math.max(1, pasos - 1)) * W;
  const y = (v: number) => H - ((v - datos.min) / (datos.max - datos.min || 1)) * H;
  const camino = (c: number[]) => c.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const banda = (sup: number[], inf: number[]) => `${camino(sup)}${[...inf].reverse().map((v, i) => `L${x(inf.length - 1 - i).toFixed(1)},${y(v).toFixed(1)}`).join('')}Z`;
  const maxConteo = Math.max(...conteo, 1);
  const binCero = Math.floor(((0 - datos.minF) / (datos.maxF - datos.minF || 1)) * BINS);

  return (
    <div data-mc-animado>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="cifra text-[11px] text-plata-400">
          {num(mc.simulaciones)} simulaciones ({mc.metodo === 'bootstrap' ? 'bootstrap' : 'reordenando'}) de {num(mc.operaciones)} operaciones fuera de muestra · se dibujan {mc.caminos.length} de ejemplo
        </p>
        <button onClick={() => setCorrida((c) => c + 1)} className="flex items-center gap-1.5 rounded-md border border-borde px-2.5 py-1.5 text-[11px] text-plata-200 transition-colors hover:border-plata-400 hover:text-white">
          <RotateCcw size={12} /> Repetir animación
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        {terminado ? (
          <div>
            <AbanicoTrayectorias datos={{ caminos: mc.caminos, bandas: mc.bandas }} opacidad={0.07} alto={H} />
            <p className="mt-1 text-[10px] text-plata-500">Toca o pasa el ratón por una línea para ver sus métricas.</p>
          </div>
        ) : (
        <div className="relative h-[280px]">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
              <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
              {mc.caminos.slice(0, visibles).map((c, i) => (
                <motion.path key={`${corrida}-${i}`} d={camino(c)} fill="none" stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke" initial={{ strokeOpacity: 0.7 }} animate={{ strokeOpacity: 0.1 }} transition={{ duration: 1.2 }} />
              ))}
              <AnimatePresence>
                {terminado && (
                  <motion.g key={`bandas-${corrida}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
                    <path d={banda(mc.bandas.p95, mc.bandas.p5)} fill="rgba(255,255,255,0.07)" />
                    <path d={camino(mc.bandas.p95)} fill="none" stroke="rgba(255,255,255,0.6)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                    <path d={camino(mc.bandas.p5)} fill="none" stroke="rgba(255,255,255,0.6)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                    <path d={camino(mc.bandas.p50)} fill="none" stroke="#fff" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
                  </motion.g>
                )}
              </AnimatePresence>
            </svg>
            {terminado && (
              <div className="pointer-events-none absolute right-1 top-0 space-y-0.5 text-right font-mono text-[9.5px] text-plata-300">
                <p>P95</p>
                <p className="text-white">P50</p>
                <p>P5</p>
              </div>
            )}
          </div>
        )}

        <div>
          <p className="etiqueta mb-1">Resultado final · distribución</p>
          <p className="cifra mb-1 text-[9.5px] text-plata-500">{pct(datos.maxF, 0)}</p>
          <div className="flex h-[220px] flex-col-reverse gap-[2px]">
            {conteo.map((c, i) => (
              <div key={i} className="flex h-full items-center">
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
        <Dato k="P5 final" v={terminado ? pct(mc.p5) : '…'} />
        <Dato k="P50 final" v={terminado ? pct(mc.p50) : '…'} />
        <Dato k="P95 final" v={terminado ? pct(mc.p95) : '…'} />
        <Dato k="Prob. de pérdida" v={terminado ? pct(datos.perdida).replace('+', '') : '…'} />
        <Dato k="Drawdown P95" v={terminado ? pct(-mc.ddP95) : '…'} />
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
