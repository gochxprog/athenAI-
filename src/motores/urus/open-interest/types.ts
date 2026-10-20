import type { NormalizedCandle } from "../market-data/types";

export interface OpenInterestSnapshot {
  symbol: string;
  time: number;
  oiContracts: number;
  oiValue: number | null;
  markPrice: number | null;
  source: "poll" | "hist";
}

export interface OpenInterestCandlePoint {
  candleTime: number;
  close: number;
  oiContracts: number | null;
  oiUsd: number | null;
  snapshotTime: number | null;
  ageMs: number | null;
  stale: boolean;
  gap: boolean;
  /** F3: |z(ΔOI)| > 5 — pico anómalo, no se propaga como lectura válida. */
  anomaly: boolean;
  deltaOi: number | null;
  deltaOiPct: number | null;
  turnover: number | null;
  deltaOiZ: number | null;
  deltaOiPctZ: number | null;
  oiUsdPercentile: number | null;
  quadrant: OpenInterestQuadrant | "neutral" | null;
  aggressiveDelta: number | null;
  flowSignal: OpenInterestFlowSignal | null;
  flowConfidence: number | null;
  flush: boolean;
  silentAccumulation: boolean;
  divergence: "bullish" | "bearish" | null;
}

export type OpenInterestQuadrant =
  | "longs_nuevos"
  | "cobertura_shorts"
  | "shorts_nuevos"
  | "liquidacion_longs";

export type OpenInterestFlowSignal =
  | "compradores_abren_longs"
  | "squeeze_cobertura"
  | "vendedores_abren_shorts"
  | "capitulacion_longs";

export interface OpenInterestProfileBucket {
  price: number;
  longOpen: number;
  shortOpen: number;
  net: number;
}

export interface OpenInterestProfile {
  buckets: OpenInterestProfileBucket[];
  longsTrapped: number;
  shortsTrapped: number;
  topClusters: OpenInterestProfileBucket[];
  inferred: true;
}

export interface OpenInterestEngineOptions {
  pollIntervalMs?: number;
  staleMultiplier?: number;
  robustWindow?: number;
  percentileWindowDays?: number;
  neutralPriceEpsilon?: number;
  neutralZ?: number;
  flowZMin?: number;
  flowZMax?: number;
  flushZ?: number;
  flushAtrK?: number;
  accumulationZ?: number;
  accumulationAtrK?: number;
  atrPeriod?: number;
  divergenceWindow?: number;
  divergenceSlopeThreshold?: number;
  profileTopK?: number;
  /** Reloj inyectado: la edad de una vela aún abierta se mide contra min(cierre, ahora). */
  nowMs?: number;
}

export interface OpenInterestEngineResult {
  symbol: string;
  points: OpenInterestCandlePoint[];
  profile: OpenInterestProfile | null;
}

export interface OpenInterestCandleInput extends NormalizedCandle {
  /** Candle close timestamp when the provider exposes candle-open timestamps. */
  closeTime?: number;
  /** Existing order-flow delta; the OI engine never recalculates it. */
  delta?: number;
}
