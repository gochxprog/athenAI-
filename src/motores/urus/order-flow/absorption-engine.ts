import type { FootprintLevel } from "./footprint";

/**
 * ABSORPTION ENGINE
 *
 * Motor cuantitativo, puro y determinista. Lee ÚNICAMENTE los niveles que ya
 * produce el Footprint (bidQty / askQty clasificados con buyerIsMaker) y, de
 * forma opcional, el OHLC real de la vela. No lee aggTrades, no abre
 * conexiones, no persiste, no conoce colores ni canvas, no usa azar.
 *
 * Convención (idéntica al Footprint existente):
 *   askQty = agresión compradora (buyerIsMaker = false)
 *   bidQty = agresión vendedora  (buyerIsMaker = true)
 *
 * Idea: agresión fuerte y concentrada en un nivel + precio que NO avanza en la
 * dirección de esa agresión = evidencia de que un participante pasivo la absorbió.
 *   - side "ask": compradores agresivos absorbidos por vendedores pasivos.
 *   - side "bid": vendedores agresivos absorbidos por compradores pasivos.
 *
 * El score es evidencia medible (0-100), NO una señal de trading.
 *
 * Independiente de ExhaustionEngine: no lo importa ni comparte estado con él.
 */

export type AbsorptionSide = "ask" | "bid";
export type AbsorptionState = "insufficientData" | "none" | "detected";
export type AbsorptionComponent =
  | "volume"
  | "dominance"
  | "concentration"
  | "lowDisplacement"
  | "persistence"
  | "closeFailure";

export interface AbsorptionConfig {
  /** Velas previas usadas como base histórica (volumen por nivel y rango). */
  lookbackCandles: number;
  /** Mínimo de niveles históricos con volumen (por lado) para una base válida. */
  minSamples: number;
  /** Mínimo de velas previas con datos para estimar el rango esperado. */
  minBaselineCandles: number;
  /** Mínimo de filas de la vela actual para evaluar concentración/contexto. */
  minLevels: number;
  /** Volumen agresivo mínimo absoluto en el nivel (0 = solo el filtro relativo). */
  minAggressiveVolume: number;
  /** z-score mínimo del volumen agresivo del nivel frente a la base histórica. */
  minVolumeZ: number;
  /** z-score que satura el componente de volumen (componente = z / zCap). */
  zCap: number;
  /** Cuota mínima del lado agresor dentro del nivel: aggr / (aggr + opuesto). */
  minAggressiveShare: number;
  /** Avance máximo permitido / rango esperado (avance más allá del nivel). */
  maxDisplacementRatio: number;
  /** Piso del rango esperado, en filas, para no dividir por rangos diminutos. */
  minExpectedRangeSteps: number;
  /** Velas previas inspeccionadas para repetición de agresión en el mismo precio. */
  persistenceCandles: number;
  /** Filas a cada lado del nivel que forman el clúster de concentración. */
  clusterRadius: number;
  /** Score mínimo (0-100) para emitir una detección. */
  minScore: number;
  /** Detecciones máximas por lado y vela (supresión de no-máximos). */
  maxDetectionsPerSide: number;
  /** Filas mínimas entre dos detecciones del mismo lado en la misma vela. */
  suppressionSteps: number;
  /** Pesos del score (se renormalizan si un componente no está disponible). */
  weights: Record<AbsorptionComponent, number>;
}

/** Defaults conservadores: exigen volumen claramente excepcional y poco avance. */
export const DEFAULT_ABSORPTION_CONFIG: AbsorptionConfig = {
  lookbackCandles: 20,
  minSamples: 30,
  minBaselineCandles: 5,
  minLevels: 5,
  minAggressiveVolume: 0,
  minVolumeZ: 2,
  zCap: 4,
  minAggressiveShare: 0.6,
  maxDisplacementRatio: 0.35,
  minExpectedRangeSteps: 3,
  persistenceCandles: 3,
  clusterRadius: 1,
  minScore: 60,
  maxDetectionsPerSide: 2,
  suppressionSteps: 2,
  weights: {
    volume: 0.25,
    dominance: 0.15,
    concentration: 0.15,
    lowDisplacement: 0.3,
    persistence: 0.1,
    closeFailure: 0.05,
  },
};

type LevelInput = Pick<FootprintLevel, "price" | "bidQty" | "askQty">;

export interface AbsorptionOhlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AbsorptionCandleInput {
  timestamp: number;
  levels: readonly LevelInput[];
  /** Solo si la vela ya está cerrada en el Footprint (se propaga a la detección). */
  complete?: boolean;
  /** OHLC REAL de mercado. Si falta, closeFailure no se usa (no se inventa). */
  ohlc?: AbsorptionOhlc | null;
}

/** Métricas crudas, sin normalizar. */
export interface AbsorptionRawMetrics {
  aggressiveVolume: number;
  oppositeVolume: number;
  /** delta del nivel = ask - bid. */
  delta: number;
  clusterVolume: number;
  clusterDelta: number;
  volumeZScore: number;
  aggressiveShare: number;
  /** Fracción del volumen agresor de la vela contenida en el clúster. */
  concentration: number;
  /** Concentración esperada si el volumen se repartiera uniformemente. */
  expectedConcentration: number;
  /** Filas que el precio avanzó más allá del nivel en la dirección de la agresión. */
  priceDisplacementSteps: number;
  /** priceDisplacementSteps / rango esperado (en filas). */
  displacementRatio: number;
  expectedRangeSteps: number;
  /** null si no hay OHLC real. 1 = el precio cerró de vuelta en/bajo el nivel. */
  closeFailure: number | null;
  repeatCount: number;
  persistenceWindow: number;
}

export interface AbsorptionDetection {
  timestamp: number;
  price: number;
  /** Lado agresor absorbido ("ask" = compradores agresivos, "bid" = vendedores). */
  side: AbsorptionSide;
  absorbedBy: "sellers" | "buyers";
  /** Evidencia normalizada 0-100. No es una señal de compra/venta. */
  absorptionScore: number;
  state: "detected";
  candleComplete: boolean;
  raw: AbsorptionRawMetrics;
  /** Componentes normalizados 0-1 usados por el score. */
  normalized: Partial<Record<AbsorptionComponent, number>>;
  componentsUsed: AbsorptionComponent[];
}

export type AbsorptionInsufficientReason = "noLevels" | "fewLevels" | "baseline" | "baselineRange";

export interface AbsorptionCandleResult {
  timestamp: number;
  state: AbsorptionState;
  detections: AbsorptionDetection[];
  reason?: AbsorptionInsufficientReason;
}

/* ------------------------------------------------------------------ */
/* Utilidades internas (autocontenidas a propósito)                     */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toIndex = (price: number, step: number) => Math.round(price / step);

interface Row {
  idx: number;
  price: number;
  bid: number;
  ask: number;
}

function buildRows(levels: readonly LevelInput[], step: number): Row[] {
  const byIdx = new Map<number, Row>();
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !(level.bidQty >= 0) || !(level.askQty >= 0)) continue;
    const idx = toIndex(level.price, step);
    const row = byIdx.get(idx);
    if (row) {
      row.bid += level.bidQty;
      row.ask += level.askQty;
    } else {
      byIdx.set(idx, { idx, price: level.price, bid: level.bidQty, ask: level.askQty });
    }
  }
  return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
}

interface CandleSummary {
  step: number;
  askN: number; askSum: number; askSumSq: number;
  bidN: number; bidSum: number; bidSumSq: number;
  /** Filas entre el nivel más bajo y el más alto operados (0 = una sola fila). */
  rangeSteps: number;
  empty: boolean;
}

// Cada vela se resume una sola vez (clave: su array de niveles) => la base
// histórica cuesta O(lookbackCandles) por evaluación, no O(niveles históricos).
const summaryCache = new WeakMap<object, CandleSummary>();

function summaryOf(candle: AbsorptionCandleInput, step: number): CandleSummary {
  const cached = summaryCache.get(candle.levels);
  if (cached && cached.step === step) return cached;
  const rows = buildRows(candle.levels, step);
  const s: CandleSummary = {
    step, askN: 0, askSum: 0, askSumSq: 0, bidN: 0, bidSum: 0, bidSumSq: 0,
    rangeSteps: rows.length > 0 ? rows[rows.length - 1].idx - rows[0].idx : 0,
    empty: rows.length === 0,
  };
  for (const r of rows) {
    if (r.ask > 0) { s.askN += 1; s.askSum += r.ask; s.askSumSq += r.ask * r.ask; }
    if (r.bid > 0) { s.bidN += 1; s.bidSum += r.bid; s.bidSumSq += r.bid * r.bid; }
  }
  summaryCache.set(candle.levels, s);
  return s;
}

interface Baseline {
  ask: { mean: number; std: number; n: number };
  bid: { mean: number; std: number; n: number };
  rangeMean: number;
  candles: number;
}

function computeBaseline(
  candles: readonly AbsorptionCandleInput[],
  index: number,
  step: number,
  config: AbsorptionConfig,
): Baseline {
  let aN = 0, aS = 0, aQ = 0, bN = 0, bS = 0, bQ = 0, rSum = 0, rN = 0;
  const from = Math.max(0, index - config.lookbackCandles);
  for (let i = from; i < index; i += 1) {
    const s = summaryOf(candles[i], step);
    if (s.empty) continue;
    aN += s.askN; aS += s.askSum; aQ += s.askSumSq;
    bN += s.bidN; bS += s.bidSum; bQ += s.bidSumSq;
    rSum += s.rangeSteps; rN += 1;
  }
  const stats = (n: number, sum: number, sq: number) => {
    if (n === 0) return { mean: 0, std: 0, n: 0 };
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), n };
  };
  return { ask: stats(aN, aS, aQ), bid: stats(bN, bS, bQ), rangeMean: rN > 0 ? rSum / rN : 0, candles: rN };
}

/* ------------------------------------------------------------------ */
/* Evaluación                                                          */
/* ------------------------------------------------------------------ */

function mergeConfig(partial?: Partial<AbsorptionConfig>): AbsorptionConfig {
  if (!partial) return DEFAULT_ABSORPTION_CONFIG;
  return { ...DEFAULT_ABSORPTION_CONFIG, ...partial, weights: { ...DEFAULT_ABSORPTION_CONFIG.weights, ...partial.weights } };
}

/**
 * Evalúa la vela `candles[index]` usando solo velas ANTERIORES como historia.
 * `step` es el paso de precio de las filas que recibe el motor (la misma
 * rejilla agrupada que dibuja el Footprint).
 */
export function evaluateAbsorptionAt(
  candles: readonly AbsorptionCandleInput[],
  index: number,
  step: number,
  config: AbsorptionConfig = DEFAULT_ABSORPTION_CONFIG,
): AbsorptionCandleResult {
  const candle = candles[index];
  if (!candle) throw new Error("Absorption: candle index out of range");
  if (!Number.isFinite(step) || step <= 0) throw new Error("Invalid absorption step");
  const base: AbsorptionCandleResult = { timestamp: candle.timestamp, state: "none", detections: [] };
  const insufficient = (reason: AbsorptionInsufficientReason): AbsorptionCandleResult =>
    ({ ...base, state: "insufficientData", reason });

  const rows = buildRows(candle.levels, step);
  if (rows.length === 0) return insufficient("noLevels");
  if (rows.length < config.minLevels) return insufficient("fewLevels");

  const baseline = computeBaseline(candles, index, step, config);
  if (baseline.ask.n < config.minSamples || baseline.bid.n < config.minSamples) return insufficient("baseline");
  if (baseline.candles < config.minBaselineCandles || baseline.rangeMean <= 0) return insufficient("baselineRange");

  const expectedRange = Math.max(baseline.rangeMean, config.minExpectedRangeSteps);
  const minIdx = rows[0].idx;
  const maxIdx = rows[rows.length - 1].idx;
  const byIdx = new Map(rows.map(r => [r.idx, r]));
  const sideTotals = { ask: 0, bid: 0 };
  for (const r of rows) { sideTotals.ask += r.ask; sideTotals.bid += r.bid; }
  const expectedConcentration = Math.min(1, (2 * config.clusterRadius + 1) / rows.length);
  const window = Math.min(config.persistenceCandles, index);
  const w = config.weights;

  const detections: AbsorptionDetection[] = [];
  for (const side of ["ask", "bid"] as const) {
    const stats = baseline[side];
    const found: AbsorptionDetection[] = [];
    for (const row of rows) {
      const aggressive = side === "ask" ? row.ask : row.bid;
      const opposite = side === "ask" ? row.bid : row.ask;
      // --- filtros baratos primero ---
      if (!(aggressive > 0) || aggressive < config.minAggressiveVolume) continue;
      const total = aggressive + opposite;
      const share = aggressive / total;
      if (share < config.minAggressiveShare) continue;
      const z = stats.std > 0 ? (aggressive - stats.mean) / stats.std : aggressive > stats.mean ? config.zCap : 0;
      if (z < config.minVolumeZ) continue;
      const displacement = side === "ask" ? maxIdx - row.idx : row.idx - minIdx;
      const displacementRatio = displacement / expectedRange;
      if (displacementRatio > config.maxDisplacementRatio) continue;

      // --- métricas costosas solo para los supervivientes ---
      let clusterVolume = 0;
      let clusterDelta = 0;
      for (let k = -config.clusterRadius; k <= config.clusterRadius; k += 1) {
        const near = byIdx.get(row.idx + k);
        if (!near) continue;
        clusterVolume += side === "ask" ? near.ask : near.bid;
        clusterDelta += near.ask - near.bid;
      }
      const sideTotal = sideTotals[side];
      const concentration = sideTotal > 0 ? clusterVolume / sideTotal : 0;
      const concentrationNorm = expectedConcentration < 1 ? clamp01((concentration - expectedConcentration) / (1 - expectedConcentration)) : 0;

      let repeatCount = 0;
      for (let p = 1; p <= window; p += 1) {
        const prev = buildRows(candles[index - p].levels, step);
        const hit = prev.some(r => Math.abs(r.idx - row.idx) <= config.clusterRadius && (side === "ask" ? r.ask : r.bid) >= stats.mean && (side === "ask" ? r.ask : r.bid) > 0);
        if (hit) repeatCount += 1;
      }

      let closeFailure: number | null = null;
      const close = candle.ohlc?.close;
      if (typeof close === "number" && Number.isFinite(close)) {
        const closeIdx = Math.floor(close / step + 1e-9);
        const closeProgress = side === "ask" ? Math.max(0, closeIdx - row.idx) : Math.max(0, row.idx - closeIdx);
        closeFailure = displacement === 0 ? 1 : clamp01(1 - closeProgress / displacement);
      }

      const normalized: Partial<Record<AbsorptionComponent, number>> = {
        volume: clamp01(z / config.zCap),
        dominance: clamp01((share - config.minAggressiveShare) / (1 - config.minAggressiveShare)),
        concentration: concentrationNorm,
        lowDisplacement: clamp01(1 - displacementRatio / config.maxDisplacementRatio),
        persistence: window > 0 ? repeatCount / window : 0,
      };
      if (closeFailure !== null) normalized.closeFailure = closeFailure;
      const used = Object.keys(normalized) as AbsorptionComponent[];
      let num = 0;
      let den = 0;
      for (const key of used) { num += w[key] * (normalized[key] as number); den += w[key]; }
      const score = den > 0 ? Math.round((100 * num / den) * 100) / 100 : 0;
      if (score < config.minScore) continue;

      found.push({
        timestamp: candle.timestamp,
        price: row.price,
        side,
        absorbedBy: side === "ask" ? "sellers" : "buyers",
        absorptionScore: score,
        state: "detected",
        candleComplete: candle.complete === true,
        raw: {
          aggressiveVolume: aggressive,
          oppositeVolume: opposite,
          delta: row.ask - row.bid,
          clusterVolume,
          clusterDelta,
          volumeZScore: z,
          aggressiveShare: share,
          concentration,
          expectedConcentration,
          priceDisplacementSteps: displacement,
          displacementRatio,
          expectedRangeSteps: expectedRange,
          closeFailure,
          repeatCount,
          persistenceWindow: window,
        },
        normalized,
        componentsUsed: used,
      });
    }
    // Supresión de no-máximos: la detección se ancla en el nivel con MAYOR volumen agresivo del
    // vecindario (el nivel donde realmente se concentró la agresión); empates -> mayor score, luego menor precio.
    found.sort((a, b) =>
      b.raw.aggressiveVolume - a.raw.aggressiveVolume || b.absorptionScore - a.absorptionScore || a.price - b.price);
    const kept: AbsorptionDetection[] = [];
    for (const d of found) {
      if (kept.length >= config.maxDetectionsPerSide) break;
      if (kept.every(k => Math.abs(toIndex(k.price, step) - toIndex(d.price, step)) >= config.suppressionSteps)) kept.push(d);
    }
    detections.push(...kept);
  }
  detections.sort((a, b) => a.price - b.price || (a.side === "ask" ? -1 : 1));
  return { ...base, state: detections.length > 0 ? "detected" : "none", detections };
}

export class AbsorptionEngine {
  readonly config: AbsorptionConfig;

  constructor(config?: Partial<AbsorptionConfig>) {
    this.config = mergeConfig(config);
  }

  evaluateAt(candles: readonly AbsorptionCandleInput[], index: number, step: number): AbsorptionCandleResult {
    return evaluateAbsorptionAt(candles, index, step, this.config);
  }

  /** Evalúa desde `fromIndex` hasta el final (procesamiento incremental: pasa solo la cola cambiada). */
  evaluateFrom(candles: readonly AbsorptionCandleInput[], fromIndex: number, step: number): AbsorptionCandleResult[] {
    const out: AbsorptionCandleResult[] = [];
    for (let i = Math.max(0, fromIndex); i < candles.length; i += 1) out.push(this.evaluateAt(candles, i, step));
    return out;
  }

  evaluateAll(candles: readonly AbsorptionCandleInput[], step: number): AbsorptionCandleResult[] {
    return this.evaluateFrom(candles, 0, step);
  }
}
