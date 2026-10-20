/**
 * Motor de Order Book (liquidez PASIVA) para el módulo DOM.
 *
 * - No conoce a ningún proveedor: recibe un snapshot y diffs ya normalizados
 *   (el adaptador del proveedor se encarga de la secuenciación del protocolo).
 * - No usa aggTrades: aquí solo existe liquidez pasiva (órdenes límite).
 * - Los precios se almacenan como índice entero de tick (`Math.round(precio / tickSize)`),
 *   nunca como strings redondeados; el redondeo solo ocurre al exponer la vista.
 * - Estado en `Map<tickIndex, size>` + arrays ordenados en caché (se reconstruyen
 *   solo cuando hubo cambios), así no se reconstruye el libro en cada tick.
 * - Sin datos sintéticos: si no hay lado bid o ask válido, los campos son `null`.
 */

import { computeMicroPrice, computeObi } from "./formulas";

export type RawLevelTuple = readonly [price: number, size: number];

export interface OrderBookSnapshotInput {
  lastUpdateId: number;
  bids: readonly RawLevelTuple[];
  asks: readonly RawLevelTuple[];
  timestamp: number;
}

export interface OrderBookDiffInput {
  finalUpdateId: number;
  bids: readonly RawLevelTuple[];
  asks: readonly RawLevelTuple[];
  timestamp: number;
}

/** [precio, tamaño pasivo, tendencia: 1 = stacking, -1 = pulling, 0 = ninguna] */
export type BookLevelTuple = readonly [price: number, size: number, trend: -1 | 0 | 1];

export type BookPressure = "BUY" | "SELL" | "NEUTRAL";
export type LiquidityState = "Thin" | "Normal" | "Heavy";

export interface OrderBookView {
  symbol: string;
  tickSize: number;
  /** Multiplicador de agrupación de ticks aplicado a esta vista (1 = sin agrupar). */
  group: number;
  /** Niveles pedidos por lado. */
  depth: number;
  updatedAt: number;
  lastUpdateId: number;
  /** Mejor → peor (precio descendente). */
  bids: BookLevelTuple[];
  /** Mejor → peor (precio ascendente). */
  asks: BookLevelTuple[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  mid: number | null;
  bidTotal: number;
  askTotal: number;
  /** L_max: mayor tamaño entre todos los niveles visibles (0 = sin liquidez). */
  maxSize: number;
  /** (ΣL_bid − ΣL_ask) / (ΣL_bid + ΣL_ask) sobre los niveles visibles; null si la suma es 0. */
  imbalance: number | null;
  /**
   * MicroPrice del mejor nivel visible: (Q_bid·P_ask + Q_ask·P_bid) / (Q_bid + Q_ask).
   * null si el libro está vacío o cruzado. Campo opcional: solo informativo.
   */
  microPrice?: number | null;
  /**
   * OBI sobre los primeros N niveles visibles (del mejor hacia fuera).
   * null por N si no hay liquidez. Campo opcional: solo informativo.
   */
  obi?: { n5: number | null; n10: number | null; n20: number | null };
  pressure: BookPressure | null;
  liquidity: { state: LiquidityState | null; percentile: number | null; samples: number };
  flow: { stackingQty: number; pullingQty: number; stackingShare: number | null };
}

export interface OrderBookEngineOptions {
  symbol: string;
  tickSize: number;
  /** Tope de niveles por lado que se conservan en memoria (se podan los más lejanos). */
  maxLevelsPerSide?: number;
  /** Cada cuánto se muestrea el historial por nivel (ms). */
  sampleIntervalMs?: number;
  /** Muestras consecutivas que definen "persistente" para stacking/pulling. */
  historySamples?: number;
  /** Cambio relativo mínimo (sobre la primera muestra) para marcar stacking/pulling. */
  minRelativeChange?: number;
  /** Niveles por lado que se siguen en el historial. */
  trackLevels?: number;
}

export const LIQUIDITY_NEAR_LEVELS = 20;
export const LIQUIDITY_MIN_SAMPLES = 60;
export const LIQUIDITY_HISTORY = 600;
export const LIQUIDITY_THIN_PERCENTILE = 0.2;
export const LIQUIDITY_HEAVY_PERCENTILE = 0.8;

/* ------------------------------------------------------------------ */
/* Funciones puras (reutilizables por UI y tests)                       */
/* ------------------------------------------------------------------ */

/** DOM Imbalance = (ΣBid − ΣAsk) / (ΣBid + ΣAsk). Nunca NaN/Infinity: devuelve null si la suma es 0. */
export function computeDomImbalance(bidTotal: number, askTotal: number): number | null {
  if (!Number.isFinite(bidTotal) || !Number.isFinite(askTotal)) return null;
  const sum = bidTotal + askTotal;
  if (!(sum > 0)) return null;
  return (bidTotal - askTotal) / sum;
}

/**
 * Etiqueta derivada del valor: signo del imbalance tal como se muestra
 * (porcentaje con 1 decimal). Si redondea a 0.0% es NEUTRAL.
 */
export function pressureFromImbalance(imbalance: number | null): BookPressure | null {
  if (imbalance === null || !Number.isFinite(imbalance)) return null;
  const shown = Math.round(imbalance * 1000) / 10;
  if (shown > 0) return "BUY";
  if (shown < 0) return "SELL";
  return "NEUTRAL";
}

/** Ancho de barra = (L / L_max) × ancho máximo. Con L_max = 0 no hay barra. */
export function barWidth(size: number, maxSize: number, maxWidthPx: number): number {
  if (!(maxSize > 0) || !(size > 0) || !(maxWidthPx > 0)) return 0;
  return Math.min(1, size / maxSize) * maxWidthPx;
}

/** Fracción de muestras del historial estrictamente menores que `value` (0..1). */
export function percentRank(history: readonly number[], value: number): number | null {
  if (history.length === 0 || !Number.isFinite(value)) return null;
  let below = 0;
  let equal = 0;
  for (const sample of history) {
    if (sample < value) below += 1;
    else if (sample === value) equal += 1;
  }
  return (below + equal / 2) / history.length;
}

const roundPrice = (value: number): number => Number(value.toPrecision(15));

/* ------------------------------------------------------------------ */
/* Motor                                                                */
/* ------------------------------------------------------------------ */

interface LevelHistory {
  samples: number[];
}

export class OrderBookEngine {
  readonly symbol: string;
  readonly tickSize: number;

  private readonly maxLevelsPerSide: number;
  private readonly sampleIntervalMs: number;
  private readonly historySamples: number;
  private readonly minRelativeChange: number;
  private readonly trackLevels: number;

  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();
  private bidIdx: number[] = [];
  private askIdx: number[] = [];
  private dirty = true;

  private ready = false;
  private lastUpdateId = 0;
  private updatedAt = 0;
  private lastSampleAt = 0;
  private readonly bidHistory = new Map<number, LevelHistory>();
  private readonly askHistory = new Map<number, LevelHistory>();
  private readonly liquidityHistory: number[] = [];

  constructor(options: OrderBookEngineOptions) {
    if (!Number.isFinite(options.tickSize) || options.tickSize <= 0) {
      throw new Error(`OrderBookEngine requires a positive tickSize (got ${options.tickSize})`);
    }
    this.symbol = options.symbol.toUpperCase();
    this.tickSize = options.tickSize;
    this.maxLevelsPerSide = Math.max(50, Math.floor(options.maxLevelsPerSide ?? 3_000));
    this.sampleIntervalMs = Math.max(50, options.sampleIntervalMs ?? 500);
    this.historySamples = Math.max(3, Math.floor(options.historySamples ?? 6));
    this.minRelativeChange = Math.max(0, options.minRelativeChange ?? 0.25);
    this.trackLevels = Math.max(10, Math.floor(options.trackLevels ?? 120));
  }

  /** Limpia TODO el estado (cambio de símbolo, resync, reconexión). */
  reset(): void {
    this.bids.clear();
    this.asks.clear();
    this.bidIdx = [];
    this.askIdx = [];
    this.dirty = true;
    this.ready = false;
    this.lastUpdateId = 0;
    this.updatedAt = 0;
    this.lastSampleAt = 0;
    this.bidHistory.clear();
    this.askHistory.clear();
    this.liquidityHistory.length = 0;
  }

  isReady(): boolean {
    return this.ready;
  }

  getLastUpdateId(): number {
    return this.lastUpdateId;
  }

  levelCount(): { bids: number; asks: number } {
    return { bids: this.bids.size, asks: this.asks.size };
  }

  applySnapshot(input: OrderBookSnapshotInput): void {
    this.reset();
    this.applyLevels(this.bids, input.bids);
    this.applyLevels(this.asks, input.asks);
    this.lastUpdateId = input.lastUpdateId;
    this.updatedAt = input.timestamp;
    this.ready = true;
    this.dirty = true;
    this.prune();
  }

  /**
   * Aplica un diff incremental. Devuelve false si se ignora (libro sin snapshot
   * o diff antiguo). Tamaño 0 elimina el nivel: nunca queda liquidez fantasma.
   */
  applyDiff(input: OrderBookDiffInput): boolean {
    if (!this.ready) return false;
    if (input.finalUpdateId <= this.lastUpdateId) return false;
    this.applyLevels(this.bids, input.bids);
    this.applyLevels(this.asks, input.asks);
    this.lastUpdateId = input.finalUpdateId;
    this.updatedAt = input.timestamp;
    this.dirty = true;
    this.prune();
    this.sampleIfDue(input.timestamp);
    return true;
  }

  /** true si el mejor bid alcanza o supera al mejor ask (dato inconsistente → resync). */
  isCrossed(): boolean {
    this.ensureSorted();
    if (this.bidIdx.length === 0 || this.askIdx.length === 0) return false;
    return this.bidIdx[0] >= this.askIdx[0];
  }

  getView(depth: number, group = 1): OrderBookView {
    this.ensureSorted();
    const levelsWanted = Math.max(1, Math.floor(depth));
    const mult = Math.max(1, Math.floor(group));
    const bids = this.collect("bid", levelsWanted, mult);
    const asks = this.collect("ask", levelsWanted, mult);

    let bidTotal = 0;
    let askTotal = 0;
    let maxSize = 0;
    let stackingQty = 0;
    let pullingQty = 0;
    for (const level of bids.levels) {
      bidTotal += level[1];
      if (level[1] > maxSize) maxSize = level[1];
    }
    for (const level of asks.levels) {
      askTotal += level[1];
      if (level[1] > maxSize) maxSize = level[1];
    }
    stackingQty = bids.stackingQty + asks.stackingQty;
    pullingQty = bids.pullingQty + asks.pullingQty;

    const bestBid = this.bidIdx.length > 0 ? roundPrice(this.bidIdx[0] * this.tickSize) : null;
    const bestAsk = this.askIdx.length > 0 ? roundPrice(this.askIdx[0] * this.tickSize) : null;
    const spread = bestBid !== null && bestAsk !== null ? roundPrice(bestAsk - bestBid) : null;
    const mid = bestBid !== null && bestAsk !== null ? roundPrice((bestBid + bestAsk) / 2) : null;
    const imbalance = computeDomImbalance(bidTotal, askTotal);

    // MicroPrice y OBI_N: métricas informativas sobre los niveles visibles.
    // No alteran `imbalance` ni ningún otro campo existente.
    const bestBidQty = bids.levels.length > 0 ? bids.levels[0][1] : null;
    const bestAskQty = asks.levels.length > 0 ? asks.levels[0][1] : null;
    const microPrice =
      bestBid !== null && bestAsk !== null && bestBidQty !== null && bestAskQty !== null
        ? computeMicroPrice({ bidPrice: bestBid, bidQty: bestBidQty, askPrice: bestAsk, askQty: bestAskQty })
        : null;
    const obi = {
      n5: computeObi(bids.levels, asks.levels, 5),
      n10: computeObi(bids.levels, asks.levels, 10),
      n20: computeObi(bids.levels, asks.levels, 20),
    };

    const liquiditySamples = this.liquidityHistory.length;
    let liquidityState: LiquidityState | null = null;
    let percentile: number | null = null;
    if (liquiditySamples >= LIQUIDITY_MIN_SAMPLES) {
      percentile = percentRank(this.liquidityHistory, this.nearLiquidity());
      if (percentile !== null) {
        liquidityState =
          percentile <= LIQUIDITY_THIN_PERCENTILE
            ? "Thin"
            : percentile >= LIQUIDITY_HEAVY_PERCENTILE
              ? "Heavy"
              : "Normal";
      }
    }

    const moved = stackingQty + pullingQty;
    return {
      symbol: this.symbol,
      tickSize: this.tickSize,
      group: mult,
      depth: levelsWanted,
      updatedAt: this.updatedAt,
      lastUpdateId: this.lastUpdateId,
      bids: bids.levels,
      asks: asks.levels,
      bestBid,
      bestAsk,
      spread,
      mid,
      bidTotal,
      askTotal,
      maxSize,
      imbalance,
      microPrice,
      obi,
      pressure: pressureFromImbalance(imbalance),
      liquidity: { state: liquidityState, percentile, samples: liquiditySamples },
      flow: { stackingQty, pullingQty, stackingShare: moved > 0 ? stackingQty / moved : null },
    };
  }

  /* ---------------------------------------------------------------- */

  private applyLevels(book: Map<number, number>, levels: readonly RawLevelTuple[]): void {
    for (const level of levels) {
      const price = level[0];
      const size = level[1];
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size)) continue;
      const idx = Math.round(price / this.tickSize);
      if (size <= 0) book.delete(idx);
      else book.set(idx, size);
    }
  }

  private ensureSorted(): void {
    if (!this.dirty) return;
    this.bidIdx = [...this.bids.keys()].sort((a, b) => b - a);
    this.askIdx = [...this.asks.keys()].sort((a, b) => a - b);
    this.dirty = false;
  }

  private prune(): void {
    if (this.bids.size <= this.maxLevelsPerSide && this.asks.size <= this.maxLevelsPerSide) return;
    this.dirty = true;
    this.ensureSorted();
    for (let i = this.maxLevelsPerSide; i < this.bidIdx.length; i += 1) this.bids.delete(this.bidIdx[i]);
    for (let i = this.maxLevelsPerSide; i < this.askIdx.length; i += 1) this.asks.delete(this.askIdx[i]);
    this.dirty = true;
  }

  private sampleIfDue(now: number): void {
    if (this.lastSampleAt !== 0 && now - this.lastSampleAt < this.sampleIntervalMs) return;
    this.lastSampleAt = now;
    this.ensureSorted();
    this.sampleSide(this.bids, this.bidIdx, this.bidHistory);
    this.sampleSide(this.asks, this.askIdx, this.askHistory);
    this.liquidityHistory.push(this.nearLiquidity());
    if (this.liquidityHistory.length > LIQUIDITY_HISTORY) this.liquidityHistory.shift();
  }

  private sampleSide(
    book: Map<number, number>,
    sorted: readonly number[],
    history: Map<number, LevelHistory>,
  ): void {
    const tracked = new Set<number>();
    const limit = Math.min(this.trackLevels, sorted.length);
    for (let i = 0; i < limit; i += 1) {
      const idx = sorted[i];
      const size = book.get(idx);
      if (size === undefined) continue;
      tracked.add(idx);
      let record = history.get(idx);
      if (!record) {
        record = { samples: [] };
        history.set(idx, record);
      }
      record.samples.push(size);
      if (record.samples.length > this.historySamples) record.samples.shift();
    }
    for (const idx of [...history.keys()]) {
      if (!tracked.has(idx)) history.delete(idx);
    }
  }

  private nearLiquidity(): number {
    let total = 0;
    const bidLimit = Math.min(LIQUIDITY_NEAR_LEVELS, this.bidIdx.length);
    const askLimit = Math.min(LIQUIDITY_NEAR_LEVELS, this.askIdx.length);
    for (let i = 0; i < bidLimit; i += 1) total += this.bids.get(this.bidIdx[i]) ?? 0;
    for (let i = 0; i < askLimit; i += 1) total += this.asks.get(this.askIdx[i]) ?? 0;
    return total;
  }

  /**
   * Stacking = el nivel creció de forma persistente (todas las muestras no
   * decrecientes, ventana completa) y ganó al menos `minRelativeChange` sobre la
   * primera muestra. Pulling = lo contrario. Con ventana incompleta → sin tendencia.
   */
  private levelTrend(history: LevelHistory | undefined): { trend: -1 | 0 | 1; net: number } {
    if (!history || history.samples.length < this.historySamples) return { trend: 0, net: 0 };
    const s = history.samples;
    const first = s[0];
    const last = s[s.length - 1];
    const net = last - first;
    if (net === 0 || !(first > 0)) return { trend: 0, net: 0 };
    let rising = true;
    let falling = true;
    for (let i = 1; i < s.length; i += 1) {
      if (s[i] < s[i - 1]) rising = false;
      if (s[i] > s[i - 1]) falling = false;
    }
    const relative = Math.abs(net) / first;
    if (rising && net > 0 && relative >= this.minRelativeChange) return { trend: 1, net };
    if (falling && net < 0 && relative >= this.minRelativeChange) return { trend: -1, net };
    return { trend: 0, net: 0 };
  }

  private collect(
    side: "bid" | "ask",
    depth: number,
    mult: number,
  ): { levels: BookLevelTuple[]; stackingQty: number; pullingQty: number } {
    const book = side === "bid" ? this.bids : this.asks;
    const sorted = side === "bid" ? this.bidIdx : this.askIdx;
    const history = side === "bid" ? this.bidHistory : this.askHistory;
    const levels: BookLevelTuple[] = [];
    let stackingQty = 0;
    let pullingQty = 0;

    let bucket: number | null = null;
    let size = 0;
    let net = 0;
    let singleTrend: -1 | 0 | 1 = 0;
    let members = 0;

    const flush = () => {
      if (bucket === null) return;
      let trend: -1 | 0 | 1 = 0;
      if (mult === 1) trend = singleTrend;
      else if (size > 0 && Math.abs(net) / size >= this.minRelativeChange) trend = net > 0 ? 1 : -1;
      if (trend === 1) stackingQty += Math.abs(net);
      else if (trend === -1) pullingQty += Math.abs(net);
      levels.push([roundPrice(bucket * this.tickSize), size, trend]);
    };

    for (const idx of sorted) {
      const nextBucket = mult === 1 ? idx : side === "bid" ? Math.floor(idx / mult) * mult : Math.ceil(idx / mult) * mult;
      if (bucket !== nextBucket) {
        flush();
        if (levels.length >= depth) {
          bucket = null;
          break;
        }
        bucket = nextBucket;
        size = 0;
        net = 0;
        singleTrend = 0;
        members = 0;
      }
      size += book.get(idx) ?? 0;
      const lt = this.levelTrend(history.get(idx));
      net += lt.net;
      if (mult === 1) singleTrend = lt.trend;
      members += 1;
    }
    if (bucket !== null && levels.length < depth && members > 0) flush();
    return { levels, stackingQty, pullingQty };
  }
}
