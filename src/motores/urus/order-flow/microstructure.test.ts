import { describe, expect, it } from "vitest";
import { aggregateFootprintTrades, applyAggTradesToFootprint, getPriceLevel, type AggTrade } from "./footprint";
import {
  attachSignalsToCandles,
  computeCandleSignals,
  computeVolumeBaseline,
  DEFAULT_MICROSTRUCTURE_CONFIG,
  type MicrostructureCandleInput,
} from "./microstructure";

const lv = (price: number, bidQty: number, askQty: number) => ({ price, bidQty, askQty });
const candleOf = (levels: ReturnType<typeof lv>[], timestamp = 0): MicrostructureCandleInput => ({ timestamp, levels });
const signalsOf = (levels: ReturnType<typeof lv>[], extra: Parameters<typeof computeCandleSignals>[1] = { step: 1 }) =>
  computeCandleSignals(candleOf(levels), extra);
const byPrice = (s: ReturnType<typeof signalsOf>, price: number) => s.levels.find(l => l.price === price)!;

describe("Level state", () => {
  it("expone bid/ask/total/delta por nivel", () => {
    const s = signalsOf([lv(100, 3, 7)]);
    expect(s.levels[0]).toMatchObject({ price: 100, bidVolume: 3, askVolume: 7, totalVolume: 10, delta: 4 });
  });
});

describe("POC y Delta POC independientes", () => {
  it("POC = mayor volumen, Delta POC = mayor |delta|", () => {
    const s = signalsOf([lv(100, 30, 30), lv(101, 2, 20), lv(102, 1, 1)]);
    expect(s.pocPrice).toBe(100);
    expect(s.deltaPocPrice).toBe(101);
  });

  it("conserva el POC existente de la vela cuando viene dado", () => {
    const s = computeCandleSignals({ timestamp: 0, levels: [lv(100, 5, 5), lv(101, 1, 1)], pocPrice: 101 }, { step: 1 });
    expect(s.pocPrice).toBe(101);
  });

  it("Delta POC usa |delta| (también vendedor) y es null sin delta", () => {
    expect(signalsOf([lv(100, 20, 1), lv(101, 3, 5)]).deltaPocPrice).toBe(100);
    expect(signalsOf([lv(100, 5, 5)]).deltaPocPrice).toBeNull();
  });
});

describe("Imbalance diagonal", () => {
  const buyingFixture = [lv(100, 5, 0), lv(101, 1, 15), lv(102, 2, 6), lv(103, 1, 4), lv(104, 0, 3)];

  it("buying: Ask[P] / Bid[P - tick] >= 3.0 (umbral exacto incluido)", () => {
    const s = signalsOf(buyingFixture);
    expect(byPrice(s, 100).imbalance).toBe("none"); // fila más baja: sin contraparte en rango
    expect(byPrice(s, 101).imbalance).toBe("buying"); // 15/5 = 3.0
    expect(byPrice(s, 102).imbalance).toBe("buying"); // 6/1
    expect(byPrice(s, 103).imbalance).toBe("none"); // 4/2 = 2.0
    expect(byPrice(s, 104).imbalance).toBe("buying"); // 3/1 = 3.0
    expect(s.stackedImbalances).toEqual([]); // 101-102 y luego 104: ninguna racha >= 3
  });

  it("selling: Bid[P] / Ask[P + tick] >= 3.0", () => {
    const s = signalsOf([lv(100, 9, 1), lv(101, 6, 2), lv(102, 9, 2), lv(103, 1, 1)]);
    expect(byPrice(s, 100).imbalance).toBe("selling"); // 9/2
    expect(byPrice(s, 101).imbalance).toBe("selling"); // 6/2 = 3.0
    expect(byPrice(s, 102).imbalance).toBe("selling"); // 9/1
    expect(byPrice(s, 103).imbalance).toBe("none"); // fila más alta: sin contraparte en rango
  });

  it("el ratio es configurable (imbalanceRatio)", () => {
    const strict = { ...DEFAULT_MICROSTRUCTURE_CONFIG, imbalanceRatio: 4 };
    const s = signalsOf(buyingFixture, { step: 1, config: strict });
    expect(byPrice(s, 101).imbalance).toBe("none");
    expect(byPrice(s, 102).imbalance).toBe("buying");
  });

  it("denominador 0: cuenta como imbalance solo si zeroDenominatorImbalance", () => {
    const rows = [lv(100, 0, 1), lv(101, 0, 5)];
    expect(byPrice(signalsOf(rows), 101).imbalance).toBe("buying");
    const off = { ...DEFAULT_MICROSTRUCTURE_CONFIG, zeroDenominatorImbalance: false };
    expect(byPrice(signalsOf(rows, { step: 1, config: off }), 101).imbalance).toBe("none");
  });

  it("un hueco de precio cuenta como volumen 0 en la diagonal, no se interpola", () => {
    const s = signalsOf([lv(100, 50, 0), lv(102, 0, 4)]);
    expect(byPrice(s, 102).buyingImbalance).toBe(true); // Bid[101] no existe -> 0
  });

  it("buying y selling pueden coexistir sin perder información", () => {
    const s = signalsOf([lv(100, 1, 1), lv(101, 6, 12), lv(102, 0, 2)]);
    const row = byPrice(s, 101); // buying 12/1, selling 6/2 = 3
    expect(row.buyingImbalance).toBe(true);
    expect(row.sellingImbalance).toBe(true);
    expect(row.imbalance).toBe("buying"); // mayor ratio
  });
});

describe("Stacked imbalance", () => {
  it("agrupa >= 3 niveles consecutivos del mismo lado", () => {
    const s = signalsOf([lv(100, 5, 0), lv(101, 1, 15), lv(102, 2, 6), lv(103, 1, 8), lv(104, 0, 3)]);
    expect(s.stackedImbalances).toEqual([
      { direction: "buying", startPrice: 101, endPrice: 104, levels: [101, 102, 103, 104], count: 4 },
    ]);
  });

  it("selling stacked", () => {
    const s = signalsOf([lv(100, 9, 1), lv(101, 6, 2), lv(102, 9, 1), lv(103, 1, 1)]);
    expect(s.stackedImbalances).toEqual([
      { direction: "selling", startPrice: 100, endPrice: 102, levels: [100, 101, 102], count: 3 },
    ]);
  });

  it("un hueco o un nivel sin imbalance rompe la racha", () => {
    const s = signalsOf([lv(100, 5, 0), lv(101, 1, 15), lv(102, 2, 6), lv(103, 2, 3), lv(104, 1, 9)]);
    expect(s.stackedImbalances).toEqual([]);
  });
});

describe("Absorption", () => {
  // Historia: 2 velas x 20 niveles con volumen alternando 8 y 12 -> media 10, desviación 2 -> umbral 14
  const history = (ts: number): MicrostructureCandleInput =>
    candleOf(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? lv(100 + i, 4, 4) : lv(100 + i, 6, 6))), ts);

  it("exige volumen excepcional Y delta equilibrado", () => {
    const current = candleOf([lv(100, 9.5, 10.5), lv(101, 5, 15), lv(102, 6.5, 6.5), lv(103, 1, 1)], 3);
    const [, , out] = attachSignalsToCandles([history(1), history(2), current], 1);
    const s = out.signals!;
    expect(s.baseline).toMatchObject({ mean: 10, stdDev: 2, samples: 40 });
    expect(byPrice(s, 100).absorption).toBe(true); // vol 20 > 14, |delta|/vol = 0.05
    expect(byPrice(s, 101).absorption).toBe(false); // vol 20 pero delta 0.5
    expect(byPrice(s, 102).absorption).toBe(false); // equilibrado pero vol 13 < 14
    expect(byPrice(s, 103).absorption).toBe(false);
  });

  it("sin historia suficiente no marca absorption (no se inventa baseline)", () => {
    const [only] = attachSignalsToCandles([candleOf([lv(100, 50, 50)])], 1);
    expect(only.signals!.baseline).toBeNull();
    expect(only.signals!.levels[0].absorption).toBe(false);
  });

  it("no divide por cero con niveles vacíos", () => {
    const s = signalsOf([lv(100, 0, 0)], { step: 1, baseline: { mean: 0, stdDev: 0, samples: 100 } });
    expect(s.levels[0].absorption).toBe(false);
  });

  it("la base excluye la vela actual y solo mira lookbackCandles previas", () => {
    const prev = Array.from({ length: 30 }, (_, i) => history(i));
    expect(computeVolumeBaseline(prev)!.samples).toBe(20 * 20);
  });
});

describe("Exhaustion", () => {
  const asks = (values: number[]) => values.map((a, i) => lv(100 + i, 1, a));

  it("buying exhaustion: la agresión compradora cae en el high", () => {
    const s = signalsOf(asks([5, 10, 12, 10, 2, 1]));
    expect(byPrice(s, 105).exhaustion).toBe("buying");
    expect(s.levels.filter(l => l.exhaustion !== "none")).toHaveLength(1);
  });

  it("selling exhaustion: la agresión vendedora cae en el low", () => {
    const rows = [lv(100, 1, 1), lv(101, 2, 1), lv(102, 10, 1), lv(103, 12, 1), lv(104, 10, 1), lv(105, 5, 1)];
    expect(byPrice(signalsOf(rows), 100).exhaustion).toBe("selling");
  });

  it("volumen bajo sin contexto de caída no es exhaustion", () => {
    expect(signalsOf(asks([10, 10, 10, 10, 10, 10])).levels.every(l => l.exhaustion === "none")).toBe(true);
    expect(signalsOf(asks([1, 1, 1, 1, 1, 1])).levels.every(l => l.exhaustion === "none")).toBe(true);
  });

  it("la dirección conocida limita el extremo evaluado", () => {
    const rows = asks([5, 10, 12, 10, 2, 1]);
    expect(byPrice(signalsOf(rows, { step: 1, direction: "down" }), 105).exhaustion).toBe("none");
    expect(byPrice(signalsOf(rows, { step: 1, direction: "up" }), 105).exhaustion).toBe("buying");
  });

  it("exhaustion y absorption son detectores independientes", () => {
    const s = signalsOf(asks([5, 10, 12, 10, 2, 1]));
    expect(s.levels.every(l => l.absorption === false)).toBe(true);
  });

  it("un rango demasiado corto no genera exhaustion", () => {
    expect(signalsOf(asks([10, 1, 1])).levels.every(l => l.exhaustion === "none")).toBe(true);
  });
});

describe("Estado vivo e incremental", () => {
  const trade = (o: Partial<AggTrade>): AggTrade => ({ symbol: "BTCUSDT", price: 100, quantity: 1, timestamp: 0, aggTradeId: 1, buyerIsMaker: false, ...o });

  it("solo recalcula la vela tocada y deja intactas las anteriores", () => {
    const earlier = aggregateFootprintTrades(
      [trade({ timestamp: 300_001, price: 100.25, quantity: 2, buyerIsMaker: true })],
      { timeframeMs: 60_000, tickSize: 0.01, candleStart: 300_000, complete: true },
    );
    const [earlierWithSignals] = attachSignalsToCandles([earlier], 0.01);
    const next = applyAggTradesToFootprint([earlierWithSignals], [
      trade({ timestamp: 360_001, price: 100.3, quantity: 4, aggTradeId: 2 }),
      trade({ timestamp: 360_002, price: 100.3, quantity: 1, aggTradeId: 3, buyerIsMaker: true }),
    ], 60_000, 0.01);

    expect(next[0]).toBe(earlierWithSignals);
    expect(next[1].signals!.levels[0]).toMatchObject({ price: 100.3, bidVolume: 1, askVolume: 4, totalVolume: 5, delta: 3 });
    expect(next[1].signals!.deltaPocPrice).toBe(100.3);
  });

  it("cada trade nuevo actualiza el nivel afectado y no pierde los demás", () => {
    let candles = applyAggTradesToFootprint([], [trade({ timestamp: 60_001, price: 100.1, quantity: 3, aggTradeId: 1 })], 60_000, 0.1);
    candles = applyAggTradesToFootprint(candles, [trade({ timestamp: 60_002, price: 100.2, quantity: 2, aggTradeId: 2, buyerIsMaker: true })], 60_000, 0.1);
    candles = applyAggTradesToFootprint(candles, [trade({ timestamp: 60_003, price: 100.1, quantity: 1, aggTradeId: 3, buyerIsMaker: true })], 60_000, 0.1);
    const s = candles[0].signals!;
    expect(s.levels.map(l => [l.price, l.bidVolume, l.askVolume])).toEqual([[100.1, 1, 3], [100.2, 2, 0]]);
    expect(candles[0]).toMatchObject({ bidQty: 3, askQty: 3, delta: 0, volume: 6 });
  });
});

// Fixtures deterministas (NO son datos de mercado): ejercitan la rejilla de tick de cada instrumento.
describe.each([
  ["BTCUSDT", 0.1, 60000],
  ["ETHUSDT", 0.01, 3000],
  ["SOLUSDT", 0.01, 150],
  ["XAUUSDT", 0.01, 2000],
])("%s (tick fixture %s)", (symbol, tick, base) => {
  const at = (k: number, quantity: number, buyerIsMaker: boolean, id: number): AggTrade => ({
    symbol, price: Number((base + k * tick).toFixed(8)), quantity, timestamp: 60_000 + id, aggTradeId: id, buyerIsMaker,
  });
  const trades = [at(0, 4, true, 1), at(1, 12, false, 2), at(1, 1, true, 3), at(2, 5, false, 4), at(3, 9, false, 5)];

  it("clasifica con buyerIsMaker y agrega por nivel sin desplazar niveles", () => {
    const candle = aggregateFootprintTrades(trades, { timeframeMs: 60_000, tickSize: tick, candleStart: 60_000 });
    expect(candle.levels.map(l => [Math.round(l.price / tick), l.bidQty, l.askQty])).toEqual([
      [Math.round(base / tick), 4, 0], [Math.round(base / tick) + 1, 1, 12], [Math.round(base / tick) + 2, 0, 5], [Math.round(base / tick) + 3, 0, 9],
    ]);
    expect(candle).toMatchObject({ bidQty: 5, askQty: 26, delta: 21, volume: 31 });
  });

  it("calcula POC, Delta POC, imbalance y stacked imbalance", () => {
    const candle = aggregateFootprintTrades(trades, { timeframeMs: 60_000, tickSize: tick, candleStart: 60_000 });
    const s = computeCandleSignals(candle, { step: tick });
    const prices = candle.levels.map(l => l.price);
    expect(s.pocPrice).toBe(prices[1]);
    expect(s.deltaPocPrice).toBe(prices[1]);
    expect(s.levels.map(l => l.imbalance)).toEqual(["none", "buying", "buying", "buying"]);
    expect(s.stackedImbalances).toEqual([
      { direction: "buying", startPrice: prices[1], endPrice: prices[3], levels: [prices[1], prices[2], prices[3]], count: 3 },
    ]);
  });

  it("getPriceLevel mantiene en su nivel los precios exactos en tick", () => {
    for (let k = 0; k < 5_000; k++) {
      const price = Number((base + k * tick).toFixed(8));
      expect(Math.round(getPriceLevel(price, tick) / tick)).toBe(Math.round(price / tick));
    }
  });

  it("recalcula imbalance y stacked sobre la rejilla visual 2×, no sobre ticks individuales", () => {
    const step = tick * 2;
    const grouped = new Map<number, { bidQty: number; askQty: number }>();
    for (let k = 0; k < 8; k++) {
      const price = Number((base + k * tick).toFixed(8));
      const rowPrice = Number((Math.floor(price / step + 1e-9) * step).toFixed(8));
      const row = grouped.get(rowPrice) ?? { bidQty: 0, askQty: 0 };
      row.bidQty += k % 2 === 0 ? 10 : 0;
      row.askQty += k % 2 === 1 ? 30 : 0;
      grouped.set(rowPrice, row);
    }
    const levels = [...grouped].map(([price, row]) => lv(price, row.bidQty, row.askQty));
    const signals = computeCandleSignals(candleOf(levels), { step });
    expect(signals.step).toBe(step);
    expect(signals.levels.map((level) => level.price)).toEqual([
      base,
      Number((base + 2 * tick).toFixed(8)),
      Number((base + 4 * tick).toFixed(8)),
      Number((base + 6 * tick).toFixed(8)),
    ]);
    expect(signals.stackedImbalances).toEqual([
      {
        direction: "buying",
        startPrice: Number((base + 2 * tick).toFixed(8)),
        endPrice: Number((base + 6 * tick).toFixed(8)),
        levels: [2, 3, 4, 5, 6, 7].filter((k) => k % 2 === 0).map((k) => Number((base + k * tick).toFixed(8))),
        count: 3,
      },
    ]);
  });

  it("calcula absorption y exhaustion con el tick real del símbolo", () => {
    const history = [0, 1].map((candleIndex) => candleOf(
      Array.from({ length: 20 }, (_, i) => lv(Number((base + i * tick).toFixed(8)), 4, 4)),
      candleIndex,
    ));
    const absorptionPrice = Number((base + 20 * tick).toFixed(8));
    const active = candleOf([lv(absorptionPrice, 9.5, 10.5)], 3);
    const attached = attachSignalsToCandles([...history, active], tick);
    expect(byPrice(attached[2].signals!, absorptionPrice).absorption).toBe(true);

    const buyingRows = [5, 10, 12, 10, 2, 1].map((ask, i) =>
      lv(Number((base + i * tick).toFixed(8)), 1, ask),
    );
    const buying = computeCandleSignals(candleOf(buyingRows), { step: tick, direction: "up" });
    expect(byPrice(buying, Number((base + 5 * tick).toFixed(8))).exhaustion).toBe("buying");

    const sellingRows = [1, 1, 5, 10, 12, 10].map((bid, i) =>
      lv(Number((base + i * tick).toFixed(8)), bid, 1),
    );
    const selling = computeCandleSignals(candleOf(sellingRows), { step: tick, direction: "down" });
    expect(byPrice(selling, base).exhaustion).toBe("selling");
  });
});
