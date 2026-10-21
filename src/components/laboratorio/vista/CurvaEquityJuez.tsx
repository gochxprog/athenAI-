// Curva de equity (estilo de la antigua pantalla) con datos REALES del Juez: In-Sample (entrenamiento, la variante
// que eligió el Walk-Forward con ese tramo) y Out-of-Sample (validación del Juez), operación por operación, con su
// drawdown debajo.
import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import useProgreso from '@/hooks/useProgreso';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { conSigno, num } from '@/lib/format';

const W = 1000;
const H = 260;
const H_DD = 70;
const pct = (v: number, d = 1) => conSigno(v * 100, d, '%');

/** Capital (empieza en 1) multiplicando las operaciones. */
function acumular(desde: number, rets: number[]) {
  const s = [desde];
  for (const x of rets) s.push(s[s.length - 1] * (1 + x));
  return s;
}

function drawdown(serie: number[]) {
  let pico = serie[0];
  return serie.map((v) => {
    pico = Math.max(pico, v);
    return v / pico - 1;
  });
}

export default function CurvaEquityJuez({ r }: { r: RespuestaLaboratorio }) {
  const id = useId().replace(/:/g, '');
  const j = r.resultado;
  const clave = `${r.hasta}-${j.ensayos}`;
  const t = useProgreso(2200, clave);
  const sim = useMemo(() => {
    const is = acumular(1, j.retornosIs ?? []);
    const oos = acumular(is[is.length - 1], (r.operaciones ?? []).map((o) => o.retorno));
    return { is, oos };
  }, [j.retornosIs, r.operaciones]);
  const total = Math.max(1, sim.is.length + sim.oos.length - 2);
  const corte = sim.is.length - 1;
  const completa = useMemo(() => [...sim.is, ...sim.oos.slice(1)], [sim]);
  const dd = useMemo(() => drawdown(completa), [completa]);

  if (completa.length < 2) return <p className="text-xs text-plata-400">Todavía no hay operaciones: deja grabando el mercado y vuelve a probar.</p>;

  const min = Math.min(...completa) * 0.995;
  const max = Math.max(...completa) * 1.005;
  const minDD = Math.min(...dd, -0.01) * 1.1;
  const x = (i: number) => (i / total) * W;
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
  const yDD = (v: number) => (v / minDD) * H_DD;
  const camino = (arr: number[], desde: number) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(desde + i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  // Punto que recorre la curva mientras se dibuja.
  const idx = Math.min(total, Math.floor(t * total));
  const ret = (a: number[]) => a[a.length - 1] / a[0] - 1;
  const peorDD = Math.min(...dd);
  const nIs = sim.is.length - 1;
  const nOos = sim.oos.length - 1;

  return (
    <div data-curva-equity>
      <div className="relative h-[260px] pl-14">
        {ticks.map((v) => (
          <span key={v} className="cifra absolute left-0 -translate-y-1/2 text-[9.5px] text-plata-500" style={{ top: `${(1 - (v - min) / (max - min || 1)) * 100}%` }}>
            {pct(v - 1, 1)}
          </span>
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <clipPath id={`${id}-c`}>
              <rect x={0} y={-10} height={H + 20} width={W * t} />
            </clipPath>
            <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
          <rect x={x(corte)} y={0} width={W - x(corte)} height={H} fill="rgba(255,255,255,0.025)" />
          <g clipPath={`url(#${id}-c)`}>
            <path d={`${camino(sim.oos, corte)}L${W},${H}L${x(corte)},${H}Z`} fill={`url(#${id}-g)`} />
            <path d={camino(sim.is, 0)} fill="none" stroke="#B8BBC2" strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
            <path d={camino(sim.oos, corte)} fill="none" stroke="#FFFFFF" strokeWidth={1.9} vectorEffect="non-scaling-stroke" />
          </g>
          <line x1={x(corte)} x2={x(corte)} y1={0} y2={H} stroke="#fff" strokeOpacity={0.6} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
        {t < 1 && (
          <span
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
            style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${x(idx) / W})`, top: `${(y(completa[idx]) / H) * 100}%` }}
          />
        )}
        <span className="absolute top-1 -translate-x-full pr-2 text-[9.5px] uppercase tracking-[0.14em] text-plata-400" style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${x(corte) / W})` }}>
          In-Sample
        </span>
        <span className="absolute top-1 pl-2 text-[9.5px] uppercase tracking-[0.14em] text-white" style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${x(corte) / W})` }}>
          Out-of-Sample · Juez
        </span>
      </div>

      {/* Drawdown */}
      <div className="relative mt-3 h-[70px] pl-14">
        <span className="cifra absolute left-0 top-0 text-[9.5px] text-plata-500">0%</span>
        <span className="cifra absolute bottom-0 left-0 text-[9.5px] text-plata-500">{num(minDD * 100, 0)}%</span>
        <svg viewBox={`0 0 ${W} ${H_DD}`} preserveAspectRatio="none" className="h-full w-full">
          <motion.path
            key={clave}
            d={`M0,0${dd.map((v, i) => `L${x(i).toFixed(1)},${yDD(v).toFixed(1)}`).join('')}L${W},0Z`}
            fill="rgba(255,255,255,0.1)"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.6 }}
          />
          <line x1={x(corte)} x2={x(corte)} y1={0} y2={H_DD} stroke="#fff" strokeOpacity={0.4} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute right-0 top-1 text-[9.5px] uppercase tracking-[0.14em] text-plata-500">Drawdown</span>
      </div>

      <div className="mt-2 flex justify-between pl-14 font-mono text-[9.5px] text-plata-500">
        <span>Operación 1</span>
        <span>Corte · operación {nIs}</span>
        <span>Operación {nIs + nOos}</span>
      </div>
      {nOos < j.oos.operaciones && <p className="mt-1 pl-14 text-[10px] text-plata-500">Se dibujan las últimas {num(nOos)} de {num(j.oos.operaciones)} operaciones fuera de muestra (las que guarda el paper).</p>}
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-borde-suave pt-3 sm:grid-cols-4">
        <Dato k="Retorno In-Sample" v={nIs ? pct(ret(sim.is)) : '—'} />
        <Dato k="Retorno Out-of-Sample" v={pct(j.oos.retornoTotal)} />
        <Dato k="Peor drawdown" v={pct(peorDD)} />
        <Dato k="Operaciones IS / OOS" v={`${num(nIs)} / ${num(j.oos.operaciones)}`} />
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
