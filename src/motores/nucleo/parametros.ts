// Parámetros del pipeline por activo. Los motores de Order Flow vienen calibrados para BTCUSDT (tick 0,1 · ≈ 85.000 USD);
// para cualquier otro activo se escalan con su precio, su tick y su volumen de 24 h.
import type { IdTemporalidad, Temporalidad } from './tipos';
import { AGRUPACION_POR_TEMPORALIDAD, TEMPORALIDADES } from './tipos';

export interface ParametrosSimbolo {
  simbolo: string;
  tickSize: number;
  /** Paso de precio de las filas del Footprint por temporalidad. */
  pasos: Record<IdTemporalidad, number>;
  /** Temporalidades de actividad ajustadas al activo (dollar y volume). */
  temporalidades: Record<IdTemporalidad, Temporalidad>;
}

/** Redondea a 1 · 2 · 5 × 10^k (valores legibles). */
export function redondeoAmable(x: number): number {
  if (!(x > 0)) return 1;
  const e = Math.floor(Math.log10(x));
  const base = 10 ** e;
  const m = x / base;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * base;
}

/** Parámetros calibrados para BTCUSDT (por defecto mientras llega la información de la fuente). */
export function parametrosPorDefecto(simbolo = 'BTCUSDT', tickSize = 0.1): ParametrosSimbolo {
  return { simbolo, tickSize, pasos: { ...AGRUPACION_POR_TEMPORALIDAD }, temporalidades: { ...TEMPORALIDADES } };
}

/**
 * Escala los parámetros a un activo:
 * - paso del Footprint ≈ misma fracción del precio que en BTC (5 USD a 85.000 → 0,59 pb), múltiplo del tick;
 * - dollar bar ≈ volumen 24 h / 2.000 (≈ 2.000 barras al día), entre 100 mil y 10 M USD;
 * - volume bar ≈ el equivalente en unidades del activo.
 */
export function parametrosParaSimbolo(simbolo: string, tickSize: number, precio: number, volumen24hUsd: number): ParametrosSimbolo {
  if (!(precio > 0) || !(tickSize > 0)) return parametrosPorDefecto(simbolo, tickSize > 0 ? tickSize : 0.1);
  const REF = 84_700;
  const pasos = {} as Record<IdTemporalidad, number>;
  for (const [id, pasoBtc] of Object.entries(AGRUPACION_POR_TEMPORALIDAD) as [IdTemporalidad, number][]) {
    const crudo = (pasoBtc / REF) * precio;
    const ticks = Math.max(1, Math.round(redondeoAmable(crudo / tickSize)));
    pasos[id] = Number((ticks * tickSize).toPrecision(12));
  }
  const usd = volumen24hUsd > 0 ? Math.min(10_000_000, Math.max(100_000, redondeoAmable(volumen24hUsd / 2_000))) : 10_000_000;
  const base = redondeoAmable(usd / precio);
  return {
    simbolo,
    tickSize,
    pasos,
    temporalidades: { ...TEMPORALIDADES, dollar: { id: 'dollar', tipo: 'dolar', usd }, volume: { id: 'volume', tipo: 'volumen', base } },
  };
}

/** Ticks de futuros habituales (CME/COMEX/NYMEX) para fuentes que no publican el tick (Rithmic por puente). */
const TICKS_CONOCIDOS: Record<string, number> = {
  ES: 0.25, MES: 0.25, NQ: 0.25, MNQ: 0.25, YM: 1, MYM: 1, RTY: 0.1, M2K: 0.1,
  CL: 0.01, MCL: 0.01, NG: 0.001, GC: 0.1, MGC: 0.1, SI: 0.005, HG: 0.0005,
  ZB: 1 / 32, ZN: 1 / 64, '6E': 0.00005, '6J': 0.0000005,
};

/**
 * Tick de un símbolo sin metadatos: primero la tabla de futuros (raíz del contrato, p. ej. ESZ6 → ES);
 * si no, el menor salto de precio observado, redondeado a 1 · 2 · 5 × 10^k.
 */
export function inferirTick(simbolo: string, precios: readonly number[]): number {
  const raiz = simbolo.toUpperCase().replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');
  if (TICKS_CONOCIDOS[raiz]) return TICKS_CONOCIDOS[raiz];
  if (simbolo.toUpperCase() === 'BTCUSDT') return 0.1;
  const unicos = [...new Set(precios)].sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < unicos.length; i += 1) {
    const d = unicos[i] - unicos[i - 1];
    if (d > 1e-12 && d < min) min = d;
  }
  if (!Number.isFinite(min)) return 0.01;
  const e = Math.floor(Math.log10(min) + 1e-9);
  const base = 10 ** e;
  const m = min / base;
  return Number(((m < 2 ? 1 : m < 5 ? 2 : 5) * base).toPrecision(6));
}

/** Agrupación de la vista del libro: ≈ 1,2 puntos básicos por nivel (BTC a 85.000 → 1 USD). */
export function grupoParaPrecio(precio: number, tick: number): number {
  if (!(precio > 0) || !(tick > 0)) return 1;
  return Math.max(1, Math.round((precio * 0.0000118) / tick));
}
