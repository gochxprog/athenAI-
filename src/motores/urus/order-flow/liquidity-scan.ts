/**
 * Deep Liquidity Scan (URUS): ranking de muros de liquidez pasiva cercanos al precio medio.
 * Función pura (sin I/O) sobre el `OrderBookView` real: no inventa niveles ni tamaños.
 *
 * Un "muro" es un nivel cuyo tamaño es ≥ `minRatio` veces la mediana de los tamaños de su lado
 * (niveles visibles con tamaño > 0). Es liquidez pasiva visible: puede retirarse en cualquier momento.
 */
import type { BookLevelTuple, OrderBookView } from "./order-book";

export interface LiquidityWall {
  side: "bid" | "ask";
  price: number;
  size: number;
  /** size / mediana del lado. */
  ratio: number;
  /** |price − mid| en unidades de precio. */
  distance: number;
  /** Distancia al mid medida en cubos de precio (tickSize × group). */
  distanceBuckets: number;
  /** Stacking (1) / Pulling (-1) / sin cambio (0), tal como lo entrega el libro. */
  trend: -1 | 0 | 1;
}

export interface LiquidityScanOptions {
  /** Máximo de filas devueltas. Por defecto 12. */
  maxRows?: number;
  /** Tamaño mínimo como múltiplo de la mediana del lado. Por defecto 3. */
  minRatio?: number;
  /** Alcance máximo desde el mid, en cubos de precio. Por defecto 200. */
  rangeBuckets?: number;
}

export const LIQUIDITY_SCAN_DEFAULTS = { maxRows: 12, minRatio: 3, rangeBuckets: 200 } as const;

type ScanView = Pick<OrderBookView, "bids" | "asks" | "mid" | "tickSize" | "group">;

/** Mediana de los tamaños finitos y > 0; 0 si no hay ninguno. */
export function medianSize(levels: readonly BookLevelTuple[]): number {
  const sizes: number[] = [];
  for (const level of levels) {
    const size = level[1];
    if (Number.isFinite(size) && size > 0) sizes.push(size);
  }
  if (sizes.length === 0) return 0;
  sizes.sort((a, b) => a - b);
  const mid = sizes.length >> 1;
  return sizes.length % 2 === 1 ? sizes[mid] : (sizes[mid - 1] + sizes[mid]) / 2;
}

function wallsOfSide(
  side: "bid" | "ask",
  levels: readonly BookLevelTuple[],
  mid: number,
  bucketPx: number,
  minRatio: number,
  rangeBuckets: number,
): LiquidityWall[] {
  const median = medianSize(levels);
  if (median <= 0) return [];
  const out: LiquidityWall[] = [];
  for (const [price, size, trend] of levels) {
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) continue;
    const ratio = size / median;
    if (ratio < minRatio) continue;
    const distance = Math.abs(price - mid);
    const distanceBuckets = distance / bucketPx;
    if (distanceBuckets > rangeBuckets) continue;
    out.push({ side, price, size, ratio, distance, distanceBuckets, trend: trend === 1 || trend === -1 ? trend : 0 });
  }
  return out;
}

/** Muros de ambos lados ordenados por tamaño descendente (empate: el más cercano al mid primero). */
export function scanLiquidityWalls(view: ScanView | null | undefined, options: LiquidityScanOptions = {}): LiquidityWall[] {
  if (!view || view.mid === null || !Number.isFinite(view.mid)) return [];
  const bucketPx = view.tickSize * view.group;
  if (!Number.isFinite(bucketPx) || bucketPx <= 0) return [];
  const maxRows = Math.max(0, Math.floor(options.maxRows ?? LIQUIDITY_SCAN_DEFAULTS.maxRows));
  const minRatio = Number.isFinite(options.minRatio) ? Math.max(1, options.minRatio as number) : LIQUIDITY_SCAN_DEFAULTS.minRatio;
  const rangeBuckets = Number.isFinite(options.rangeBuckets) ? Math.max(0, options.rangeBuckets as number) : LIQUIDITY_SCAN_DEFAULTS.rangeBuckets;
  const walls = [
    ...wallsOfSide("bid", view.bids, view.mid, bucketPx, minRatio, rangeBuckets),
    ...wallsOfSide("ask", view.asks, view.mid, bucketPx, minRatio, rangeBuckets),
  ];
  walls.sort((a, b) => b.size - a.size || a.distance - b.distance);
  return walls.slice(0, maxRows);
}
