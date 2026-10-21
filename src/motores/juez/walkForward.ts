// Motor 3 · Walk-Forward (WFO). Es el único sitio donde se hace: el Juez lo llama.
//
// La serie se corta en ventanas que avanzan (rolling). Cada ventana tiene:
//   IS  (In-Sample, entrenamiento) de L_IS barras: ahí se elige θ* = argmax_θ Obj(IS, θ)
//   OOS (Out-of-Sample, validación ciega) de L_OOS barras justo después: θ* se aplica congelado.
//   Paso = L_OOS. Todos los OOS se unen en una sola curva de capital.
// Entre el IS y su OOS hay un EMBARGO de barras que no se usan para elegir: las Features miran barras previas y
// la posición rige en la barra siguiente, así que sin ese margen el final del IS se «filtra» en el OOS.
//
// Tamaños automáticos: k = 5 ventanas, IS:OOS = 4:1 → L_OOS = ⌊n / (4 + k)⌋, L_IS = 4 · L_OOS.
//
// Objetivo (Obj), tasa libre de riesgo = 0:
//   Sharpe        = media(r) / desviación(r) en el IS
//   Profit Factor = Σ ganancias / Σ |pérdidas| de las operaciones del IS
//   Retorno neto  = Π(1 + r) − 1 en el IS (compuesto: +50 % y −50 % es −25 %, no 0 %)
//
// Eficiencia Walk-Forward:  WFE = media(anualizado OOS) / media(anualizado IS de θ*)
//   anualizado = media del retorno por barra × barras por año (Pardo). Si el IS no gana (≤ 0), WFE = null.
//   ≥ 0,7 excelente · ≥ 0,5 aceptable · 0,3–0,5 débil · < 0,3 alerta de sobreajuste.
import { backtest, barrasPorAnio, metricas, sharpeBarras, type Costos, type OpcionesBacktest, type Operacion, type ResultadoBacktest } from './backtest';

export type ObjetivoWfo = 'sharpe' | 'profit-factor' | 'retorno';

export const NOMBRE_OBJETIVO: Record<ObjetivoWfo, string> = { sharpe: 'Sharpe', 'profit-factor': 'Profit Factor', retorno: 'Retorno neto' };

export interface ConfigWfo {
  /** Barras de la ventana IS (0 o ausente = automático). */
  lIs?: number;
  /** Barras de la ventana OOS (0 o ausente = automático). */
  lOos?: number;
  embargo?: number;
  objetivo?: ObjetivoWfo;
}

export interface VentanaWfo {
  isDesde: number;
  /** Fin (exclusivo) de las barras usadas para elegir: inicio del OOS menos el embargo. */
  isHasta: number;
  oosDesde: number;
  oosHasta: number;
}

export const VENTANAS_WFO = 5;
export const PROPORCION_IS = 4;
export const EMBARGO_WFO = 20;

/** Ventanas rolling (paso = L_OOS). La última OOS se alarga hasta el final si sobra menos de una ventana. */
export function ventanasWfo(n: number, c: ConfigWfo = {}): VentanaWfo[] {
  const embargo = c.embargo ?? EMBARGO_WFO;
  const lOos = c.lOos && c.lOos > 0 ? Math.floor(c.lOos) : Math.floor(n / (PROPORCION_IS + VENTANAS_WFO));
  const lIs = c.lIs && c.lIs > 0 ? Math.floor(c.lIs) : PROPORCION_IS * lOos;
  const out: VentanaWfo[] = [];
  if (lOos < 2 || lIs - embargo < 2) return out;
  for (let t = 0; t + lIs + lOos <= n; t += lOos) out.push({ isDesde: t, isHasta: t + lIs - embargo, oosDesde: t + lIs, oosHasta: t + lIs + lOos });
  const ultima = out[out.length - 1];
  if (ultima && n - ultima.oosHasta < lOos) ultima.oosHasta = n;
  return out;
}

/** Valor del objetivo en [desde, hasta) de un backtest (más alto = mejor). */
export function valorObjetivo(b: ResultadoBacktest, tiempos: readonly number[], desde: number, hasta: number, objetivo: ObjetivoWfo): number {
  if (objetivo === 'sharpe') return sharpeBarras(b.retornos.slice(desde, hasta)) ?? -Infinity;
  const m = metricas(b, tiempos, desde, hasta);
  if (objetivo === 'retorno') return m.retornoTotal;
  return m.factorBeneficio ?? -Infinity;
}

/**
 * θ* = argmax del objetivo usando SOLO las barras [desde, hasta). Es la única regla de elección de variante:
 * la usan las ventanas del Walk-Forward y la elección de la variante que se lleva a vivo.
 */
export function elegirVariante(e: { cierres: readonly number[]; tiempos: readonly number[]; posiciones: readonly (readonly number[])[]; costos: Costos; opciones?: OpcionesBacktest }, desde: number, hasta: number, objetivo: ObjetivoWfo): { combo: number; valor: number; b: ResultadoBacktest } {
  let mejor: { combo: number; valor: number; b: ResultadoBacktest } | null = null;
  e.posiciones.forEach((p, combo) => {
    const b = backtest(e.cierres, p, e.costos, desde, hasta, e.opciones);
    const valor = valorObjetivo(b, e.tiempos, desde, hasta, objetivo);
    if (!mejor || valor > mejor.valor) mejor = { combo, valor, b };
  });
  return mejor ?? { combo: 0, valor: -Infinity, b: backtest(e.cierres, [], e.costos, desde, hasta, e.opciones) };
}

/** Rendimiento anualizado aritmético: media del retorno por barra × barras por año. */
export function anualizado(retornos: readonly number[], tiempos: readonly number[], desde: number, hasta: number): number {
  if (hasta - desde < 2) return 0;
  let s = 0;
  for (let i = desde; i < hasta; i += 1) s += retornos[i];
  return (s / (hasta - desde)) * barrasPorAnio(tiempos.slice(desde, hasta));
}

export type ClaseWfe = 'excelente' | 'aceptable' | 'débil' | 'sobreajuste';

export function clasificarWfe(wfe: number | null): ClaseWfe | null {
  if (wfe === null) return null;
  return wfe >= 0.7 ? 'excelente' : wfe >= 0.5 ? 'aceptable' : wfe >= 0.3 ? 'débil' : 'sobreajuste';
}

export interface VentanaResultado extends VentanaWfo {
  /** Variante elegida (θ*). */
  combo: number;
  objetivoIs: number;
  /** Sharpe anualizado del IS con θ* (solo para dibujar IS frente a OOS: no decide nada). */
  sharpeIs?: number | null;
  anualIs: number;
  anualOos: number;
  /** Retorno, Sharpe y operaciones del OOS. */
  retorno: number;
  sharpe: number | null;
  operaciones: number;
}

export interface ResultadoWfo {
  ventanas: VentanaResultado[];
  objetivo: ObjetivoWfo;
  lIs: number;
  lOos: number;
  embargo: number;
  /** Retorno por barra de la curva OOS concatenada (0 fuera de los OOS). */
  retornos: number[];
  /** Posición aplicada en cada barra OOS (θ* de su ventana). */
  posiciones: number[];
  operaciones: Operacion[];
  inicioOos: number;
  wfe: number | null;
  clase: ClaseWfe | null;
}

export function walkForward(e: { cierres: readonly number[]; tiempos: readonly number[]; posiciones: readonly (readonly number[])[]; costos: Costos; opciones?: OpcionesBacktest; config?: ConfigWfo }): ResultadoWfo {
  const n = e.cierres.length;
  const objetivo = e.config?.objetivo ?? 'sharpe';
  const vs = ventanasWfo(n, e.config);
  const retornos = new Array(n).fill(0);
  const posiciones = new Array(n).fill(0);
  const operaciones: Operacion[] = [];
  const ventanas: VentanaResultado[] = [];
  for (const v of vs) {
    // A. IS: θ* = argmax del objetivo, solo con barras del IS (antes del embargo; nunca el OOS).
    const { combo, valor: mejor, b: bIs } = elegirVariante(e, v.isDesde, v.isHasta, objetivo);
    // B. OOS: θ* congelado.
    const b = backtest(e.cierres, e.posiciones[combo], e.costos, v.oosDesde, v.oosHasta, e.opciones);
    for (let i = v.oosDesde; i < v.oosHasta; i += 1) {
      retornos[i] = b.retornos[i];
      posiciones[i] = i < v.oosHasta - 1 ? e.posiciones[combo][i] ?? 0 : 0;
    }
    operaciones.push(...b.operaciones);
    const m = metricas(b, e.tiempos, v.oosDesde, v.oosHasta);
    ventanas.push({
      ...v,
      combo,
      objetivoIs: mejor,
      sharpeIs: metricas(bIs, e.tiempos, v.isDesde, v.isHasta).sharpe,
      anualIs: anualizado(bIs.retornos, e.tiempos, v.isDesde, v.isHasta),
      anualOos: anualizado(b.retornos, e.tiempos, v.oosDesde, v.oosHasta),
      retorno: m.retornoTotal,
      sharpe: m.sharpe,
      operaciones: m.operaciones,
    });
  }
  // C. Eficiencia Walk-Forward.
  const media = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
  const is = media(ventanas.map((v) => v.anualIs));
  const wfe = ventanas.length && is > 0 ? media(ventanas.map((v) => v.anualOos)) / is : null;
  const lOos = vs[0] ? vs[0].oosHasta - vs[0].oosDesde : 0;
  return {
    ventanas,
    objetivo,
    lIs: vs[0] ? vs[0].oosDesde - vs[0].isDesde : 0,
    lOos: vs.length > 1 ? vs[1].oosDesde - vs[0].oosDesde : lOos,
    embargo: e.config?.embargo ?? EMBARGO_WFO,
    retornos,
    posiciones,
    operaciones,
    inicioOos: vs[0]?.oosDesde ?? n,
    wfe,
    clase: clasificarWfe(wfe),
  };
}
