/**
 * FÓRMULAS DE REFERENCIA DE MICROESTRUCTURA (puras, sin I/O, sin estado).
 * Fuente única de verdad para Footprint, Imbalance diagonal, MicroPrice, OBI y Absorción.
 */

export const DEFAULT_IMBALANCE_RATIO = 3.0;
export const ABSORPTION_EPSILON = 0.0001;

export interface LevelQty {
  readonly price: number;
  readonly bidQty: number;
  readonly askQty: number;
}

/* ---------------- a) Footprint ---------------- */

/** Volume(p) = bidQty(p) + askQty(p) */
export const levelVolume = (level: Pick<LevelQty, "bidQty" | "askQty">): number => level.bidQty + level.askQty;

/** Delta(p) = askQty(p) - bidQty(p) */
export const levelDelta = (level: Pick<LevelQty, "bidQty" | "askQty">): number => level.askQty - level.bidQty;

/** Delta_vela = Σ Delta(p) */
export function candleDelta(levels: readonly Pick<LevelQty, "bidQty" | "askQty">[]): number {
  let sum = 0;
  for (const level of levels) sum += levelDelta(level);
  return sum;
}

/* ---------------- b) Imbalance diagonal ---------------- */

export interface DiagonalImbalanceOptions {
  /** Umbral del cociente. Por defecto 3.0. */
  readonly ratioThreshold?: number;
  /** Denominador 0 con numerador > 0: true = cuenta como imbalance (ratio ∞). */
  readonly zeroDenominatorCounts?: boolean;
  /** Fila donde se marca el Sell Imbalance: "bidRow" = Bid[P]/Ask[P+tick] (convención ATAS); "askRow" = Bid[P−tick]/Ask[P]. */
  readonly sellMarkRow?: "bidRow" | "askRow";
}

export interface DiagonalImbalance {
  readonly price: number;
  readonly buy: boolean;
  readonly sell: boolean;
  readonly buyRatio: number | null;
  readonly sellRatio: number | null;
}

/** numerador/denominador >= umbral → ratio; en otro caso null. Nunca devuelve NaN. */
export function diagonalRatio(
  numerator: number,
  denominator: number,
  ratioThreshold: number = DEFAULT_IMBALANCE_RATIO,
  zeroDenominatorCounts = true,
): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !(numerator > 0) || denominator < 0) return null;
  if (denominator > 0) {
    const ratio = numerator / denominator;
    return ratio >= ratioThreshold ? ratio : null;
  }
  return zeroDenominatorCounts ? Number.POSITIVE_INFINITY : null;
}

/**
 * Buy_Imbalance(p)  = askQty(p) / bidQty(p − tick) >= umbral
 * Sell_Imbalance    = bidQty(p − tick) / askQty(p) >= umbral   (mismo par de niveles; ver `sellMarkRow`)
 * Las filas sin contraparte dentro del rango no se evalúan.
 */
export function computeDiagonalImbalances(
  levels: readonly LevelQty[],
  tickSize: number,
  options: DiagonalImbalanceOptions = {},
): DiagonalImbalance[] {
  if (!(tickSize > 0) || !Number.isFinite(tickSize)) throw new Error("Invalid tickSize");
  const { ratioThreshold = DEFAULT_IMBALANCE_RATIO, zeroDenominatorCounts = true, sellMarkRow = "bidRow" } = options;
  const toIdx = (price: number): number => Math.round(price / tickSize);

  const bidAt = new Map<number, number>();
  const askAt = new Map<number, number>();
  let minIdx = Number.POSITIVE_INFINITY;
  let maxIdx = Number.NEGATIVE_INFINITY;
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !(level.bidQty >= 0) || !(level.askQty >= 0)) continue;
    const idx = toIdx(level.price);
    bidAt.set(idx, (bidAt.get(idx) ?? 0) + level.bidQty);
    askAt.set(idx, (askAt.get(idx) ?? 0) + level.askQty);
    if (idx < minIdx) minIdx = idx;
    if (idx > maxIdx) maxIdx = idx;
  }

  return [...new Set([...bidAt.keys()])]
    .sort((a, b) => a - b)
    .map(idx => {
      const bid = bidAt.get(idx) ?? 0;
      const ask = askAt.get(idx) ?? 0;
      const buyRatio = idx > minIdx ? diagonalRatio(ask, bidAt.get(idx - 1) ?? 0, ratioThreshold, zeroDenominatorCounts) : null;
      const sellRatio =
        sellMarkRow === "bidRow"
          ? idx < maxIdx ? diagonalRatio(bid, askAt.get(idx + 1) ?? 0, ratioThreshold, zeroDenominatorCounts) : null
          : idx > minIdx ? diagonalRatio(bidAt.get(idx - 1) ?? 0, ask, ratioThreshold, zeroDenominatorCounts) : null;
      return { price: idx * tickSize, buy: buyRatio !== null, sell: sellRatio !== null, buyRatio, sellRatio };
    });
}

/* ---------------- c) MicroPrice y OBI ---------------- */

export interface TopOfBook {
  readonly bidPrice: number;
  readonly bidQty: number;
  readonly askPrice: number;
  readonly askQty: number;
}

/** MicroPrice = (Q_bid·P_ask + Q_ask·P_bid) / (Q_bid + Q_ask). null si el libro es inválido, está cruzado o Q_bid+Q_ask <= 0. */
export function computeMicroPrice(top: TopOfBook): number | null {
  const { bidPrice, bidQty, askPrice, askQty } = top;
  if (![bidPrice, bidQty, askPrice, askQty].every(Number.isFinite)) return null;
  if (!(bidPrice > 0) || !(askPrice > 0) || bidPrice > askPrice || bidQty < 0 || askQty < 0) return null;
  const total = bidQty + askQty;
  if (!(total > 0)) return null;
  return (bidQty * askPrice + askQty * bidPrice) / total;
}

export type BookLevel = readonly [price: number, qty: number, ...rest: number[]];

function sumQty(levels: readonly BookLevel[], n: number): number {
  let sum = 0;
  const limit = Math.min(n, levels.length);
  for (let i = 0; i < limit; i += 1) sum += levels[i][1];
  return sum;
}

/**
 * OBI_N = (ΣQ_bid(N) − ΣQ_ask(N)) / (ΣQ_bid(N) + ΣQ_ask(N)), en [-1, 1].
 * `bids` y `asks` ordenados del MEJOR nivel hacia fuera. null si N no es entero >= 1 o la suma es 0.
 */
export function computeObi(bids: readonly BookLevel[], asks: readonly BookLevel[], n: number): number | null {
  if (!Number.isInteger(n) || n < 1) return null;
  const bid = sumQty(bids, n);
  const ask = sumQty(asks, n);
  const total = bid + ask;
  if (!Number.isFinite(total) || !(total > 0)) return null;
  return (bid - ask) / total;
}

/* ---------------- d) Índice de absorción ---------------- */

/** ΔPrice de la vela en unidades de PRECIO (no ticks): close − open. */
export const candlePriceDelta = (open: number, close: number): number => close - open;

/**
 * AbsorptionIndex = Volume(p) / (|ΔPrice| + 0.0001).
 * Mucho volumen con poco desplazamiento de precio = índice alto. null si las entradas no son finitas o volume < 0.
 */
export function computeAbsorptionIndex(volume: number, priceDelta: number, epsilon: number = ABSORPTION_EPSILON): number | null {
  if (!Number.isFinite(volume) || !Number.isFinite(priceDelta) || !(volume >= 0) || !(epsilon > 0)) return null;
  return volume / (Math.abs(priceDelta) + epsilon);
}
