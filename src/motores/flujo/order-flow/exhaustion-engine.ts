import { buildRows, clamp01, summaryOf, type LevelInput, type Row } from "./resumen-niveles";

/**
 * EXHAUSTION ENGINE
 *
 * Motor cuantitativo, puro y determinista. Lee ÚNICAMENTE los niveles que ya
 * produce el Footprint (bidQty / askQty clasificados con buyerIsMaker) y, de
 * forma opcional, el OHLC real de la vela. Sin aggTrades, sin red, sin
 * persistencia, sin colores, sin azar.
 *
 * Convención de lados:
 *   askQty = agresión compradora (buyerIsMaker = false)
 *   bidQty = agresión vendedora  (buyerIsMaker = true)
 *
 * Convención de nombres de la detección:
 *   "bullish" = se agota la agresión COMPRADORA en el HIGH de la vela
 *               (el empuje alcista pierde fuerza).
 *   "bearish" = se agota la agresión VENDEDORA en el LOW de la vela
 *               (el empuje bajista pierde fuerza).
 *
 * Idea: movimiento agresivo + extremo local + pérdida progresiva de agresión
 * y volumen hacia el extremo + falta de continuación del precio.
 * El score es evidencia medible (0-100), NO una recomendación de compra/venta.
 *
 * Independiente de AbsorptionEngine: no lo importa ni comparte estado con él.
 */

export type ExhaustionSide = "bullish" | "bearish";
export type ExhaustionState = "insufficientData" | "none" | "detected";
export type ExhaustionComponent =
  | "intensity"
  | "decay"
  | "deltaFade"
  | "volumeDecay"
  | "extremePosition"
  | "continuationFailure";

export interface ExhaustionConfig {
  /** Velas previas para la base histórica de volumen por nivel y lado. */
  lookbackCandles: number;
  /** Mínimo de niveles históricos con volumen (por lado) para una base válida. */
  minSamples: number;
  /** Filas del extremo (high/low) que se evalúan. */
  extremeLevels: number;
  /** Filas previas al extremo, en la dirección del movimiento, usadas como aproximación. */
  approachLevels: number;
  /** Agresión media de aproximación / media de nivel histórico (>= este valor). */
  minApproachVsBaseline: number;
  /** Volumen agresivo total mínimo en la aproximación (0 = solo el filtro relativo). */
  minAggressiveVolume: number;
  /** Cuota mínima del lado agresor en la aproximación (hay agresión real que agotar). */
  minApproachShare: number;
  /** agresión media del extremo / agresión media de aproximación (<= este valor). */
  maxDecayRatio: number;
  /** Velas previas usadas para ubicar el extremo en el contexto reciente. */
  extremeLookbackCandles: number;
  /** Mínimo de velas previas para poder medir el contexto. */
  minContextCandles: number;
  /** Posición mínima (0-1) del extremo dentro del rango reciente. */
  minExtremePosition: number;
  /** Fracción del rango de la vela (retroceso desde el extremo al cierre) que satura el componente. */
  closeRetraceFull: number;
  /** Filas que la vela siguiente puede superar el extremo antes de anular la falta de continuación. */
  continuationTolerance: number;
  /** continuationFailure mínimo (0-1). Sin evidencia de continuación NO hay detección. */
  minContinuationFailure: number;
  /** Múltiplo de la media histórica que satura el componente de intensidad. */
  intensityCap: number;
  /** Score mínimo (0-100) para emitir una detección. */
  minScore: number;
  /** Pesos del score. */
  weights: Record<ExhaustionComponent, number>;
}

/** Defaults conservadores, documentados en docs/absorption-exhaustion-engines.md. */
export const DEFAULT_EXHAUSTION_CONFIG: ExhaustionConfig = {
  lookbackCandles: 20,
  minSamples: 30,
  extremeLevels: 2,
  approachLevels: 3,
  minApproachVsBaseline: 1,
  minAggressiveVolume: 0,
  minApproachShare: 0.55,
  maxDecayRatio: 0.6,
  extremeLookbackCandles: 10,
  minContextCandles: 3,
  minExtremePosition: 0.8,
  closeRetraceFull: 0.5,
  continuationTolerance: 2,
  minContinuationFailure: 0.4,
  intensityCap: 3,
  minScore: 60,
  weights: {
    intensity: 0.15,
    decay: 0.25,
    deltaFade: 0.15,
    volumeDecay: 0.1,
    extremePosition: 0.15,
    continuationFailure: 0.2,
  },
};


export interface ExhaustionOhlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ExhaustionCandleInput {
  timestamp: number;
  levels: readonly LevelInput[];
  complete?: boolean;
  /** OHLC REAL de mercado. Si falta, solo se usa la vela siguiente como evidencia de continuación. */
  ohlc?: ExhaustionOhlc | null;
}

export interface ExhaustionRawMetrics {
  /** Volumen agresor (lado del movimiento) sumado en las filas del extremo. */
  aggressiveVolume: number;
  /** Volumen agresor sumado en las filas de aproximación. */
  approachAggressiveVolume: number;
  /** delta (ask - bid) sumado en el extremo. */
  delta: number;
  /** delta (ask - bid) sumado en la aproximación. */
  approachDelta: number;
  approachShare: number;
  /** agresión media del extremo / agresión media de aproximación. */
  decayRatio: number;
  /** volumen total medio del extremo / volumen total medio de aproximación. */
  volumeDecayRatio: number;
  /** Cuánto cae la delta en el extremo respecto a la aproximación (0-1). */
  deltaFade: number;
  /** Agresión media de aproximación / media histórica por nivel. */
  approachVsBaseline: number;
  /** Posición del extremo en el rango reciente: 1 = extremo más alto/bajo de la ventana. */
  extremePosition: number;
  /** Evidencia de falta de continuación (0-1). */
  continuationFailure: number;
  closeRetrace: number | null;
  nextCandleFailure: number | null;
}

export interface ExhaustionDetection {
  timestamp: number;
  /** Precio de la fila del extremo (high para bullish, low para bearish). */
  price: number;
  side: ExhaustionSide;
  /** Lado agresor que se agota ("ask" para bullish, "bid" para bearish). */
  aggressorSide: "ask" | "bid";
  /** Evidencia normalizada 0-100. No es una recomendación de compra/venta. */
  exhaustionScore: number;
  state: "detected";
  candleComplete: boolean;
  raw: ExhaustionRawMetrics;
  normalized: Partial<Record<ExhaustionComponent, number>>;
  componentsUsed: ExhaustionComponent[];
}

export type ExhaustionInsufficientReason =
  | "noLevels"
  | "fewLevels"
  | "baseline"
  | "context"
  | "flatContext"
  | "noContinuationEvidence";

export interface ExhaustionCandleResult {
  timestamp: number;
  state: ExhaustionState;
  detections: ExhaustionDetection[];
  reason?: ExhaustionInsufficientReason;
}


function mergeConfig(partial?: Partial<ExhaustionConfig>): ExhaustionConfig {
  if (!partial) return DEFAULT_EXHAUSTION_CONFIG;
  return { ...DEFAULT_EXHAUSTION_CONFIG, ...partial, weights: { ...DEFAULT_EXHAUSTION_CONFIG.weights, ...partial.weights } };
}

/* ------------------------------------------------------------------ */
/* Evaluación                                                          */
/* ------------------------------------------------------------------ */

/**
 * Evalúa `candles[index]`. Usa velas ANTERIORES como historia y, solo para
 * medir falta de continuación, la vela SIGUIENTE si existe. `step` es el paso
 * de las filas que recibe el motor (la misma rejilla agrupada del Footprint).
 */
export function evaluateExhaustionAt(
  candles: readonly ExhaustionCandleInput[],
  index: number,
  step: number,
  config: ExhaustionConfig = DEFAULT_EXHAUSTION_CONFIG,
): ExhaustionCandleResult {
  const candle = candles[index];
  if (!candle) throw new Error("Exhaustion: candle index out of range");
  if (!Number.isFinite(step) || step <= 0) throw new Error("Invalid exhaustion step");
  const base: ExhaustionCandleResult = { timestamp: candle.timestamp, state: "none", detections: [] };
  const insufficient = (reason: ExhaustionInsufficientReason): ExhaustionCandleResult =>
    ({ ...base, state: "insufficientData", reason });

  const Z = config.extremeLevels;
  const A = config.approachLevels;
  const rows = buildRows(candle.levels, step);
  if (rows.length === 0) return insufficient("noLevels");
  if (rows.length < Z + A) return insufficient("fewLevels");

  // --- base histórica de volumen por nivel y lado, y contexto de extremos ---
  let aN = 0, aS = 0, bN = 0, bS = 0, prevCount = 0;
  const from = Math.max(0, index - config.lookbackCandles);
  for (let i = from; i < index; i += 1) {
    const s = summaryOf(candles[i], step);
    if (s.empty) continue;
    aN += s.askN; aS += s.askSum; bN += s.bidN; bS += s.bidSum;
  }
  if (aN < config.minSamples || bN < config.minSamples) return insufficient("baseline");
  const askMean = aS / aN;
  const bidMean = bS / bN;

  let ctxHigh = Number.NEGATIVE_INFINITY;
  let ctxLow = Number.POSITIVE_INFINITY;
  for (let i = Math.max(0, index - config.extremeLookbackCandles); i < index; i += 1) {
    const s = summaryOf(candles[i], step);
    if (s.empty) continue;
    ctxHigh = Math.max(ctxHigh, s.maxIdx);
    ctxLow = Math.min(ctxLow, s.minIdx);
    prevCount += 1;
  }
  if (prevCount < config.minContextCandles) return insufficient("context");

  const minIdx = rows[0].idx;
  const maxIdx = rows[rows.length - 1].idx;
  const windowHigh = Math.max(ctxHigh, maxIdx);
  const windowLow = Math.min(ctxLow, minIdx);
  if (windowHigh <= windowLow) return insufficient("flatContext");

  const byIdx = new Map(rows.map(r => [r.idx, r]));
  const sumRange = (from: number, to: number) => {
    let ask = 0, bid = 0;
    for (let i = from; i <= to; i += 1) {
      const r = byIdx.get(i);
      if (r) { ask += r.ask; bid += r.bid; }
    }
    return { ask, bid };
  };

  // --- evidencia de continuación (compartida): cierre real y vela siguiente ---
  const next = index + 1 < candles.length ? summaryOf(candles[index + 1], step) : null;
  const nextUsable = next !== null && !next.empty;
  const ohlc = candle.ohlc;
  const hasOhlc = !!ohlc && [ohlc.high, ohlc.low, ohlc.close].every(Number.isFinite) && ohlc.high > ohlc.low;
  if (!hasOhlc && !nextUsable) return insufficient("noContinuationEvidence");

  const w = config.weights;
  const detections: ExhaustionDetection[] = [];

  for (const side of ["bullish", "bearish"] as const) {
    const up = side === "bullish";
    // Filas del extremo y de aproximación, ordenadas desde el extremo hacia dentro.
    const extremeFrom = up ? maxIdx - Z + 1 : minIdx;
    const extremeTo = up ? maxIdx : minIdx + Z - 1;
    const approachFrom = up ? maxIdx - Z - A + 1 : minIdx + Z;
    const approachTo = up ? maxIdx - Z : minIdx + Z + A - 1;
    const ext = sumRange(extremeFrom, extremeTo);
    const app = sumRange(approachFrom, approachTo);
    const extAggr = up ? ext.ask : ext.bid;
    const appAggr = up ? app.ask : app.bid;
    const appOpp = up ? app.bid : app.ask;
    const baselineMean = up ? askMean : bidMean;

    // --- filtros (volumen suficiente, agresión real, decaimiento, extremo) ---
    if (!(appAggr > 0) || appAggr < config.minAggressiveVolume) continue;
    const approachShare = appAggr / (appAggr + appOpp);
    if (approachShare < config.minApproachShare) continue;
    const approachAvg = appAggr / A;
    const approachVsBaseline = baselineMean > 0 ? approachAvg / baselineMean : 0;
    if (approachVsBaseline < config.minApproachVsBaseline) continue;
    const decayRatio = extAggr / Z / approachAvg;
    if (decayRatio > config.maxDecayRatio) continue;
    const extremePosition = up
      ? (maxIdx - windowLow) / (windowHigh - windowLow)
      : (windowHigh - minIdx) / (windowHigh - windowLow);
    if (extremePosition < config.minExtremePosition) continue;

    // --- falta de continuación ---
    let closeRetrace: number | null = null;
    if (hasOhlc && ohlc) {
      const range = ohlc.high - ohlc.low;
      closeRetrace = clamp01((up ? ohlc.high - ohlc.close : ohlc.close - ohlc.low) / range);
    }
    let nextCandleFailure: number | null = null;
    if (nextUsable && next) {
      const beyond = up ? next.maxIdx - maxIdx : minIdx - next.minIdx;
      nextCandleFailure = clamp01(1 - beyond / config.continuationTolerance);
    }
    const parts: number[] = [];
    if (closeRetrace !== null) parts.push(clamp01(closeRetrace / config.closeRetraceFull));
    if (nextCandleFailure !== null) parts.push(nextCandleFailure);
    const continuationFailure = parts.reduce((a, b) => a + b, 0) / parts.length;
    if (continuationFailure < config.minContinuationFailure) continue;

    // --- métricas auxiliares del score ---
    const approachDelta = app.ask - app.bid;
    const extremeDelta = ext.ask - ext.bid;
    const signedApproach = up ? approachDelta : -approachDelta;
    const signedExtreme = up ? extremeDelta : -extremeDelta;
    const deltaFade = signedApproach > 0 ? clamp01(1 - signedExtreme / signedApproach) : 0;
    const approachTotalAvg = (app.ask + app.bid) / A;
    const volumeDecayRatio = approachTotalAvg > 0 ? (ext.ask + ext.bid) / Z / approachTotalAvg : 1;

    const normalized: Partial<Record<ExhaustionComponent, number>> = {
      intensity: clamp01(approachVsBaseline / config.intensityCap),
      decay: clamp01(1 - decayRatio / config.maxDecayRatio),
      deltaFade,
      volumeDecay: clamp01(1 - volumeDecayRatio),
      extremePosition: clamp01((extremePosition - config.minExtremePosition) / (1 - config.minExtremePosition)),
      continuationFailure,
    };
    const used = Object.keys(normalized) as ExhaustionComponent[];
    let num = 0;
    let den = 0;
    for (const key of used) { num += w[key] * (normalized[key] as number); den += w[key]; }
    const score = den > 0 ? Math.round((100 * num / den) * 100) / 100 : 0;
    if (score < config.minScore) continue;

    const extremeRow = byIdx.get(up ? maxIdx : minIdx) as Row;
    detections.push({
      timestamp: candle.timestamp,
      price: extremeRow.price,
      side,
      aggressorSide: up ? "ask" : "bid",
      exhaustionScore: score,
      state: "detected",
      candleComplete: candle.complete === true,
      raw: {
        aggressiveVolume: extAggr,
        approachAggressiveVolume: appAggr,
        delta: extremeDelta,
        approachDelta,
        approachShare,
        decayRatio,
        volumeDecayRatio,
        deltaFade,
        approachVsBaseline,
        extremePosition,
        continuationFailure,
        closeRetrace,
        nextCandleFailure,
      },
      normalized,
      componentsUsed: used,
    });
  }
  detections.sort((a, b) => a.price - b.price);
  return { ...base, state: detections.length > 0 ? "detected" : "none", detections };
}

export class ExhaustionEngine {
  readonly config: ExhaustionConfig;

  constructor(config?: Partial<ExhaustionConfig>) {
    this.config = mergeConfig(config);
  }

  evaluateAt(candles: readonly ExhaustionCandleInput[], index: number, step: number): ExhaustionCandleResult {
    return evaluateExhaustionAt(candles, index, step, this.config);
  }

  /** Evalúa desde `fromIndex` hasta el final. La vela anterior al cambio también depende de la siguiente: pasa `index - 1`. */
  evaluateFrom(candles: readonly ExhaustionCandleInput[], fromIndex: number, step: number): ExhaustionCandleResult[] {
    const out: ExhaustionCandleResult[] = [];
    for (let i = Math.max(0, fromIndex); i < candles.length; i += 1) out.push(this.evaluateAt(candles, i, step));
    return out;
  }

  evaluateAll(candles: readonly ExhaustionCandleInput[], step: number): ExhaustionCandleResult[] {
    return this.evaluateFrom(candles, 0, step);
  }
}
