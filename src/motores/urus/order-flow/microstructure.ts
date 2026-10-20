import type { FootprintLevel } from "./footprint";
import { candlePriceDelta, computeAbsorptionIndex, diagonalRatio } from "./formulas";
import { isBetterPoc } from "./poc";

/**
 * FOOTPRINT MICROSTRUCTURE CALCULATION ENGINE
 *
 * Funciones puras sobre los niveles que YA produce el Footprint (bidQty/askQty
 * clasificados con buyerIsMaker). No lee datos, no abre conexiones, no
 * persiste y no conoce colores: eso pertenece al renderer/settings.
 *
 * Convención de nombres: en el Footprint existente bidQty = volumen agresor
 * vendedor (buyerIsMaker = true) y askQty = volumen agresor comprador
 * (buyerIsMaker = false). Aquí se exponen como bidVolume / askVolume.
 */

export type ImbalanceSignal = "none" | "buying" | "selling";
export type ExhaustionSignal = "none" | "buying" | "selling";
export type MovementDirection = "up" | "down";

export interface MicrostructureConfig {
  /** Ratio diagonal mínimo (por defecto 3.0). */
  imbalanceRatio: number;
  /** Si el contrario diagonal es 0 y el lado dominante > 0, cuenta como imbalance. */
  zeroDenominatorImbalance: boolean;
  /** Volumen mínimo del lado dominante para considerar imbalance (0 = sin mínimo). */
  minImbalanceVolume: number;
  /** Niveles consecutivos mínimos para un Stacked Imbalance. */
  stackedMinLevels: number;
  absorption: {
    /** Velas previas usadas como base histórica. */
    lookbackCandles: number;
    /** Mínimo de niveles históricos para que la base sea válida. */
    minSamples: number;
    /** Level_Volume > mean + stdDevMultiplier * stdDev. */
    stdDevMultiplier: number;
    /** abs(delta) / volume debe ser menor que este valor. */
    maxDeltaRatio: number;
  };
  exhaustion: {
    /** Filas del extremo (high/low) que se evalúan. */
    extremeLevels: number;
    /** Filas previas, en la dirección del movimiento, usadas como referencia. */
    approachLevels: number;
    /** Agresión media del extremo <= declineRatio * agresión media de aproximación. */
    declineRatio: number;
    /** Agresión media mínima de aproximación (evita comparar contra ruido). */
    minApproachVolume: number;
  };
}

export const DEFAULT_MICROSTRUCTURE_CONFIG: MicrostructureConfig = {
  imbalanceRatio: 3.0,
  zeroDenominatorImbalance: true,
  minImbalanceVolume: 0,
  stackedMinLevels: 3,
  absorption: { lookbackCandles: 20, minSamples: 30, stdDevMultiplier: 2, maxDeltaRatio: 0.15 },
  exhaustion: { extremeLevels: 2, approachLevels: 3, declineRatio: 0.5, minApproachVolume: 0 },
};

export interface FootprintLevelSignal {
  price: number;
  bidVolume: number;
  askVolume: number;
  totalVolume: number;
  delta: number;
  /** Lado con mayor ratio cuando ambos se cumplen; los booleanos conservan todo. */
  imbalance: ImbalanceSignal;
  buyingImbalance: boolean;
  sellingImbalance: boolean;
  absorption: boolean;
  /**
   * Índice de absorción del nivel: Volume(p) / (|close−open| + ε).
   * null cuando la vela no trae open/close. No reemplaza el flag `absorption`.
   */
  absorptionIndex?: number | null;
  exhaustion: ExhaustionSignal;
}

export interface StackedImbalance {
  direction: "buying" | "selling";
  startPrice: number;
  endPrice: number;
  levels: number[];
  count: number;
}

export interface VolumeBaseline {
  mean: number;
  stdDev: number;
  samples: number;
}

export interface FootprintCandleSignals {
  /** Paso de precio entre filas con el que se calcularon las diagonales. */
  step: number;
  levels: FootprintLevelSignal[];
  /** Nivel de mayor volumen (preserva candle.pocPrice cuando existe). */
  pocPrice: number | null;
  /** Nivel de mayor |delta|. Independiente del POC. */
  deltaPocPrice: number | null;
  stackedImbalances: StackedImbalance[];
  /** Base histórica usada para absorption (null = historia insuficiente). */
  baseline: VolumeBaseline | null;
}

type LevelInput = Pick<FootprintLevel, "price" | "bidQty" | "askQty">;

export interface MicrostructureCandleInput {
  timestamp: number;
  levels: readonly LevelInput[];
  pocPrice?: number | null;
  /** Open de la vela (opcional; sin open+close no se calcula `absorptionIndex`). */
  open?: number;
  /** Close de la vela (opcional; sin open+close no se calcula `absorptionIndex`). */
  close?: number;
  signals?: FootprintCandleSignals;
}

export interface ComputeSignalsOptions {
  step: number;
  baseline?: VolumeBaseline | null;
  config?: MicrostructureConfig;
  /** Si se conoce (OHLC real), limita exhaustion al extremo del movimiento. */
  direction?: MovementDirection;
}

const toIndex = (price: number, step: number) => Math.round(price / step);

export function computeCandleSignals(
  candle: MicrostructureCandleInput,
  options: ComputeSignalsOptions,
): FootprintCandleSignals {
  const config = options.config ?? DEFAULT_MICROSTRUCTURE_CONFIG;
  const { step } = options;
  if (!Number.isFinite(step) || step <= 0) throw new Error("Invalid microstructure step");
  const baseline = options.baseline ?? null;

  const rows = [...candle.levels]
    .filter(l => Number.isFinite(l.price) && l.bidQty >= 0 && l.askQty >= 0)
    .sort((a, b) => a.price - b.price);
  if (rows.length === 0) {
    return { step, levels: [], pocPrice: null, deltaPocPrice: null, stackedImbalances: [], baseline };
  }

  const bidAt = new Map<number, number>();
  const askAt = new Map<number, number>();
  for (const row of rows) {
    const idx = toIndex(row.price, step);
    bidAt.set(idx, (bidAt.get(idx) ?? 0) + row.bidQty);
    askAt.set(idx, (askAt.get(idx) ?? 0) + row.askQty);
  }
  const minIdx = toIndex(rows[0].price, step);
  const maxIdx = toIndex(rows[rows.length - 1].price, step);

  // --- Imbalance diagonal + absorption por nivel -------------------------
  // `diagonalRatio` es la fórmula de referencia (formulas.ts). El filtro de
  // volumen mínimo se conserva aquí para no cambiar el comportamiento.
  const ratioOf = (numerator: number, denominator: number): number | null => {
    if (numerator < config.minImbalanceVolume) return null;
    return diagonalRatio(numerator, denominator, config.imbalanceRatio, config.zeroDenominatorImbalance);
  };

  const absorptionLimit = baseline && baseline.samples >= config.absorption.minSamples
    ? baseline.mean + config.absorption.stdDevMultiplier * baseline.stdDev
    : null;

  const levels: FootprintLevelSignal[] = rows.map(row => {
    const idx = toIndex(row.price, step);
    const bidVolume = row.bidQty;
    const askVolume = row.askQty;
    const totalVolume = bidVolume + askVolume;
    const delta = askVolume - bidVolume;

    // Buying: Ask[P] / Bid[P - tick]. Sin contraparte dentro del rango (fila más baja) no se evalúa.
    const buyingRatio = idx > minIdx ? ratioOf(askVolume, bidAt.get(idx - 1) ?? 0) : null;
    // Selling: Bid[P] / Ask[P + tick]. Sin contraparte dentro del rango (fila más alta) no se evalúa.
    const sellingRatio = idx < maxIdx ? ratioOf(bidVolume, askAt.get(idx + 1) ?? 0) : null;
    const imbalance: ImbalanceSignal =
      buyingRatio !== null && sellingRatio !== null
        ? (buyingRatio >= sellingRatio ? "buying" : "selling")
        : buyingRatio !== null ? "buying"
        : sellingRatio !== null ? "selling"
        : "none";

    // Absorption: volumen excepcional Y delta relativamente equilibrado (sin división por cero).
    const absorption =
      absorptionLimit !== null &&
      totalVolume > 0 &&
      totalVolume > absorptionLimit &&
      Math.abs(delta) / totalVolume < config.absorption.maxDeltaRatio;

    // Índice de absorción (cálculo nuevo; no reemplaza el flag `absorption`).
    const absorptionIndex =
      candle.open !== undefined && candle.close !== undefined
        ? computeAbsorptionIndex(totalVolume, candlePriceDelta(candle.open, candle.close))
        : null;

    return {
      price: row.price,
      bidVolume,
      askVolume,
      totalVolume,
      delta,
      imbalance,
      buyingImbalance: buyingRatio !== null,
      sellingImbalance: sellingRatio !== null,
      absorption,
      absorptionIndex,
      exhaustion: "none",
    };
  });

  // --- Exhaustion: extremo + pérdida de agresión en la dirección del movimiento
  const { extremeLevels: Z, approachLevels: A, declineRatio, minApproachVolume } = config.exhaustion;
  if (maxIdx - minIdx + 1 >= Z + A) {
    const avg = (map: Map<number, number>, from: number, to: number) => {
      let sum = 0;
      for (let i = from; i <= to; i++) sum += map.get(i) ?? 0;
      return sum / (to - from + 1);
    };
    const byIdx = new Map(levels.map(level => [toIndex(level.price, step), level]));
    if (options.direction !== "down") {
      const zone = avg(askAt, maxIdx - Z + 1, maxIdx);
      const approach = avg(askAt, maxIdx - Z - A + 1, maxIdx - Z);
      if (approach > 0 && approach >= minApproachVolume && zone <= declineRatio * approach) {
        const top = byIdx.get(maxIdx);
        if (top) top.exhaustion = "buying";
      }
    }
    if (options.direction !== "up") {
      const zone = avg(bidAt, minIdx, minIdx + Z - 1);
      const approach = avg(bidAt, minIdx + Z, minIdx + Z + A - 1);
      if (approach > 0 && approach >= minApproachVolume && zone <= declineRatio * approach) {
        const bottom = byIdx.get(minIdx);
        if (bottom) bottom.exhaustion = "selling";
      }
    }
  }

  return {
    step,
    levels,
    pocPrice: candle.pocPrice ?? selectVolumePoc(levels, candle.close),
    deltaPocPrice: selectDeltaPoc(levels),
    stackedImbalances: [
      ...findStacked(levels, step, "buying", config.stackedMinLevels),
      ...findStacked(levels, step, "selling", config.stackedMinLevels),
    ],
    baseline,
  };
}

/** POC por volumen (fallback; el POC existente de la vela tiene prioridad). Desempate: convención única (M5). */
function selectVolumePoc(levels: readonly FootprintLevelSignal[], referenceClose?: number): number | null {
  let best: FootprintLevelSignal | null = null;
  for (const level of levels) {
    if (!best || isBetterPoc({ price: level.price, volume: level.totalVolume }, { price: best.price, volume: best.totalVolume }, referenceClose)) best = level;
  }
  return best && best.totalVolume > 0 ? best.price : null;
}

/** Delta POC: nivel con mayor |delta|. Empate -> mayor volumen, luego precio más alto. */
export function selectDeltaPoc(levels: readonly Pick<FootprintLevelSignal, "price" | "delta" | "totalVolume">[]): number | null {
  let best: (typeof levels)[number] | null = null;
  for (const level of levels) {
    if (!best) { best = level; continue; }
    const a = Math.abs(level.delta);
    const b = Math.abs(best.delta);
    if (a > b || (a === b && (level.totalVolume > best.totalVolume || (level.totalVolume === best.totalVolume && level.price > best.price)))) best = level;
  }
  return best && Math.abs(best.delta) > 0 ? best.price : null;
}

function findStacked(
  levels: readonly FootprintLevelSignal[],
  step: number,
  direction: "buying" | "selling",
  minLevels: number,
): StackedImbalance[] {
  const flag = direction === "buying" ? "buyingImbalance" : "sellingImbalance";
  const result: StackedImbalance[] = [];
  let run: number[] = [];
  let lastIdx = Number.NaN;
  const close = () => {
    if (run.length >= minLevels) {
      result.push({ direction, startPrice: run[0], endPrice: run[run.length - 1], levels: run, count: run.length });
    }
    run = [];
  };
  for (const level of levels) {
    const idx = toIndex(level.price, step);
    if (level[flag]) {
      if (run.length > 0 && idx !== lastIdx + 1) close();
      run.push(level.price);
      lastIdx = idx;
    } else {
      close();
    }
  }
  close();
  return result;
}

// --- Base histórica de volumen por nivel (para absorption) ---------------

interface LevelMoments { n: number; sum: number; sumSq: number }
const momentsCache = new WeakMap<object, LevelMoments>();

function momentsOf(candle: MicrostructureCandleInput): LevelMoments {
  const cached = momentsCache.get(candle.levels);
  if (cached) return cached;
  let n = 0, sum = 0, sumSq = 0;
  for (const level of candle.levels) {
    const volume = level.bidQty + level.askQty;
    if (!(volume > 0)) continue;
    n += 1; sum += volume; sumSq += volume * volume;
  }
  const moments = { n, sum, sumSq };
  momentsCache.set(candle.levels, moments);
  return moments;
}

/**
 * Media y desviación estándar poblacional del Level_Volume de las velas previas
 * (excluye la vela actual). Cada vela se resume una sola vez (WeakMap), así que
 * recalcular la base cuesta O(lookbackCandles), no O(niveles históricos).
 */
export function computeVolumeBaseline(
  previous: readonly MicrostructureCandleInput[],
  config: MicrostructureConfig = DEFAULT_MICROSTRUCTURE_CONFIG,
): VolumeBaseline | null {
  let n = 0, sum = 0, sumSq = 0;
  const from = Math.max(0, previous.length - config.absorption.lookbackCandles);
  for (let i = from; i < previous.length; i++) {
    const m = momentsOf(previous[i]);
    n += m.n; sum += m.sum; sumSq += m.sumSq;
  }
  if (n < config.absorption.minSamples) return null;
  const mean = sum / n;
  return { mean, stdDev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), samples: n };
}

/**
 * Adjunta signals a las velas indicadas (todas si `only` se omite), en orden
 * cronológico y usando solo velas anteriores como historia. Devuelve un array
 * nuevo; solo las velas recalculadas son objetos nuevos.
 */
export function attachSignalsToCandles<T extends MicrostructureCandleInput>(
  candles: readonly T[],
  step: number,
  config: MicrostructureConfig = DEFAULT_MICROSTRUCTURE_CONFIG,
  only?: ReadonlySet<number>,
): T[] {
  if (!Number.isFinite(step) || step <= 0) return candles as T[];
  const sorted = candles.every((c, i) => i === 0 || candles[i - 1].timestamp <= c.timestamp)
    ? candles
    : [...candles].sort((a, b) => a.timestamp - b.timestamp);
  return sorted.map((candle, index) => {
    if (only && !only.has(candle.timestamp)) return candle;
    const baseline = computeVolumeBaseline(sorted.slice(Math.max(0, index - config.absorption.lookbackCandles), index), config);
    return { ...candle, signals: computeCandleSignals(candle, { step, baseline, config }) };
  });
}
