// Series DEMO deterministas de una estrategia: In-Sample, Out-of-Sample y retornos por operación.
import { CAPITAL_BACKTEST, type Estrategia } from '@/data/mock';
import { crearAleatorio, normal } from '@/lib/random';

export interface SimulacionEstrategia {
  capital: number;
  is: number[];
  oos: number[];
  /** Retorno de cada operación Out-of-Sample (fracción del capital). */
  retornosOOS: number[];
  vol: number;
}

export function simularEstrategia(e: Estrategia): SimulacionEstrategia {
  const capital = CAPITAL_BACKTEST;
  // En muestra todo parece mejor: el sobreajuste infla la deriva In-Sample.
  const derivaIS = (Math.max(e.expectancy, 0) + e.overfitting * 0.9 + 6) / capital;
  const derivaOOS = e.expectancy / capital;
  const vol = 0.0042 + e.overfitting * 0.00005;
  const opsIS = Math.min(220, Math.max(60, Math.round(e.trades * 0.65)));
  const opsOOS = Math.min(140, Math.max(40, e.trades - Math.round(e.trades * 0.65)));

  const rand = crearAleatorio(e.semilla);
  const is = [capital];
  for (let i = 1; i < opsIS; i++) is.push(is[i - 1] * (1 + derivaIS + normal(rand) * vol));
  const retornosOOS: number[] = [];
  const oos = [is[is.length - 1]];
  for (let i = 1; i < opsOOS; i++) {
    const r = derivaOOS + normal(rand) * vol;
    retornosOOS.push(r);
    oos.push(oos[i - 1] * (1 + r));
  }
  return { capital, is, oos, retornosOOS, vol };
}

/** Caída desde el máximo previo, en fracción (≤ 0). */
export function drawdown(serie: number[]) {
  let pico = serie[0];
  return serie.map((v) => {
    pico = Math.max(pico, v);
    return v / pico - 1;
  });
}

/** Inversa de la normal estándar (aproximación de Acklam). */
export function normalInversa(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  if (q < 0.02425) {
    const t = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  if (q > 1 - 0.02425) return -normalInversa(1 - q);
  const t = q - 0.5;
  const r = t * t;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
