import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import { crearAleatorio, normal, percentil } from '@/lib/random';
import { num } from '@/lib/format';

interface Props {
  semilla: number;
  /** Retorno medio por operación (fracción del capital) en In-Sample. */
  deriva: number;
  /** Volatilidad por operación. */
  vol: number;
  /** Fracción del edge que se conserva fuera de muestra (1 = sin degradación). */
  retencionOOS: number;
  operacionesIS?: number;
  operacionesOOS?: number;
  capital?: number;
}

const W = 1000;
const H = 300;
const TRAYECTORIAS = 400;

/**
 * Curva de equity dividida en In-Sample (entrenamiento) y Out-of-Sample (validación del Juez),
 * con el abanico Monte Carlo (P90 / P95) abriéndose desde el corte OOS.
 */
export default function CurvaEquityJuez({ semilla, deriva, vol, retencionOOS, operacionesIS = 140, operacionesOOS = 90, capital = 100_000 }: Props) {
  const id = useId();
  const datos = useMemo(() => {
    const rand = crearAleatorio(semilla);
    const is: number[] = [capital];
    for (let i = 1; i < operacionesIS; i++) is.push(is[i - 1] * (1 + deriva + normal(rand) * vol));
    const oos: number[] = [is[is.length - 1]];
    const derivaOOS = deriva * retencionOOS;
    for (let i = 1; i < operacionesOOS; i++) oos.push(oos[i - 1] * (1 + derivaOOS + normal(rand) * vol));

    // Monte Carlo desde el corte, con la deriva OOS observada.
    const caminos: number[][] = [];
    for (let p = 0; p < TRAYECTORIAS; p++) {
      const c = [oos[0]];
      for (let i = 1; i < operacionesOOS; i++) c.push(c[i - 1] * (1 + derivaOOS + normal(rand) * vol));
      caminos.push(c);
    }
    const bandas = { p5: [] as number[], p10: [] as number[], p50: [] as number[], p90: [] as number[], p95: [] as number[] };
    for (let i = 0; i < operacionesOOS; i++) {
      const col = caminos.map((c) => c[i]).sort((a, b) => a - b);
      bandas.p5.push(percentil(col, 0.05));
      bandas.p10.push(percentil(col, 0.1));
      bandas.p50.push(percentil(col, 0.5));
      bandas.p90.push(percentil(col, 0.9));
      bandas.p95.push(percentil(col, 0.95));
    }
    return { is, oos, bandas, muestra: caminos.slice(0, 40) };
  }, [semilla, deriva, vol, retencionOOS, operacionesIS, operacionesOOS, capital]);

  const total = operacionesIS + operacionesOOS - 1;
  const todos = [...datos.is, ...datos.bandas.p5, ...datos.bandas.p95, ...datos.oos];
  const min = Math.min(...todos) * 0.995;
  const max = Math.max(...todos) * 1.005;
  const x = (i: number) => (i / total) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const camino = (arr: number[], desde: number) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(desde + i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const banda = (sup: number[], inf: number[], desde: number) =>
    `${camino(sup, desde)}${[...inf].reverse().map((v, i) => `L${x(desde + inf.length - 1 - i).toFixed(1)},${y(v).toFixed(1)}`).join('')}Z`;
  const corte = operacionesIS - 1;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const final = (arr: number[]) => (arr[arr.length - 1] / capital - 1) * 100;

  return (
    <div className="relative">
      <div className="relative h-[300px] pl-14">
        {/* Eje Y */}
        {ticks.map((t) => (
          <span key={t} className="cifra absolute left-0 -translate-y-1/2 text-[9.5px] text-plata-500" style={{ top: `${(1 - (t - min) / (max - min)) * 100}%` }}>
            ${num(t / 1000, 1)}k
          </span>
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <clipPath id={`${id}-c`}>
              <motion.rect key={semilla} x={0} y={-10} height={H + 20} initial={{ width: 0 }} animate={{ width: W }} transition={{ duration: 1.8, ease: [0.4, 0, 0.2, 1] }} />
            </clipPath>
          </defs>
          {ticks.map((t) => (
            <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.05)" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={W} y1={y(capital)} y2={y(capital)} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
          {/* Zona OOS sombreada */}
          <rect x={x(corte)} y={0} width={W - x(corte)} height={H} fill="rgba(255,255,255,0.02)" />

          <g clipPath={`url(#${id}-c)`}>
            {datos.muestra.map((c, i) => (
              <path key={i} d={camino(c, corte)} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={banda(datos.bandas.p95, datos.bandas.p5, corte)} fill="rgba(255,255,255,0.06)" />
            <path d={banda(datos.bandas.p90, datos.bandas.p10, corte)} fill="rgba(255,255,255,0.07)" />
            <path d={camino(datos.bandas.p95, corte)} fill="none" stroke="rgba(255,255,255,0.45)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            <path d={camino(datos.bandas.p5, corte)} fill="none" stroke="rgba(255,255,255,0.45)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            <path d={camino(datos.bandas.p90, corte)} fill="none" stroke="rgba(255,255,255,0.3)" vectorEffect="non-scaling-stroke" />
            <path d={camino(datos.bandas.p10, corte)} fill="none" stroke="rgba(255,255,255,0.3)" vectorEffect="non-scaling-stroke" />
            <path d={camino(datos.is, 0)} fill="none" stroke="#B8BBC2" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
            <path d={camino(datos.oos, corte)} fill="none" stroke="#FFFFFF" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
          </g>
          <line x1={x(corte)} x2={x(corte)} y1={0} y2={H} stroke="#fff" strokeOpacity={0.6} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="mt-2 flex justify-between pl-14 font-mono text-[9.5px] text-plata-500">
        <span>Operación 1</span>
        <span>Corte Out-of-Sample · operación {operacionesIS}</span>
        <span>Operación {total + 1}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-borde-suave pt-3 sm:grid-cols-5">
        <Final k="In-Sample" v={final(datos.is)} />
        <Final k="Out-of-Sample" v={(datos.oos[datos.oos.length - 1] / datos.oos[0] - 1) * 100} />
        <Final k="MC P5 final" v={(datos.bandas.p5[operacionesOOS - 1] / datos.oos[0] - 1) * 100} />
        <Final k="MC P50 final" v={(datos.bandas.p50[operacionesOOS - 1] / datos.oos[0] - 1) * 100} />
        <Final k="MC P95 final" v={(datos.bandas.p95[operacionesOOS - 1] / datos.oos[0] - 1) * 100} />
      </div>
    </div>
  );
}

function Final({ k, v }: { k: string; v: number }) {
  return (
    <div>
      <p className="etiqueta">{k}</p>
      <p className="cifra mt-1 text-sm text-white">
        {v >= 0 ? '+' : '−'}
        {num(Math.abs(v), 1)}%
      </p>
    </div>
  );
}
