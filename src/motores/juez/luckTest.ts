// Motor 5 · Luck test: ¿el resultado es habilidad o suerte? Es el único sitio donde se hace.
//
// Hipótesis nula H0: «la estrategia no tiene habilidad: su resultado no se distingue del azar».
// Se usa el resultado de la estrategia fuera de muestra (sus posiciones y operaciones) y se crean N escenarios
// al azar con uno de dos métodos:
//   permutación: los retornos de las barras del mercado se barajan sin reemplazo (misma distribución, sin orden)
//                y se arma un precio falso; las posiciones de la estrategia se dejan igual.
//   entradas aleatorias: mismas operaciones (número y duración) con lado elegido por una moneda (p = 0,5),
//                colocadas al azar en el tiempo sin solaparse, sobre los precios reales.
// Cada escenario pasa por el MISMO Backtest (costos, funding, huecos) y se mide la métrica elegida:
//   Sharpe (media / desviación de los retornos por barra), Retorno total Π(1 + r) − 1 o Esperanza por operación.
// p = (c + 1) / (N + 1), con c = escenarios con métrica ≥ la real (Phipson y Smyth, 2010: con c / N un p = 0
// diría «imposible que sea suerte», algo que nunca se puede afirmar con N finito).
// Decisión: p < 0,05 → se rechaza H0 (ventaja real); p ≥ 0,05 → posible suerte: el Juez rechaza.
import { backtest, sharpeBarras, type Costos, type OpcionesBacktest, type Operacion, type ResultadoBacktest } from './backtest';

export type MetodoLuck = 'permutacion' | 'entradas-aleatorias';
export type MetricaLuck = 'sharpe' | 'retorno' | 'esperanza';

export const NOMBRE_METODO_LUCK: Record<MetodoLuck, string> = { permutacion: 'Permutación de retornos', 'entradas-aleatorias': 'Entradas aleatorias' };
export const NOMBRE_METRICA_LUCK: Record<MetricaLuck, string> = { sharpe: 'Sharpe', retorno: 'Retorno total', esperanza: 'Esperanza por operación' };

export interface ConfigLuck {
  metodo?: MetodoLuck;
  metrica?: MetricaLuck;
  permutaciones?: number;
}

export const LUCK_POR_DEFECTO = { metodo: 'permutacion' as MetodoLuck, metrica: 'sharpe' as MetricaLuck, permutaciones: 1_000 };
export const ALFA_LUCK = 0.05;

export interface ResultadoLuck {
  metodo: MetodoLuck;
  metrica: MetricaLuck;
  permutaciones: number;
  real: number;
  /** Escenarios al azar con métrica ≥ la real. */
  superiores: number;
  p: number;
  /** Muestra ordenada de la distribución nula (≈ 200 puntos) para el histograma. */
  simulaciones: number[];
}

/** Precio falso: los retornos de [desde, hasta) barajados (Fisher-Yates); los de barras con hueco no se mueven. */
export function permutarRetornos(cierres: readonly number[], desde: number, hasta: number, azar: () => number, huecos?: readonly boolean[]): number[] {
  const rets: number[] = [];
  const movibles: number[] = [];
  for (let i = desde; i + 1 < hasta; i += 1) {
    rets.push(cierres[i] > 0 ? cierres[i + 1] / cierres[i] - 1 : 0);
    if (!huecos?.[i + 1]) movibles.push(rets.length - 1);
  }
  for (let k = movibles.length - 1; k > 0; k -= 1) {
    const j = Math.floor(azar() * (k + 1));
    const a = movibles[k];
    const b = movibles[j];
    [rets[a], rets[b]] = [rets[b], rets[a]];
  }
  const out = [...cierres];
  for (let i = desde; i + 1 < hasta; i += 1) out[i + 1] = out[i] * (1 + rets[i - desde]);
  return out;
}

/** Posiciones al azar: mismas duraciones que `operaciones`, lado con moneda, sin solaparse (≥ 1 barra fuera entre medias). */
export function entradasAleatorias(n: number, operaciones: readonly Pick<Operacion, 'barras'>[], desde: number, hasta: number, azar: () => number): number[] {
  const pos = new Array(n).fill(0);
  const dur = operaciones.map((o) => Math.max(1, o.barras));
  for (let k = dur.length - 1; k > 0; k -= 1) {
    const j = Math.floor(azar() * (k + 1));
    [dur[k], dur[j]] = [dur[j], dur[k]];
  }
  // Cada operación ocupa su duración + 1 barra de salida; la última barra del tramo siempre está fuera.
  const huecoTotal = hasta - 1 - desde - dur.reduce((a, d) => a + d + 1, 0);
  if (huecoTotal < 0) return pos;
  // Reparto uniforme del espacio libre en dur.length + 1 huecos (cortes al azar ordenados).
  const cortes = Array.from({ length: dur.length }, () => Math.floor(azar() * (huecoTotal + 1))).sort((a, b) => a - b);
  let t = desde;
  let previo = 0;
  dur.forEach((d, k) => {
    t += cortes[k] - previo;
    previo = cortes[k];
    const lado = azar() < 0.5 ? 1 : -1;
    for (let i = t; i < t + d; i += 1) pos[i] = lado;
    t += d + 1;
  });
  return pos;
}

export function metricaLuck(b: ResultadoBacktest, desde: number, hasta: number, metrica: MetricaLuck): number {
  if (metrica === 'sharpe') return sharpeBarras(b.retornos.slice(desde, hasta)) ?? -Infinity;
  if (metrica === 'retorno') {
    let e = 1;
    for (let i = desde; i < hasta; i += 1) e *= 1 + b.retornos[i];
    return e - 1;
  }
  const ops = b.operaciones.filter((o) => o.entrada >= desde && o.salida < hasta);
  return ops.length ? ops.reduce((a, o) => a + o.retorno, 0) / ops.length : -Infinity;
}

export function luckTest(e: {
  cierres: readonly number[];
  posiciones: readonly number[];
  operaciones: readonly Operacion[];
  desde: number;
  hasta: number;
  costos: Costos;
  opciones?: OpcionesBacktest;
  azar: () => number;
  config?: ConfigLuck;
}): ResultadoLuck {
  const c = { ...LUCK_POR_DEFECTO, ...Object.fromEntries(Object.entries(e.config ?? {}).filter(([, v]) => v !== undefined && v !== 0)) } as typeof LUCK_POR_DEFECTO;
  const n = e.cierres.length;
  const correr = (cierres: readonly number[], pos: readonly number[]) => metricaLuck(backtest(cierres, pos, e.costos, e.desde, e.hasta, e.opciones), e.desde, e.hasta, c.metrica);
  const real = correr(e.cierres, e.posiciones);
  const sims: number[] = [];
  let superiores = 0;
  for (let k = 0; k < c.permutaciones; k += 1) {
    const v =
      c.metodo === 'permutacion'
        ? correr(permutarRetornos(e.cierres, e.desde, e.hasta, e.azar, e.opciones?.huecos), e.posiciones)
        : correr(e.cierres, entradasAleatorias(n, e.operaciones, e.desde, e.hasta, e.azar));
    sims.push(v);
    if (v >= real) superiores += 1;
  }
  sims.sort((a, b) => a - b);
  const paso = Math.max(1, Math.floor(sims.length / 200));
  return {
    metodo: c.metodo,
    metrica: c.metrica,
    permutaciones: c.permutaciones,
    real,
    superiores,
    p: (superiores + 1) / (c.permutaciones + 1),
    simulaciones: sims.filter((x, i) => i % paso === 0 && Number.isFinite(x)),
  };
}
