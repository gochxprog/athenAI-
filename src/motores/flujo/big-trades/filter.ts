/**
 * Filtro de Big Trades (puro, sin dependencias) — referencia de la regla de decisión.
 *
 * M10: esta función replica EXACTAMENTE la regla de `BigTradeDetector.closeBlock`
 * (shared/big-trades/engine.ts), incluyendo el requisito de muestras mínimas: el
 * motor solo considera el Z-score cuando la ventana estadística tiene al menos
 * `minZSamples` bloques (y emite `z_score: 0` en caso contrario).
 *
 * Regla: AND estricto cuando ambos filtros están activos; si solo uno está
 * activo, se respeta ese único filtro. El invariante del motor garantiza que al
 * menos uno esté activo (ver `normalizeBigTradeConfig`).
 */
export interface TradeCandidate {
  notionalUSD: number;
  /** Z-score sobre volumen; 0 cuando no hubo muestras suficientes (igual que el motor). */
  zScore: number;
  /** Bloques en la ventana estadística al momento de evaluar. */
  sampleCount: number;
}

export interface BigTradeFilterConfig {
  minNotionalUSD: number;
  minZScore: number;
  minZSamples: number;
  useNotionalFilter: boolean;
  useZScoreFilter: boolean;
}

export function evaluateBigTradeFilter(trade: TradeCandidate, config: BigTradeFilterConfig): boolean {
  const passUsd =
    config.useNotionalFilter &&
    Number.isFinite(trade.notionalUSD) &&
    trade.notionalUSD >= config.minNotionalUSD;
  const passZ =
    config.useZScoreFilter &&
    Number.isFinite(trade.zScore) &&
    trade.sampleCount >= config.minZSamples &&
    trade.zScore >= config.minZScore;
  const bothFilters = config.useNotionalFilter && config.useZScoreFilter;
  return bothFilters ? passUsd && passZ : passUsd || passZ;
}
