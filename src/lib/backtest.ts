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
