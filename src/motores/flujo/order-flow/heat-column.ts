import type { OrderBookView } from "./order-book";

/**
 * Columna del Heatmap de liquidez: foto del libro agrupada por buckets de precio.
 * Compartida por el cliente (LiquidityHistory) y el servidor (HeatRecorder) para que ambos
 * usen EXACTAMENTE la misma indexación: idx = round(precio / step), step = tickSize × group.
 */
export interface HeatColumn {
  t: number;
  step: number;
  minIdx: number;
  /** idx <= bestBidIdx es bid; idx > bestBidIdx es ask. */
  bestBidIdx: number;
  /** sizes[i] = liquidez del bucket (minIdx + i); 0 = sin orden. */
  sizes: Float32Array;
}

export const HEAT_MAX_SPAN_LEVELS = 4_000;
/** Cada bucket ≈ 0,1 punto básico del precio (BTC a 85 000 ≈ 0,9 USD; 100 niveles ≈ ±90 USD). */
export const HEAT_BUCKET_FRACTION = 0.00001;
export const HEAT_MAX_GROUP = 1_000;

/** Agrupación de ticks que cubre un rango útil. Una por símbolo (el servidor la fija y la comparte). */
export function pickHeatGroup(referencePrice: number | null | undefined, tickSize: number): number {
  if (!(referencePrice && referencePrice > 0) || !(tickSize > 0)) return 1;
  return Math.min(HEAT_MAX_GROUP, Math.max(1, Math.round((referencePrice * HEAT_BUCKET_FRACTION) / tickSize)));
}

/** Vista del libro → columna densa. null si el libro está vacío o el rango es absurdo. */
export function viewToHeatColumn(view: OrderBookView, t: number): HeatColumn | null {
  if (view.bids.length === 0 || view.asks.length === 0) return null;
  const step = view.tickSize * view.group;
  if (!(step > 0) || !Number.isFinite(step)) return null;
  let minIdx = Number.POSITIVE_INFINITY;
  let maxIdx = Number.NEGATIVE_INFINITY;
  for (const level of view.bids) {
    const idx = Math.round(level[0] / step);
    if (idx < minIdx) minIdx = idx;
    if (idx > maxIdx) maxIdx = idx;
  }
  for (const level of view.asks) {
    const idx = Math.round(level[0] / step);
    if (idx < minIdx) minIdx = idx;
    if (idx > maxIdx) maxIdx = idx;
  }
  const span = maxIdx - minIdx + 1;
  if (!Number.isFinite(span) || span < 1 || span > HEAT_MAX_SPAN_LEVELS) return null;
  const sizes = new Float32Array(span);
  for (const level of view.bids) sizes[Math.round(level[0] / step) - minIdx] = level[1];
  for (const level of view.asks) sizes[Math.round(level[0] / step) - minIdx] = level[1];
  return { t, step, minIdx, bestBidIdx: Math.round(view.bids[0][0] / step), sizes };
}
