// Curva de equity (estilo de la antigua pantalla) con datos REALES del Juez: zona de entrenamiento (In-Sample, solo
// elige parámetros) a la izquierda y la curva fuera de muestra (Out-of-Sample · Juez) dibujándose, con su drawdown.
import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import useProgreso from '@/hooks/useProgreso';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { conSigno, num } from '@/lib/format';

const W = 1000;
const H = 260;
const H_DD = 70;
const pct = (v: number, d = 1) => conSigno(v * 100, d, '%');

export default function CurvaEquityJuez({ r }: { r: RespuestaLaboratorio }) {
  const id = useId().replace(/:/g, '');
  const j = r.resultado;
  const t = useProgreso(2200, `${r.hasta}-${j.ensayos}`);
  const eq = useMemo(() => (j.equityOos.length ? j.equityOos : [1]), [j.equityOos]);
  const corte = r.filas > 0 ? Math.min(0.9, Math.max(0, j.inicioOos / r.filas)) : 0.3;
  const dd = useMemo(() => {
    let pico = -Infinity;
    return eq.map((e) => {
      pico = Math.max(pico, e);
      return e / pico - 1;
    });
  }, [eq]);
  const min = Math.min(...eq, 1) - 0.002;
  const max = Math.max(...eq, 1) + 0.002;
  const minDD = Math.min(...dd, -0.01) * 1.1;
  // La curva OOS ocupa desde el corte hasta el final; la zona IS (antes del corte) solo eligió parámetros.
  const x = (i: number) => (corte + (eq.length > 1 ? i / (eq.length - 1) : 0) * (1 - corte)) * W;
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
  const yDD = (v: number) => (v / minDD) * H_DD;
  const camino = eq.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const idx = Math.min(eq.length - 1, Math.floor(t * (eq.length - 1)));
  const xCorte = corte * W;
  // Límites de las ventanas del Walk-Forward (barra → x).
  const marcas = j.tramos.map((w) => (r.filas ? (w.desde / r.filas) * W : 0));

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
              <rect x={0} y={-10} height={H + 20} width={xCorte + (W - xCorte) * t} />
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
          {/* Zona In-Sample: solo entrena (elige parámetros), no opera. */}
          <rect x={0} y={0} width={xCorte} height={H} fill="rgba(255,255,255,0.025)" />
          <rect x={xCorte} y={0} width={W - xCorte} height={H} fill="rgba(255,255,255,0.015)" />
          {marcas.map((m, i) => (
            <line key={i} x1={m} x2={m} y1={H - 8} y2={H} stroke="rgba(255,255,255,0.25)" vectorEffect="non-scaling-stroke" />
          ))}
          <g clipPath={`url(#${id}-c)`}>
            <path d={`${camino}L${x(eq.length - 1)},${H}L${xCorte},${H}Z`} fill={`url(#${id}-g)`} />
            <path d={camino} fill="none" stroke="#FFFFFF" strokeWidth={1.9} vectorEffect="non-scaling-stroke" />
          </g>
          <line x1={xCorte} x2={xCorte} y1={0} y2={H} stroke="#fff" strokeOpacity={0.6} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
        {t < 1 && (
          <span
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
            style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${x(idx) / W})`, top: `${(y(eq[idx]) / H) * 100}%` }}
          />
        )}
        <span className="absolute top-1 -translate-x-full pr-2 text-[9.5px] uppercase tracking-[0.14em] text-plata-400" style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${corte})` }}>
          In-Sample · elige
        </span>
        <span className="absolute top-1 pl-2 text-[9.5px] uppercase tracking-[0.14em] text-white" style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${corte})` }}>
          Out-of-Sample · Juez
        </span>
      </div>

      <div className="relative mt-3 h-[70px] pl-14">
        <span className="cifra absolute left-0 top-0 text-[9.5px] text-plata-500">0%</span>
        <span className="cifra absolute bottom-0 left-0 text-[9.5px] text-plata-500">{num(minDD * 100, 0)}%</span>
        <svg viewBox={`0 0 ${W} ${H_DD}`} preserveAspectRatio="none" className="h-full w-full">
          <motion.path
            key={`${r.hasta}-${j.ensayos}`}
            d={`M${xCorte},0${dd.map((v, i) => `L${x(i).toFixed(1)},${yDD(v).toFixed(1)}`).join('')}L${x(dd.length - 1)},0Z`}
            fill="rgba(255,255,255,0.1)"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.6 }}
          />
          <line x1={xCorte} x2={xCorte} y1={0} y2={H_DD} stroke="#fff" strokeOpacity={0.4} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute right-0 top-1 text-[9.5px] uppercase tracking-[0.14em] text-plata-500">Drawdown</span>
      </div>

      <div className="mt-2 flex justify-between pl-14 font-mono text-[9.5px] text-plata-500">
        <span>{new Date(r.desde).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
        <span>Corte · {new Date(r.inicioOosT).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
        <span>{new Date(r.hasta).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-borde-suave pt-3 sm:grid-cols-4">
        <Dato k="Retorno In-Sample (referencia optimista)" v={pct(j.dentroMuestra.retornoTotal)} />
        <Dato k="Retorno Out-of-Sample" v={pct(j.oos.retornoTotal)} />
        <Dato k="Peor drawdown" v={pct(-j.oos.maxDrawdown)} />
        <Dato k="Operaciones IS / OOS" v={`${num(j.dentroMuestra.operaciones)} / ${num(j.oos.operaciones)}`} />
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
