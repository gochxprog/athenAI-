// Motor 4 · Monte Carlo: riesgo de secuencia y probabilidad de ruina. Es el único sitio donde se hace.
//
// Entrada: el retorno de cada operación fuera de muestra (T_1 … T_N, como fracción).
// Para cada simulación k se arma una secuencia nueva de N operaciones:
//   bootstrap (con reemplazo): cada elección es independiente, P(T_i) = 1/N (una operación puede repetirse).
//   shuffle (sin reemplazo):   las mismas operaciones en otro orden (el retorno final no cambia; el drawdown sí).
// Curva:      Capital(k, i) = Capital(k, i − 1) · (1 + T(k, i))
// Drawdown:   DD(k, t) = (Pico(k, t) − Capital(k, t)) / Pico(k, t);  MaxDD(k) = máx_t DD(k, t)
// Ruina:      P(ruina) = #{k : MaxDD(k) ≥ umbral} / simulaciones
// Percentiles (interpolación lineal) de los retornos finales y de los MaxDD: P5 pesimista, P50 mediana, P95.
// Juez: P(ruina) > 5 % → rechazada. Alerta si MaxDD P95 > 2 × MaxDD de la secuencia original de operaciones.
import { maxDrawdown } from './backtest';

export type MetodoMc = 'bootstrap' | 'shuffle';

export interface ConfigMc {
  simulaciones?: number;
  metodo?: MetodoMc;
  /** Caída (fracción) que se considera ruina. */
  umbralRuina?: number;
  capitalInicial?: number;
}

export const MC_POR_DEFECTO = { simulaciones: 2_000, metodo: 'bootstrap' as MetodoMc, umbralRuina: 0.3, capitalInicial: 10_000 };
export const RUINA_MAXIMA = 0.05;

export interface ResultadoMc {
  metodo: MetodoMc;
  simulaciones: number;
  umbralRuina: number;
  capitalInicial: number;
  operaciones: number;
  /** Percentiles del retorno final (fracción). */
  p5: number;
  p50: number;
  p95: number;
  /** Percentiles del drawdown máximo (fracción positiva). */
  ddP50: number;
  ddP95: number;
  probRuina: number;
  /** Drawdown máximo de la secuencia original (mismas operaciones, en su orden real). */
  ddOriginal: number;
  /** MaxDD P95 > 2 × MaxDD original: el orden de las operaciones pesa mucho. */
  alertaOrden: boolean;
  /** Muestras (cada 10.ª ordenada) para los histogramas. */
  muestras: number[];
  muestrasDd: number[];
  /** 60 curvas de ejemplo (máx. 120 puntos) y bandas P5/P50/P95 por paso, para dibujarlas. */
  caminos: number[][];
  bandas: { p5: number[]; p50: number[]; p95: number[] };
}

/** Percentil q ∈ [0, 1] de una lista YA ORDENADA, con interpolación lineal. */
export function percentil(ordenados: readonly number[], q: number): number {
  if (!ordenados.length) return NaN;
  const h = (ordenados.length - 1) * q;
  const a = Math.floor(h);
  const b = Math.min(ordenados.length - 1, a + 1);
  return ordenados[a] + (h - a) * (ordenados[b] - ordenados[a]);
}

/** Una secuencia simulada (bootstrap o permutación de Fisher-Yates). */
export function remuestrear(trades: readonly number[], metodo: MetodoMc, azar: () => number): number[] {
  const n = trades.length;
  if (metodo === 'bootstrap') return Array.from({ length: n }, () => trades[Math.floor(azar() * n)]);
  const x = [...trades];
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(azar() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

export function curvaCapital(trades: readonly number[]): number[] {
  const c = [1];
  for (const t of trades) c.push(c[c.length - 1] * (1 + t));
  return c;
}

export function monteCarlo(trades: readonly number[], azar: () => number, config: ConfigMc = {}): ResultadoMc {
  const c = { ...MC_POR_DEFECTO, ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined && v !== 0)) } as typeof MC_POR_DEFECTO;
  const finales: number[] = [];
  const dds: number[] = [];
  let ruinas = 0;
  const pasos = trades.length + 1;
  const puntos = Math.min(120, pasos);
  const idx = Array.from({ length: puntos }, (_, k) => Math.round((k / (puntos - 1 || 1)) * (pasos - 1)));
  const columnas: number[][] = idx.map(() => []);
  const caminos: number[][] = [];
  for (let k = 0; k < c.simulaciones; k += 1) {
    const curva = curvaCapital(remuestrear(trades, c.metodo, azar));
    const dd = maxDrawdown(curva);
    finales.push(curva[curva.length - 1] - 1);
    dds.push(dd);
    if (dd >= c.umbralRuina) ruinas += 1;
    idx.forEach((i, j) => columnas[j].push(curva[i]));
    if (k < 60) caminos.push(idx.map((i) => curva[i]));
  }
  const ord = [...finales].sort((a, b) => a - b);
  const ordDd = [...dds].sort((a, b) => a - b);
  const ddOriginal = maxDrawdown(curvaCapital(trades));
  const ddP95 = percentil(ordDd, 0.95);
  return {
    metodo: c.metodo,
    simulaciones: c.simulaciones,
    umbralRuina: c.umbralRuina,
    capitalInicial: c.capitalInicial,
    operaciones: trades.length,
    p5: percentil(ord, 0.05),
    p50: percentil(ord, 0.5),
    p95: percentil(ord, 0.95),
    ddP50: percentil(ordDd, 0.5),
    ddP95,
    probRuina: ruinas / c.simulaciones,
    ddOriginal,
    alertaOrden: ddP95 > 2 * ddOriginal,
    muestras: ord.filter((_, i) => i % 10 === 0),
    muestrasDd: ordDd.filter((_, i) => i % 10 === 0),
    caminos,
    bandas: {
      p5: columnas.map((x) => percentil([...x].sort((a, b) => a - b), 0.05)),
      p50: columnas.map((x) => percentil([...x].sort((a, b) => a - b), 0.5)),
      p95: columnas.map((x) => percentil([...x].sort((a, b) => a - b), 0.95)),
    },
  };
}

/**
 * Banda esperada tras k operaciones (para comparar un bot en vivo con lo que dijo el Juez):
 * se sacan k operaciones al azar CON reemplazo de las del Juez, se encadenan Π(1 + r) − 1, se repite `simulaciones`
 * veces y se toman los percentiles 5, 50 y 95 del retorno acumulado.
 */
export function bandaTrasOperaciones(trades: readonly number[], k: number, azar: () => number, simulaciones = 2_000): { p5: number; p50: number; p95: number } | null {
  if (!trades.length || k < 1) return null;
  const finales: number[] = [];
  for (let s = 0; s < simulaciones; s += 1) {
    let e = 1;
    for (let i = 0; i < k; i += 1) e *= 1 + trades[Math.floor(azar() * trades.length)];
    finales.push(e - 1);
  }
  finales.sort((a, b) => a - b);
  return { p5: percentil(finales, 0.05), p50: percentil(finales, 0.5), p95: percentil(finales, 0.95) };
}
