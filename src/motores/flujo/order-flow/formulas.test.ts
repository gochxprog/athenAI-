import { describe, expect, it } from "vitest";
import {
  ABSORPTION_EPSILON,
  candleDelta,
  candlePriceDelta,
  computeAbsorptionIndex,
  computeDiagonalImbalances,
  computeMicroPrice,
  computeObi,
  diagonalRatio,
  levelDelta,
  levelVolume,
  type BookLevel,
  type LevelQty,
} from "./formulas";
import { computeCandleSignals } from "./microstructure";
import { computeDomImbalance } from "./order-book";

describe("formulas: Volume / Delta", () => {
  it("levelVolume = bidQty + askQty", () => {
    expect(levelVolume({ bidQty: 3, askQty: 7 })).toBe(10);
    expect(levelVolume({ bidQty: 0, askQty: 0 })).toBe(0);
  });

  it("levelDelta = askQty - bidQty", () => {
    expect(levelDelta({ bidQty: 3, askQty: 7 })).toBe(4);
    expect(levelDelta({ bidQty: 7, askQty: 3 })).toBe(-4);
    expect(levelDelta({ bidQty: 0, askQty: 0 })).toBe(0);
  });

  it("candleDelta = suma de deltas por nivel", () => {
    const levels = [
      { bidQty: 3, askQty: 7 },
      { bidQty: 7, askQty: 3 },
      { bidQty: 0, askQty: 5 },
    ];
    expect(candleDelta(levels)).toBe(4 - 4 + 5);
    expect(candleDelta([])).toBe(0);
  });
});

describe("formulas: diagonalRatio", () => {
  it("ratio exactamente 3.0 cuenta como imbalance", () => {
    expect(diagonalRatio(30, 10)).toBe(3);
  });

  it("ratio 2.99 no cuenta", () => {
    expect(diagonalRatio(29.9, 10)).toBeNull();
  });

  it("denominador 0 con numerador > 0 cuenta como infinito", () => {
    expect(diagonalRatio(5, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("denominador 0 con numerador > 0 no cuenta si zeroDenominatorCounts = false", () => {
    expect(diagonalRatio(5, 0, 3.0, false)).toBeNull();
  });

  it("0/0 nunca cuenta", () => {
    expect(diagonalRatio(0, 0)).toBeNull();
  });

  it("entradas no finitas o negativas devuelven null, nunca NaN", () => {
    expect(diagonalRatio(Number.NaN, 10)).toBeNull();
    expect(diagonalRatio(10, Number.NaN)).toBeNull();
    expect(diagonalRatio(-5, 10)).toBeNull();
    expect(diagonalRatio(10, -2)).toBeNull();
    expect(diagonalRatio(Number.POSITIVE_INFINITY, 10)).toBeNull();
  });

  it("respeta un umbral personalizado", () => {
    expect(diagonalRatio(20, 10, 2.0)).toBe(2);
    expect(diagonalRatio(15, 10, 2.0)).toBeNull();
  });
});

describe("formulas: computeDiagonalImbalances", () => {
  it("marca Buy en Ask[P]/Bid[P-tick] >= 3 y Sell en Bid[P]/Ask[P+tick] >= 3 (convención bidRow)", () => {
    const tick = 1;
    const levels: LevelQty[] = [
      { price: 100, bidQty: 10, askQty: 1 }, // fila más baja: buy no se evalúa
      { price: 101, bidQty: 1, askQty: 40 }, // buy: 40/10 = 4 >= 3
      { price: 102, bidQty: 50, askQty: 2 }, // sell: 50/2 = 25 >= 3 (fila del bid)
      { price: 103, bidQty: 1, askQty: 1 }, // fila más alta: sell no se evalúa
    ];
    const result = computeDiagonalImbalances(levels, tick, { sellMarkRow: "bidRow" });
    const byPrice = new Map(result.map(r => [r.price, r]));
    expect(byPrice.get(100)?.buy).toBe(false);
    expect(byPrice.get(101)?.buy).toBe(true);
    expect(byPrice.get(101)?.buyRatio).toBeCloseTo(4, 12);
    expect(byPrice.get(102)?.sell).toBe(true);
    expect(byPrice.get(102)?.sellRatio).toBeCloseTo(50, 12);
    expect(byPrice.get(103)?.sell).toBe(false);
  });

  it("sellMarkRow askRow marca el sell en la fila del ask (mismo par de niveles)", () => {
    const tick = 1;
    const levels: LevelQty[] = [
      { price: 100, bidQty: 1, askQty: 1 },
      { price: 101, bidQty: 50, askQty: 2 }, // par Bid[101]/Ask[102]
      { price: 102, bidQty: 1, askQty: 1 },
    ];
    const bidRow = computeDiagonalImbalances(levels, tick, { sellMarkRow: "bidRow" });
    const askRow = computeDiagonalImbalances(levels, tick, { sellMarkRow: "askRow" });
    // bidRow marca en 101 (Bid[101]/Ask[102]); askRow marca en 102 (Bid[101]/Ask[102])
    expect(bidRow.find(r => r.price === 101)?.sell).toBe(true);
    expect(bidRow.find(r => r.price === 102)?.sell).toBe(false);
    expect(askRow.find(r => r.price === 102)?.sell).toBe(true);
    expect(askRow.find(r => r.price === 101)?.sell).toBe(false);
  });

  it("lanza con tickSize inválido", () => {
    expect(() => computeDiagonalImbalances([], 0)).toThrow("Invalid tickSize");
    expect(() => computeDiagonalImbalances([], -1)).toThrow("Invalid tickSize");
  });
});

describe("formulas: computeMicroPrice", () => {
  it("con más bid que ask se acerca al ask", () => {
    const mp = computeMicroPrice({ bidPrice: 100, bidQty: 90, askPrice: 101, askQty: 10 });
    expect(mp).not.toBeNull();
    expect(mp as number).toBeGreaterThan(100.5);
    expect(mp as number).toBeLessThan(101);
    expect(mp as number).toBeCloseTo((90 * 101 + 10 * 100) / 100, 12);
  });

  it("con cantidades iguales da el mid", () => {
    expect(computeMicroPrice({ bidPrice: 100, bidQty: 5, askPrice: 102, askQty: 5 })).toBeCloseTo(101, 12);
  });

  it("cantidad total 0 devuelve null", () => {
    expect(computeMicroPrice({ bidPrice: 100, bidQty: 0, askPrice: 101, askQty: 0 })).toBeNull();
  });

  it("libro cruzado devuelve null", () => {
    expect(computeMicroPrice({ bidPrice: 102, bidQty: 5, askPrice: 101, askQty: 5 })).toBeNull();
  });

  it("entradas inválidas devuelven null", () => {
    expect(computeMicroPrice({ bidPrice: -1, bidQty: 5, askPrice: 101, askQty: 5 })).toBeNull();
    expect(computeMicroPrice({ bidPrice: 100, bidQty: -5, askPrice: 101, askQty: 5 })).toBeNull();
    expect(computeMicroPrice({ bidPrice: Number.NaN, bidQty: 5, askPrice: 101, askQty: 5 })).toBeNull();
  });
});

describe("formulas: computeObi", () => {
  const bids: BookLevel[] = [
    [100, 10],
    [99, 20],
    [98, 30],
  ];
  const asks: BookLevel[] = [
    [101, 5],
    [102, 15],
    [103, 40],
  ];

  it("OBI_N = (ΣBid−ΣAsk)/(ΣBid+ΣAsk)", () => {
    // N=2: bids 10+20=30, asks 5+15=20 → (30−20)/(30+20) = 0.2
    expect(computeObi(bids, asks, 2)).toBeCloseTo(0.2, 12);
  });

  it("N = 0 o no entero devuelve null", () => {
    expect(computeObi(bids, asks, 0)).toBeNull();
    expect(computeObi(bids, asks, 1.5)).toBeNull();
  });

  it("libro vacío devuelve null", () => {
    expect(computeObi([], [], 5)).toBeNull();
  });

  it("N mayor que los niveles disponibles usa todos los niveles", () => {
    // bids 60, asks 60 → 0
    expect(computeObi(bids, asks, 100)).toBeCloseTo(0, 12);
  });

  it("el resultado siempre está en [-1, 1]", () => {
    const onlyBids: BookLevel[] = [[100, 50]];
    const onlyAsks: BookLevel[] = [[101, 50]];
    expect(computeObi(onlyBids, [], 5)).toBe(1);
    expect(computeObi([], onlyAsks, 5)).toBe(-1);
  });
});

describe("formulas: computeObi equivale a computeDomImbalance sobre todos los niveles", () => {
  it("con todos los niveles, computeObi == computeDomImbalance (tolerancia 1e-12)", () => {
    const bids: BookLevel[] = [
      [100, 12.5],
      [99.5, 3.25],
      [99, 44],
    ];
    const asks: BookLevel[] = [
      [100.5, 7],
      [101, 21.75],
    ];
    const bidTotal = bids.reduce((s, l) => s + l[1], 0);
    const askTotal = asks.reduce((s, l) => s + l[1], 0);
    const obi = computeObi(bids, asks, 100);
    const dom = computeDomImbalance(bidTotal, askTotal);
    expect(obi).not.toBeNull();
    expect(dom).not.toBeNull();
    expect(Math.abs((obi as number) - (dom as number))).toBeLessThan(1e-12);
  });

  it("ambos devuelven null cuando la suma es 0", () => {
    expect(computeObi([], [], 5)).toBeNull();
    expect(computeDomImbalance(0, 0)).toBeNull();
  });
});

describe("formulas: índice de absorción", () => {
  it("candlePriceDelta = close − open en unidades de precio", () => {
    expect(candlePriceDelta(100, 100.5)).toBeCloseTo(0.5, 12);
    expect(candlePriceDelta(100.5, 100)).toBeCloseTo(-0.5, 12);
  });

  it("ΔPrice = 0 ⇒ volumen / epsilon", () => {
    expect(computeAbsorptionIndex(100, 0)).toBeCloseTo(100 / ABSORPTION_EPSILON, 9);
  });

  it("usa |ΔPrice|", () => {
    expect(computeAbsorptionIndex(100, 2)).toBeCloseTo(computeAbsorptionIndex(100, -2) as number, 12);
  });

  it("volumen negativo o entradas no finitas ⇒ null", () => {
    expect(computeAbsorptionIndex(-1, 2)).toBeNull();
    expect(computeAbsorptionIndex(Number.NaN, 2)).toBeNull();
    expect(computeAbsorptionIndex(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Oráculo: el motor de microestructura coincide con las fórmulas      */
/* ------------------------------------------------------------------ */

/** Generador pseudoaleatorio determinista (LCG, semilla fija). */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface OracleCandle {
  tick: number;
  levels: LevelQty[];
}

function generateCandles(count: number, seed: number): OracleCandle[] {
  const rand = makeLcg(seed);
  const ticks = [0.1, 0.5, 1];
  const candles: OracleCandle[] = [];
  for (let c = 0; c < count; c += 1) {
    const tick = ticks[c % ticks.length];
    const base = 1000 + Math.floor(rand() * 500);
    const numLevels = 5 + Math.floor(rand() * 20);
    const levels: LevelQty[] = [];
    for (let i = 0; i < numLevels; i += 1) {
      if (rand() < 0.15) continue; // nivel faltante
      const price = base + i * tick;
      const bidQty = rand() < 0.1 ? 0 : Math.round(rand() * 10000) / 100;
      let askQty = rand() < 0.1 ? 0 : Math.round(rand() * 10000) / 100;
      // De vez en cuando fuerza un imbalance claro en alguna dirección.
      const spike = rand();
      if (spike < 0.05) askQty = Math.round((bidQty + 1) * 40 * 100) / 100;
      else if (spike < 0.1) askQty = Math.round(rand() * 100) / 100;
      levels.push({ price, bidQty, askQty: Math.max(0, askQty) });
    }
    candles.push({ tick, levels });
  }
  return candles;
}

describe("oráculo: computeCandleSignals coincide con las fórmulas de referencia", () => {
  it("400 velas, ticks 0.1/0.5/1, niveles faltantes y ceros: 0 discrepancias", () => {
    const candles = generateCandles(400, 0xC0FFEE);
    let checked = 0;
    const mismatches: string[] = [];

    candles.forEach((candle, ci) => {
      const signals = computeCandleSignals(
        { timestamp: ci, levels: candle.levels },
        { step: candle.tick },
      );
      const reference = computeDiagonalImbalances(candle.levels, candle.tick, { sellMarkRow: "bidRow" });
      const refByIdx = new Map(reference.map(r => [Math.round(r.price / candle.tick), r]));

      expect(signals.levels.length).toBe(reference.length);

      for (const level of signals.levels) {
        const idx = Math.round(level.price / candle.tick);
        const ref = refByIdx.get(idx);
        expect(ref).toBeDefined();
        checked += 1;
        if (level.buyingImbalance !== ref?.buy) {
          mismatches.push(`vela ${ci} idx ${idx}: buyingImbalance motor=${level.buyingImbalance} ref=${ref?.buy}`);
        }
        if (level.sellingImbalance !== ref?.sell) {
          mismatches.push(`vela ${ci} idx ${idx}: sellingImbalance motor=${level.sellingImbalance} ref=${ref?.sell}`);
        }
        const expectedDelta = levelDelta({ bidQty: level.bidVolume, askQty: level.askVolume });
        if (level.delta !== expectedDelta) {
          mismatches.push(`vela ${ci} idx ${idx}: delta motor=${level.delta} ref=${expectedDelta}`);
        }
        const expectedVolume = levelVolume({ bidQty: level.bidVolume, askQty: level.askVolume });
        if (level.totalVolume !== expectedVolume) {
          mismatches.push(`vela ${ci} idx ${idx}: totalVolume motor=${level.totalVolume} ref=${expectedVolume}`);
        }
      }
    });

    expect(checked).toBeGreaterThan(2000);
    expect(mismatches).toEqual([]);
  });
});
