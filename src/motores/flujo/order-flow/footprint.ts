import type { AggTrade } from "../market-data/types";
export type { AggTrade } from "../market-data/types";
import {
  attachSignalsToCandles,
  DEFAULT_MICROSTRUCTURE_CONFIG,
  type FootprintCandleSignals,
  type MicrostructureConfig,
} from "./microstructure";
import { isBetterPoc } from "./poc";

export type FootprintSide = "bid" | "ask";

export interface FootprintLevel {
  price: number;
  bidQty: number;
  askQty: number;
  tradeCount: number;
  delta: number;
  volume: number;
}

export interface FootprintCandle {
  timestamp: number;
  timeframeMs: number;
  levels: FootprintLevel[];
  bidQty: number;
  askQty: number;
  delta: number;
  volume: number;
  pocPrice: number | null;
  complete: boolean;
  /** Integridad de ingesta: GAP = faltan aggTradeIds (probado); PARTIAL = no demostrada. Solo si `complete` es true es COMPLETE. */
  quality?: "COMPLETE" | "PARTIAL" | "GAP";
  /** Señales microestructurales calculadas por el motor compartido. */
  signals?: FootprintCandleSignals;
}

export interface FootprintAggregationOptions {
  timeframeMs: number;
  tickSize: number;
  priceMultiplier?: number;
  candleStart?: number;
  candleClose?: number;
  complete?: boolean;
}

interface MutableLevel {
  price: number;
  bidQty: number;
  askQty: number;
  tradeCount: number;
}

export function getFootprintSide(buyerIsMaker: boolean): FootprintSide {
  return buyerIsMaker ? "bid" : "ask";
}

export function getCandleStart(timestamp: number, timeframeMs: number): number {
  if (!Number.isFinite(timestamp) || !Number.isFinite(timeframeMs) || timeframeMs <= 0) throw new Error("Invalid timestamp or timeframe");
  return Math.floor(timestamp / timeframeMs) * timeframeMs;
}

export function getPriceLevel(price: number, tickSize: number, priceMultiplier = 1): number {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0 || !Number.isFinite(priceMultiplier) || priceMultiplier <= 0) throw new Error("Invalid price grouping configuration");
  const step = tickSize * priceMultiplier;
  // Preserve exact exchange-tick prices despite binary floating-point drift.
  // Values genuinely between ticks still use the existing floor grouping.
  const quotient = price / step;
  const nearest = Math.round(quotient);
  const index = Math.abs(quotient - nearest) < 1e-6 ? nearest : Math.floor(quotient);
  return roundToStep(index * step, step);
}

export function aggregateFootprintTrades(trades: readonly AggTrade[], options: FootprintAggregationOptions): FootprintCandle {
  const { timeframeMs, tickSize, priceMultiplier = 1 } = options;
  const candleStart = options.candleStart ?? getCandleStart(trades[0]?.timestamp ?? Date.now(), timeframeMs);
  const candleEnd = candleStart + timeframeMs;
  const levels = new Map<number, MutableLevel>();

  for (const trade of trades) {
    if (trade.timestamp < candleStart || trade.timestamp >= candleEnd) continue;
    if (![trade.price, trade.quantity, trade.timestamp, trade.aggTradeId].every(Number.isFinite) || trade.quantity < 0) continue;
    const price = getPriceLevel(trade.price, tickSize, priceMultiplier);
    const level = levels.get(price) ?? { price, bidQty: 0, askQty: 0, tradeCount: 0 };
    if (getFootprintSide(trade.buyerIsMaker) === "bid") level.bidQty += trade.quantity;
    else level.askQty += trade.quantity;
    level.tradeCount += 1;
    levels.set(price, level);
  }

  const finalizedLevels = [...levels.values()].sort((a, b) => a.price - b.price).map(level => ({
    ...level,
    delta: level.askQty - level.bidQty,
    volume: level.askQty + level.bidQty,
  }));
  const bidQty = finalizedLevels.reduce((sum, level) => sum + level.bidQty, 0);
  const askQty = finalizedLevels.reduce((sum, level) => sum + level.askQty, 0);
  const poc = selectPoc(finalizedLevels, options.candleClose);
  return {
    timestamp: candleStart,
    timeframeMs,
    levels: finalizedLevels,
    bidQty,
    askQty,
    delta: askQty - bidQty,
    volume: askQty + bidQty,
    pocPrice: poc?.price ?? null,
    complete: options.complete ?? false,
  };
}

export function selectPoc(levels: readonly FootprintLevel[], candleClose?: number): FootprintLevel | null {
  if (levels.length === 0) return null;
  // M5/M6: desempate con la convención única (ver ./poc.ts).
  return levels.reduce<FootprintLevel | null>(
    (best, level) => (!best || isBetterPoc(level, best, candleClose) ? level : best),
    null
  );
}

export function applyAggTradesToFootprint(
  candles: readonly FootprintCandle[],
  trades: readonly AggTrade[],
  timeframeMs: number,
  tickSize: number,
  limit = 100,
  microstructureConfig: MicrostructureConfig = DEFAULT_MICROSTRUCTURE_CONFIG,
  /**
   * Agrupación de precio (paso = tickSize × priceMultiplier). Debe ser el MISMO valor con el que
   * el servidor construyó el histórico, para que un trade en vivo caiga en el mismo nivel que
   * caería en la vista histórica (misma función de cuantización: getPriceLevel).
   */
  priceMultiplier = 1,
): FootprintCandle[] {
  if (
    timeframeMs < 60_000 ||
    !Number.isFinite(timeframeMs) ||
    timeframeMs <= 0 ||
    !Number.isFinite(tickSize) ||
    tickSize <= 0 ||
    !Number.isFinite(priceMultiplier) ||
    priceMultiplier <= 0 ||
    trades.length === 0
  ) {
    return candles as FootprintCandle[];
  }

  const existing = new Map(candles.map(candle => [candle.timestamp, candle]));
  const drafts = new Map<number, { base: FootprintCandle; levels: Map<number, MutableLevel>; lastPrice: number }>();
  for (const trade of trades) {
    if (
      ![trade.price, trade.quantity, trade.timestamp, trade.aggTradeId].every(Number.isFinite) ||
      trade.quantity < 0
    ) {
      continue;
    }

    const timestamp = getCandleStart(trade.timestamp, timeframeMs);
    let draft = drafts.get(timestamp);
    if (!draft) {
      const base = existing.get(timestamp) ?? {
        timestamp,
        timeframeMs,
        levels: [],
        bidQty: 0,
        askQty: 0,
        delta: 0,
        volume: 0,
        pocPrice: null,
        complete: false,
      };
      draft = {
        base,
        levels: new Map(base.levels.map(level => [level.price, {
          price: level.price,
          bidQty: level.bidQty,
          askQty: level.askQty,
          tradeCount: level.tradeCount,
        }])),
        // M6: el último precio visto es el cierre provisional de la vela en
        // formación; sirve de referencia para el desempate del POC en vivo.
        lastPrice: trade.price,
      };
      drafts.set(timestamp, draft);
    }

    const price = getPriceLevel(trade.price, tickSize, priceMultiplier);
    const level = draft.levels.get(price) ?? { price, bidQty: 0, askQty: 0, tradeCount: 0 };
    if (trade.buyerIsMaker) level.bidQty += trade.quantity;
    else level.askQty += trade.quantity;
    level.tradeCount += 1;
    draft.levels.set(price, level);
    draft.lastPrice = trade.price;
  }

  if (drafts.size === 0) return candles as FootprintCandle[];

  const next = [...candles];
  const indexes = new Map(candles.map((candle, index) => [candle.timestamp, index]));
  let appended = false;
  for (const [timestamp, draft] of drafts) {
    const levels = [...draft.levels.values()]
      .sort((a, b) => a.price - b.price)
      .map(level => ({
        ...level,
        delta: level.askQty - level.bidQty,
        volume: level.askQty + level.bidQty,
      }));
    const bidQty = levels.reduce((sum, level) => sum + level.bidQty, 0);
    const askQty = levels.reduce((sum, level) => sum + level.askQty, 0);
    const candle: FootprintCandle = {
      ...draft.base,
      timestamp,
      timeframeMs,
      levels,
      bidQty,
      askQty,
      delta: askQty - bidQty,
      volume: askQty + bidQty,
      // M6: en vivo se usa el último precio como cierre de referencia, igual
      // que el histórico usa candleClose: misma regla de desempate.
      pocPrice: selectPoc(levels, draft.lastPrice)?.price ?? null,
      complete: false,
    };
    const index = indexes.get(timestamp);
    if (index === undefined) {
      next.push(candle);
      appended = true;
    } else {
      next[index] = candle;
    }
  }

  if (appended) next.sort((a, b) => a.timestamp - b.timestamp);
  const bounded = limit > 0 && next.length > limit ? next.slice(-limit) : next;
  // Only candles touched by this real aggTrade batch receive new signal objects.
  // El paso de las señales por nivel (imbalance diagonal, stacked, etc.) es el paso agrupado,
  // igual que en la hidratación del histórico (tickSize × priceMultiplier).
  return attachSignalsToCandles(bounded, tickSize * priceMultiplier, microstructureConfig, new Set(drafts.keys()));
}

function roundToStep(value: number, step: number): number {
  const decimals = Math.min(12, Math.max(0, Math.ceil(-Math.log10(step)) + 2));
  return Number(value.toFixed(decimals));
}
