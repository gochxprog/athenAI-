import { describe, expect, it } from "vitest";
import { aggregateFootprintTrades, applyAggTradesToFootprint, getCandleStart, getFootprintSide, getPriceLevel, selectPoc, type AggTrade, type FootprintLevel } from "./footprint";

const trade = (overrides: Partial<AggTrade> = {}): AggTrade => ({
  symbol: "BTCUSDT",
  price: 100.25,
  quantity: 1,
  timestamp: 300_001,
  aggTradeId: 1,
  buyerIsMaker: false,
  ...overrides,
});

describe("Footprint aggregation", () => {
  it("maps Binance m flag to the aggressive side exactly", () => {
    expect(getFootprintSide(true)).toBe("bid");
    expect(getFootprintSide(false)).toBe("ask");
  });

  it("groups prices with deterministic floor using tick size and multiplier", () => {
    expect(getPriceLevel(100.29, 0.01)).toBe(100.29);
    expect(getPriceLevel(100.29, 0.01, 5)).toBe(100.25);
    expect(getPriceLevel(100.25, 0.01, 5)).toBe(100.25);
    expect(getPriceLevel(100.35, 0.01, 5)).toBe(100.35);
    expect(getPriceLevel(100.34, 0.01, 5)).toBe(100.3);
  });

  it("aligns timestamps to UTC candle starts", () => {
    expect(getCandleStart(301_234, 60_000)).toBe(300_000);
    expect(getCandleStart(1_700_000_299_999, 300_000)).toBe(1_700_000_100_000);
  });

  it("aggregates bid, ask, delta and total volume without inventing data", () => {
    const candle = aggregateFootprintTrades([
      trade({ timestamp: 300_001, price: 100.25, quantity: 2, buyerIsMaker: true, aggTradeId: 10 }),
      trade({ timestamp: 300_002, price: 100.29, quantity: 3, buyerIsMaker: false, aggTradeId: 11 }),
      trade({ timestamp: 300_003, price: 100.31, quantity: 4, buyerIsMaker: false, aggTradeId: 12 }),
      trade({ timestamp: 360_000, price: 100.31, quantity: 99, buyerIsMaker: false, aggTradeId: 13 }),
    ], { timeframeMs: 60_000, tickSize: 0.01, candleStart: 300_000, complete: true });
    expect(candle.levels).toEqual([
      { price: 100.25, bidQty: 2, askQty: 0, tradeCount: 1, delta: -2, volume: 2 },
      { price: 100.29, bidQty: 0, askQty: 3, tradeCount: 1, delta: 3, volume: 3 },
      { price: 100.31, bidQty: 0, askQty: 4, tradeCount: 1, delta: 4, volume: 4 },
    ]);
    expect(candle.bidQty).toBe(2);
    expect(candle.askQty).toBe(7);
    expect(candle.delta).toBe(5);
    expect(candle.volume).toBe(9);
    expect(candle.pocPrice).toBe(100.31);
    expect(candle.complete).toBe(true);
  });

  it("chooses the tied POC closest to the candle close", () => {
    const levels: FootprintLevel[] = [
      { price: 99, bidQty: 0, askQty: 5, tradeCount: 1, delta: 5, volume: 5 },
      { price: 101, bidQty: 0, askQty: 5, tradeCount: 1, delta: 5, volume: 5 },
    ];
    expect(selectPoc(levels, 100.8)?.price).toBe(101);
  });

  it("M5/M6: without a close reference, a tied POC goes to the highest price (uniform rule)", () => {
    const levels: FootprintLevel[] = [
      { price: 101, bidQty: 0, askQty: 5, tradeCount: 1, delta: 5, volume: 5 },
      { price: 99, bidQty: 0, askQty: 5, tradeCount: 1, delta: 5, volume: 5 },
    ];
    // Independiente del orden: el precio más alto gana el empate.
    expect(selectPoc(levels)?.price).toBe(101);
    expect(selectPoc([...levels].reverse())?.price).toBe(101);
  });

  it("applies live trades only to the affected candle and preserves its existing levels", () => {
    const original = aggregateFootprintTrades([
      trade({ timestamp: 300_001, price: 100.25, quantity: 2, buyerIsMaker: true }),
    ], { timeframeMs: 60_000, tickSize: 0.01, candleStart: 300_000, complete: false });
    const next = applyAggTradesToFootprint([original], [
      trade({ timestamp: 300_002, price: 100.25, quantity: 3, buyerIsMaker: false, aggTradeId: 2 }),
      trade({ timestamp: 300_003, price: 100.30, quantity: 4, buyerIsMaker: false, aggTradeId: 3 }),
    ], 60_000, 0.01);

    expect(original.bidQty).toBe(2);
    expect(next).toHaveLength(1);
    expect(next[0].levels).toEqual([
      { price: 100.25, bidQty: 2, askQty: 3, tradeCount: 2, delta: 1, volume: 5 },
      { price: 100.3, bidQty: 0, askQty: 4, tradeCount: 1, delta: 4, volume: 4 },
    ]);
    expect(next[0]).toMatchObject({ bidQty: 2, askQty: 7, delta: 5, volume: 9, complete: false });
  });

  it("starts a separate candle at the timeframe boundary and keeps history ordered", () => {
    const earlier = aggregateFootprintTrades([
      trade({ timestamp: 300_001, price: 100.25, quantity: 2, buyerIsMaker: true }),
    ], { timeframeMs: 60_000, tickSize: 0.01, candleStart: 300_000, complete: true });
    const next = applyAggTradesToFootprint([earlier], [
      trade({ timestamp: 360_000, price: 100.31, quantity: 1, buyerIsMaker: false, aggTradeId: 2 }),
    ], 60_000, 0.01);

    expect(next.map(candle => candle.timestamp)).toEqual([300_000, 360_000]);
    expect(next[0]).toBe(earlier);
    expect(next[1].levels).toEqual([
      { price: 100.31, bidQty: 0, askQty: 1, tradeCount: 1, delta: 1, volume: 1 },
    ]);
  });
  describe("cuantización live = histórico (priceMultiplier)", () => {
    it("tick 0.1 y agrupación 3: el trade 100.1 en vivo cae en el nivel 99.9, no en uno aparte (caso de la auditoría)", () => {
      const historical = aggregateFootprintTrades([
        trade({ timestamp: 300_001, price: 99.9, quantity: 2, buyerIsMaker: true, aggTradeId: 1 }),
      ], { timeframeMs: 60_000, tickSize: 0.1, priceMultiplier: 3, candleStart: 300_000 });
      expect(historical.levels.map(level => level.price)).toEqual([99.9]);

      const next = applyAggTradesToFootprint([historical], [
        trade({ timestamp: 300_002, price: 100.1, quantity: 3, buyerIsMaker: false, aggTradeId: 2 }),
      ], 60_000, 0.1, 100, undefined, 3);

      expect(next[0].levels).toEqual([
        { price: 99.9, bidQty: 2, askQty: 3, tradeCount: 2, delta: 1, volume: 5 },
      ]);
      expect(getPriceLevel(100.1, 0.1, 3)).toBe(99.9);
    });

    it("una tanda de trades aplicada en vivo produce exactamente los mismos niveles que la agregación histórica", () => {
      const trades = [
        trade({ price: 100.29, quantity: 1.5, buyerIsMaker: true, aggTradeId: 1, timestamp: 300_001 }),
        trade({ price: 100.25, quantity: 2, buyerIsMaker: false, aggTradeId: 2, timestamp: 300_002 }),
        trade({ price: 100.34, quantity: 0.5, buyerIsMaker: false, aggTradeId: 3, timestamp: 300_003 }),
        trade({ price: 100.35, quantity: 4, buyerIsMaker: true, aggTradeId: 4, timestamp: 300_004 }),
        trade({ price: 100.31, quantity: 1, buyerIsMaker: false, aggTradeId: 5, timestamp: 300_005 }),
        trade({ price: 100.2, quantity: 3, buyerIsMaker: true, aggTradeId: 6, timestamp: 300_006 }),
      ];
      for (const priceMultiplier of [1, 3, 5, 10]) {
        const historical = aggregateFootprintTrades(trades, { timeframeMs: 60_000, tickSize: 0.01, priceMultiplier, candleStart: 300_000 });
        const live = applyAggTradesToFootprint([], trades, 60_000, 0.01, 100, undefined, priceMultiplier);
        expect(live).toHaveLength(1);
        expect(live[0].levels).toEqual(historical.levels);
        expect(live[0]).toMatchObject({ bidQty: historical.bidQty, askQty: historical.askQty, delta: historical.delta, volume: historical.volume, pocPrice: historical.pocPrice });
      }
    });

    it("sin multiplicador conserva el comportamiento anterior (paso = tickSize)", () => {
      const next = applyAggTradesToFootprint([], [trade({ price: 100.1, quantity: 1 })], 60_000, 0.1);
      expect(next[0].levels.map(level => level.price)).toEqual([100.1]);
    });

    it("un multiplicador inválido no altera las velas", () => {
      const original = aggregateFootprintTrades([trade({ price: 100.25, quantity: 1 })], { timeframeMs: 60_000, tickSize: 0.01, candleStart: 300_000 });
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const next = applyAggTradesToFootprint([original], [trade({ aggTradeId: 9, timestamp: 300_009 })], 60_000, 0.01, 100, undefined, bad);
        expect(next).toEqual([original]);
      }
    });
  });
});
