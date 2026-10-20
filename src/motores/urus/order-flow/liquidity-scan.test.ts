import { describe, expect, it } from "vitest";
import { medianSize, scanLiquidityWalls } from "./liquidity-scan";
import type { BookLevelTuple } from "./order-book";

const lv = (price: number, size: number, trend: -1 | 0 | 1 = 0): BookLevelTuple => [price, size, trend];

function view(bids: BookLevelTuple[], asks: BookLevelTuple[], mid: number | null = 100, tickSize = 1, group = 1) {
  return { bids, asks, mid, tickSize, group };
}

describe("medianSize", () => {
  it("mediana impar y par", () => {
    expect(medianSize([lv(1, 1), lv(2, 5), lv(3, 3)])).toBe(3);
    expect(medianSize([lv(1, 1), lv(2, 3), lv(3, 5), lv(4, 7)])).toBe(4);
  });
  it("ignora ceros y no finitos; vacío → 0", () => {
    expect(medianSize([lv(1, 0), lv(2, Number.NaN), lv(3, 4)])).toBe(4);
    expect(medianSize([])).toBe(0);
    expect(medianSize([lv(1, 0)])).toBe(0);
  });
});

describe("scanLiquidityWalls", () => {
  const bids = [lv(99, 10), lv(98, 10), lv(97, 100, 1), lv(96, 10), lv(95, 10)];
  const asks = [lv(101, 10), lv(102, 10), lv(103, 10), lv(104, 60, -1), lv(105, 10)];

  it("detecta solo niveles ≥ 3× la mediana de su lado y los ordena por tamaño", () => {
    const walls = scanLiquidityWalls(view(bids, asks));
    expect(walls.map(w => [w.side, w.price])).toEqual([["bid", 97], ["ask", 104]]);
    expect(walls[0].ratio).toBeCloseTo(10, 9);
    expect(walls[1].ratio).toBeCloseTo(6, 9);
  });

  it("conserva el trend real (stacking/pulling)", () => {
    const walls = scanLiquidityWalls(view(bids, asks));
    expect(walls[0].trend).toBe(1);
    expect(walls[1].trend).toBe(-1);
  });

  it("calcula la distancia al mid en precio y en cubos (tick × group)", () => {
    const walls = scanLiquidityWalls(view(bids, asks, 100, 0.5, 2));
    const bid = walls.find(w => w.side === "bid")!;
    expect(bid.distance).toBe(3);
    expect(bid.distanceBuckets).toBe(3);
  });

  it("minRatio más alto filtra más; rangeBuckets limita el alcance", () => {
    expect(scanLiquidityWalls(view(bids, asks), { minRatio: 8 }).map(w => w.price)).toEqual([97]);
    expect(scanLiquidityWalls(view(bids, asks), { rangeBuckets: 3 }).map(w => w.price)).toEqual([97]);
  });

  it("maxRows recorta el resultado", () => {
    expect(scanLiquidityWalls(view(bids, asks), { maxRows: 1 })).toHaveLength(1);
    expect(scanLiquidityWalls(view(bids, asks), { maxRows: 0 })).toHaveLength(0);
  });

  it("sin mid, sin tick válido, sin vista o libro vacío → []", () => {
    expect(scanLiquidityWalls(view(bids, asks, null))).toEqual([]);
    expect(scanLiquidityWalls(view(bids, asks, Number.NaN))).toEqual([]);
    expect(scanLiquidityWalls(view(bids, asks, 100, 0))).toEqual([]);
    expect(scanLiquidityWalls(null)).toEqual([]);
    expect(scanLiquidityWalls(view([], []))).toEqual([]);
  });

  it("un lado sin liquidez no rompe el otro y nunca produce NaN/Infinity", () => {
    const walls = scanLiquidityWalls(view([lv(99, 0)], asks));
    expect(walls.every(w => w.side === "ask")).toBe(true);
    for (const w of walls) {
      for (const n of [w.price, w.size, w.ratio, w.distance, w.distanceBuckets]) expect(Number.isFinite(n)).toBe(true);
    }
  });

  it("empate de tamaño: el más cercano al mid primero", () => {
    const a = [lv(101, 10), lv(102, 10), lv(103, 10), lv(110, 50)];
    const b = [lv(99, 10), lv(98, 10), lv(97, 10), lv(92, 50)];
    const walls = scanLiquidityWalls(view(b, a));
    expect(walls.map(w => w.price)).toEqual([92, 110]); // distancias 8 y 10
  });
});
