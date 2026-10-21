import { describe, expect, it } from "vitest";
import {
  OrderBookEngine,
  barWidth,
  computeDomImbalance,
  percentRank,
  pressureFromImbalance,
} from "./order-book";

function engine(options: Partial<ConstructorParameters<typeof OrderBookEngine>[0]> = {}) {
  return new OrderBookEngine({ symbol: "btcusdt", tickSize: 0.1, ...options });
}

function seeded() {
  const book = engine();
  book.applySnapshot({
    lastUpdateId: 100,
    timestamp: 1_000,
    bids: [
      [67_251.3, 10],
      [67_251.2, 20],
      [67_251.1, 30],
    ],
    asks: [
      [67_251.4, 5],
      [67_251.5, 15],
      [67_251.6, 25],
    ],
  });
  return book;
}

describe("DOM imbalance", () => {
  it("calcula (bid - ask) / (bid + ask)", () => {
    expect(computeDomImbalance(60, 45)).toBeCloseTo(15 / 105, 12);
    expect(computeDomImbalance(10, 0)).toBe(1);
    expect(computeDomImbalance(0, 10)).toBe(-1);
    expect(computeDomImbalance(5, 5)).toBe(0);
  });

  it("devuelve null (nunca NaN/Infinity) cuando no hay liquidez", () => {
    expect(computeDomImbalance(0, 0)).toBeNull();
    expect(computeDomImbalance(Number.NaN, 4)).toBeNull();
    expect(pressureFromImbalance(null)).toBeNull();
  });

  it("deriva la etiqueta del valor mostrado", () => {
    expect(pressureFromImbalance(0.186)).toBe("BUY");
    expect(pressureFromImbalance(-0.01)).toBe("SELL");
    expect(pressureFromImbalance(0.0004)).toBe("NEUTRAL");
    expect(pressureFromImbalance(0)).toBe("NEUTRAL");
  });
});

describe("escala de barras", () => {
  it("L / L_max * ancho máximo", () => {
    expect(barWidth(50, 100, 80)).toBe(40);
    expect(barWidth(100, 100, 80)).toBe(80);
  });

  it("no dibuja barras falsas con L_max = 0", () => {
    expect(barWidth(10, 0, 80)).toBe(0);
    expect(barWidth(0, 100, 80)).toBe(0);
  });
});

describe("OrderBookEngine", () => {
  it("rechaza tickSize inválido", () => {
    expect(() => engine({ tickSize: 0 })).toThrow();
  });

  it("calcula best bid, best ask, spread y mid con el estado real", () => {
    const view = seeded().getView(10);
    expect(view.bestBid).toBe(67_251.3);
    expect(view.bestAsk).toBe(67_251.4);
    expect(view.spread).toBeCloseTo(0.1, 9);
    expect(view.mid).toBeCloseTo(67_251.35, 9);
    expect(view.bids.map(l => l[0])).toEqual([67_251.3, 67_251.2, 67_251.1]);
    expect(view.asks.map(l => l[0])).toEqual([67_251.4, 67_251.5, 67_251.6]);
  });

  it("sin snapshot no inventa valores", () => {
    const view = engine().getView(10);
    expect(view.bestBid).toBeNull();
    expect(view.bestAsk).toBeNull();
    expect(view.spread).toBeNull();
    expect(view.imbalance).toBeNull();
    expect(view.maxSize).toBe(0);
    expect(engine().applyDiff({ finalUpdateId: 1, timestamp: 1, bids: [[1, 1]], asks: [] })).toBe(false);
  });

  it("maneja un solo lado sin lanzar errores", () => {
    const book = engine();
    book.applySnapshot({ lastUpdateId: 1, timestamp: 1, bids: [[100, 3]], asks: [] });
    const view = book.getView(5);
    expect(view.bestBid).toBe(100);
    expect(view.bestAsk).toBeNull();
    expect(view.spread).toBeNull();
    expect(view.mid).toBeNull();
    expect(view.imbalance).toBe(1);
  });

  it("aplica diffs: actualiza, agrega y elimina con tamaño 0 (sin liquidez fantasma)", () => {
    const book = seeded();
    const applied = book.applyDiff({
      finalUpdateId: 101,
      timestamp: 1_100,
      bids: [
        [67_251.3, 0],
        [67_251.0, 7],
      ],
      asks: [[67_251.5, 40]],
    });
    expect(applied).toBe(true);
    const view = book.getView(10);
    expect(view.bestBid).toBe(67_251.2);
    expect(view.bids.map(l => l[0])).toEqual([67_251.2, 67_251.1, 67_251.0]);
    expect(view.asks.find(l => l[0] === 67_251.5)?.[1]).toBe(40);
    expect(book.levelCount().bids).toBe(3);
  });

  it("ignora diffs antiguos", () => {
    const book = seeded();
    expect(book.applyDiff({ finalUpdateId: 100, timestamp: 2, bids: [[67_251.3, 999]], asks: [] })).toBe(false);
    expect(book.getView(1).bids[0][1]).toBe(10);
  });

  it("calcula imbalance sobre los N niveles visibles y L_max", () => {
    const view = seeded().getView(2);
    // bids visibles: 10 + 20 = 30 ; asks visibles: 5 + 15 = 20
    expect(view.bidTotal).toBe(30);
    expect(view.askTotal).toBe(20);
    expect(view.imbalance).toBeCloseTo(10 / 50, 12);
    expect(view.pressure).toBe("BUY");
    expect(view.maxSize).toBe(20);
  });

  it("agrupa por tick size real (bid hacia abajo, ask hacia arriba)", () => {
    const view = seeded().getView(10, 5);
    // idx = precio / 0.1 → bucket de 5 ticks = 0.5
    expect(view.group).toBe(5);
    const bidSum = view.bids.reduce((acc, l) => acc + l[1], 0);
    const askSum = view.asks.reduce((acc, l) => acc + l[1], 0);
    expect(bidSum).toBe(60);
    expect(askSum).toBe(45);
    for (const bid of view.bids) expect(bid[0]).toBeLessThanOrEqual(67_251.3);
    for (const ask of view.asks) expect(ask[0]).toBeGreaterThanOrEqual(67_251.4);
    expect(view.bids[0][0]).toBeLessThan(view.asks[0][0]);
  });

  it("respeta la profundidad pedida", () => {
    const book = engine();
    const bids: Array<[number, number]> = [];
    const asks: Array<[number, number]> = [];
    for (let i = 0; i < 50; i += 1) {
      bids.push([100 - i * 0.1, 1 + i]);
      asks.push([100.1 + i * 0.1, 1 + i]);
    }
    book.applySnapshot({ lastUpdateId: 1, timestamp: 1, bids, asks });
    const view = book.getView(10);
    expect(view.bids).toHaveLength(10);
    expect(view.asks).toHaveLength(10);
  });

  it("detecta libro cruzado para forzar resync", () => {
    const book = seeded();
    expect(book.isCrossed()).toBe(false);
    book.applyDiff({ finalUpdateId: 101, timestamp: 2, bids: [[67_251.4, 3]], asks: [] });
    expect(book.isCrossed()).toBe(true);
  });

  it("reset limpia el libro por completo (cambio de símbolo)", () => {
    const book = seeded();
    book.reset();
    const view = book.getView(10);
    expect(book.isReady()).toBe(false);
    expect(view.bids).toHaveLength(0);
    expect(view.asks).toHaveLength(0);
    expect(view.bestBid).toBeNull();
  });

  it("marca stacking solo con crecimiento persistente en toda la ventana", () => {
    const book = engine({ sampleIntervalMs: 100, historySamples: 4, minRelativeChange: 0.25 });
    book.applySnapshot({
      lastUpdateId: 1,
      timestamp: 1_000,
      bids: [
        [100, 10],
        [99.9, 10],
      ],
      asks: [[100.1, 10]],
    });
    let t = 1_000;
    let id = 1;
    const sizes = [10, 12, 15, 20];
    for (const size of sizes) {
      t += 100;
      id += 1;
      book.applyDiff({ finalUpdateId: id, timestamp: t, bids: [[100, size]], asks: [] });
    }
    const view = book.getView(5);
    expect(view.bids.find(l => l[0] === 100)?.[2]).toBe(1);
    expect(view.bids.find(l => l[0] === 99.9)?.[2]).toBe(0);
    expect(view.flow.stackingQty).toBe(10);
    expect(view.flow.stackingShare).toBe(1);
  });

  it("marca pulling con retirada persistente y no marca ruido aislado", () => {
    const book = engine({ sampleIntervalMs: 100, historySamples: 4, minRelativeChange: 0.25 });
    book.applySnapshot({ lastUpdateId: 1, timestamp: 1_000, bids: [[100, 40]], asks: [[100.1, 40]] });
    let t = 1_000;
    let id = 1;
    const pulling = [40, 30, 22, 15];
    const noisy = [40, 20, 45, 30];
    for (let i = 0; i < 4; i += 1) {
      t += 100;
      id += 1;
      book.applyDiff({
        finalUpdateId: id,
        timestamp: t,
        bids: [[100, pulling[i]]],
        asks: [[100.1, noisy[i]]],
      });
    }
    const view = book.getView(5);
    expect(view.bids[0][2]).toBe(-1);
    expect(view.asks[0][2]).toBe(0);
    expect(view.flow.pullingQty).toBe(25);
  });

  it("no etiqueta tendencia con ventana incompleta", () => {
    const book = engine({ sampleIntervalMs: 100, historySamples: 6 });
    book.applySnapshot({ lastUpdateId: 1, timestamp: 1_000, bids: [[100, 10]], asks: [[100.1, 10]] });
    book.applyDiff({ finalUpdateId: 2, timestamp: 1_100, bids: [[100, 100]], asks: [] });
    expect(book.getView(3).bids[0][2]).toBe(0);
  });

  it("clasifica la liquidez por percentil solo con historial suficiente", () => {
    const book = engine({ sampleIntervalMs: 50 });
    book.applySnapshot({ lastUpdateId: 1, timestamp: 1_000, bids: [[100, 10]], asks: [[100.1, 10]] });
    expect(book.getView(3).liquidity.state).toBeNull();
    let t = 1_000;
    let id = 1;
    for (let i = 0; i < 80; i += 1) {
      t += 50;
      id += 1;
      book.applyDiff({ finalUpdateId: id, timestamp: t, bids: [[100, 10 + (i % 5)]], asks: [] });
    }
    expect(book.getView(3).liquidity.samples).toBeGreaterThanOrEqual(60);
    t += 50;
    id += 1;
    book.applyDiff({ finalUpdateId: id, timestamp: t, bids: [[100, 500]], asks: [] });
    expect(book.getView(3).liquidity.state).toBe("Heavy");
  });

  it("percentRank usa mitad de los empates", () => {
    expect(percentRank([1, 2, 3, 4], 3)).toBeCloseTo((2 + 0.5) / 4, 12);
    expect(percentRank([], 3)).toBeNull();
  });
});

describe("MicroPrice y OBI en la vista", () => {
  it("getView expone microPrice del mejor nivel", () => {
    const book = seeded();
    const view = book.getView(10);
    // bestBid 67251.3 (qty 10), bestAsk 67251.4 (qty 5)
    const expected = (10 * 67251.4 + 5 * 67251.3) / 15;
    expect(view.microPrice).toBeCloseTo(expected, 9);
  });

  it("microPrice se acerca al ask cuando domina el bid", () => {
    const book = engine();
    book.applySnapshot({
      lastUpdateId: 1,
      timestamp: 1_000,
      bids: [[100, 90]],
      asks: [[101, 10]],
    });
    const view = book.getView(5);
    expect(view.microPrice).not.toBeNull();
    expect(view.microPrice as number).toBeGreaterThan(100.5);
    expect(view.microPrice as number).toBeCloseTo((90 * 101 + 10 * 100) / 100, 12);
  });

  it("getView expone obi n5/n10/n20 sobre los niveles visibles", () => {
    const book = seeded();
    const view = book.getView(10);
    // bids visibles: 10+20+30 = 60; asks visibles: 5+15+25 = 45 → (60−45)/(60+45)
    const expected = 15 / 105;
    expect(view.obi?.n5).toBeCloseTo(expected, 12);
    expect(view.obi?.n10).toBeCloseTo(expected, 12);
    expect(view.obi?.n20).toBeCloseTo(expected, 12);
    // El imbalance existente sobre toda la vista no cambia.
    expect(view.imbalance).toBeCloseTo(expected, 12);
  });

  it("obi respeta N aunque haya más niveles visibles", () => {
    const book = engine();
    const bids: Array<readonly [number, number]> = [];
    const asks: Array<readonly [number, number]> = [];
    for (let i = 0; i < 10; i += 1) {
      bids.push([100 - i * 0.1, 10]);
      asks.push([100.1 + i * 0.1, 10]);
    }
    book.applySnapshot({ lastUpdateId: 1, timestamp: 1_000, bids, asks });
    const view = book.getView(10);
    // N=5: 50 vs 50 → 0; el imbalance total también es 0.
    expect(view.obi?.n5).toBe(0);
    expect(view.obi?.n10).toBe(0);
    expect(view.imbalance).toBe(0);
  });

  it("libro vacío: microPrice null y obi con nulls", () => {
    const book = engine();
    book.applySnapshot({ lastUpdateId: 1, timestamp: 1_000, bids: [], asks: [] });
    const view = book.getView(5);
    expect(view.microPrice).toBeNull();
    expect(view.obi).toEqual({ n5: null, n10: null, n20: null });
    expect(view.imbalance).toBeNull();
  });
});

describe("MicroPrice con el libro agrupado", () => {
  it("usa el mejor bid y ask REALES aunque la vista agrupe 10 ticks (valores a mano)", () => {
    const book = engine();
    book.applySnapshot({ lastUpdateId: 1, timestamp: 1, bids: [[100.9, 2], [100.0, 5]], asks: [[101.0, 6], [101.9, 1]] });
    const v = book.getView(10, 10);
    // Vista agrupada: bid 100,0 con 7 (100,9 + 100,0) y ask 101,0 con 6.
    expect(v.bids[0]).toEqual([100, 7, 0]);
    expect(v.asks[0]).toEqual([101, 6, 0]);
    // MicroPrice = (2 × 101,0 + 6 × 100,9) / (2 + 6) = 100,925 ; mid = (100,9 + 101,0) / 2 = 100,95
    expect(v.microPrice).toBeCloseTo(100.925, 9);
    expect(v.mid).toBeCloseTo(100.95, 9);
    // OBI de 5 niveles de la vista: bid 7, ask 6 + 1 = 7 → (7 − 7) / 14 = 0
    expect(v.obi?.n5).toBe(0);
  });
});
