import { describe, expect, it } from "vitest";
import {
  ICEBERG_DEFAULTS,
  IcebergTracker,
  fillsByLevel,
  sanitizeIcebergParams,
  stepIcebergs,
  type IcebergColumn,
  type IcebergEvent,
  type IcebergHistory,
  type IcebergTrade,
} from "./iceberg-detector";

const STEP = 1;
// idx 95..105; bestBid = 100 → idx<=100 bid, idx>=101 ask
const col = (t: number, sizes: Record<number, number>, extra: Partial<IcebergColumn> = {}): IcebergColumn => {
  const arr = new Float32Array(11);
  for (const [idx, v] of Object.entries(sizes)) arr[Number(idx) - 95] = v;
  return { t, minIdx: 95, bestBidIdx: 100, sizes: arr, ...extra };
};
const buy = (ts: number, price: number, qty: number): IcebergTrade => ({ ts, price, qty, side: "BUY" });
const sell = (ts: number, price: number, qty: number): IcebergTrade => ({ ts, price, qty, side: "SELL" });
const mkHistory = (cols: IcebergColumn[]): IcebergHistory => ({ size: cols.length, step: STEP, get: i => cols[i] });

describe("fillsByLevel", () => {
  it("BUY agresor cuenta en el ask y SELL agresor en el bid; ignora lado incoherente y fuera de intervalo", () => {
    const a = col(0, { 101: 10, 100: 10 });
    const b = col(1000, { 101: 10, 100: 10 });
    const m = fillsByLevel(a, b, [buy(200, 101, 3), sell(300, 100, 2), buy(400, 100, 9), sell(500, 101, 9), buy(2000, 101, 9)], STEP, 60);
    expect(m.get("ASK:101")).toBe(3);
    expect(m.get("BID:100")).toBe(2);
    expect(m.size).toBe(2);
  });
});

describe("stepIcebergs", () => {
  const run = (pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]>, p = ICEBERG_DEFAULTS) => {
    const cand = new Map();
    const events = new Map<string, IcebergEvent>();
    for (const [a, b, tr] of pairs) stepIcebergs(cand, a, b, tr, STEP, p, events);
    return { cand, events };
  };

  it("un nivel que se repone tras ser golpeado varias veces → iceberg de venta (ASK)", () => {
    // punta visible 10; cada segundo se ejecutan 10 y reaparecen 10
    const pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]> = [];
    for (let k = 0; k < 5; k += 1) pairs.push([col(k * 1000, { 101: 10 }), col((k + 1) * 1000, { 101: 10 }), [buy(k * 1000 + 500, 101, 10)]]);
    const { events } = run(pairs);
    const ev = [...events.values()][0];
    expect(ev).toBeDefined();
    expect(ev.side).toBe("ASK");
    expect(ev.price).toBe(101);
    expect(ev.filled).toBe(50);
    expect(ev.peakVisible).toBe(10);
    expect(ev.reloads).toBe(5);
    expect(ev.ratio).toBe(5);
  });

  it("lado BID con agresor SELL", () => {
    const pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]> = [];
    for (let k = 0; k < 4; k += 1) pairs.push([col(k * 1000, { 99: 8 }), col((k + 1) * 1000, { 99: 8 }), [sell(k * 1000 + 100, 99, 8)]]);
    const { events } = run(pairs);
    expect([...events.values()][0]?.side).toBe("BID");
  });

  it("liquidez que simplemente se consume (sin reposición) NO es iceberg", () => {
    const pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]> = [
      [col(0, { 101: 30 }), col(1000, { 101: 20 }), [buy(500, 101, 10)]],
      [col(1000, { 101: 20 }), col(2000, { 101: 10 }), [buy(1500, 101, 10)]],
      [col(2000, { 101: 10 }), col(3000, { 101: 0 }), [buy(2500, 101, 10)]],
    ];
    expect(run(pairs).events.size).toBe(0);
  });

  it("pocas recargas no alcanzan (minReloads)", () => {
    const pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]> = [];
    for (let k = 0; k < 2; k += 1) pairs.push([col(k * 1000, { 101: 10 }), col((k + 1) * 1000, { 101: 10 }), [buy(k * 1000 + 500, 101, 10)]]);
    expect(run(pairs).events.size).toBe(0);
  });

  it("sin liquidez visible antes del trade no se evalúa (no hay punta que comparar)", () => {
    const pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]> = [];
    for (let k = 0; k < 6; k += 1) pairs.push([col(k * 1000, {}), col((k + 1) * 1000, { 101: 10 }), [buy(k * 1000 + 500, 101, 10)]]);
    expect(run(pairs).events.size).toBe(0);
  });

  it("consumos minúsculos (<10 % de lo visible) no cuentan como recarga: ruido, no iceberg", () => {
    const pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]> = [];
    for (let k = 0; k < 30; k += 1) pairs.push([col(k * 1000, { 101: 100 }), col((k + 1) * 1000, { 101: 100 }), [buy(k * 1000 + 500, 101, 4)]]);
    const cand = new Map();
    const events = new Map<string, IcebergEvent>();
    for (const [a, b, tr] of pairs) stepIcebergs(cand, a, b, tr, STEP, { ...ICEBERG_DEFAULTS, minMultiple: 1, minReloads: 3 }, events);
    expect(events.size).toBe(0);
  });

  it("stepIcebergs informa si algún evento cambió (y no si no pasó nada)", () => {
    const cand = new Map();
    const events = new Map<string, IcebergEvent>();
    expect(stepIcebergs(cand, col(0, { 101: 10 }), col(1000, { 101: 10 }), [], STEP, ICEBERG_DEFAULTS, events)).toBe(false);
  });

  it("minQty filtra icebergs pequeños", () => {
    const pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]> = [];
    for (let k = 0; k < 5; k += 1) pairs.push([col(k * 1000, { 101: 10 }), col((k + 1) * 1000, { 101: 10 }), [buy(k * 1000 + 500, 101, 10)]]);
    expect(run(pairs, { ...ICEBERG_DEFAULTS, minQty: 100 }).events.size).toBe(0);
  });

  it("confianza alta con el doble de los umbrales y 'active' pasa a false tras idleMs", () => {
    const pairs: Array<[IcebergColumn, IcebergColumn, IcebergTrade[]]> = [];
    for (let k = 0; k < 8; k += 1) pairs.push([col(k * 1000, { 101: 10 }), col((k + 1) * 1000, { 101: 10 }), [buy(k * 1000 + 500, 101, 10)]]);
    const p = { ...ICEBERG_DEFAULTS, idleMs: 5_000 };
    const cand = new Map();
    const events = new Map<string, IcebergEvent>();
    for (const [a, b, tr] of pairs) stepIcebergs(cand, a, b, tr, STEP, p, events);
    expect([...events.values()][0].confidence).toBe("alta");
    expect([...events.values()][0].active).toBe(true);
    stepIcebergs(cand, col(8000, {}), col(20_000, {}), [], STEP, p, events);
    expect([...events.values()][0].active).toBe(false);
    expect(cand.size).toBe(0);
  });
});

describe("IcebergTracker", () => {
  it("arranca vacío y no produce NaN", () => {
    const cols: IcebergColumn[] = [col(0, { 101: 10 })];
    const tr: IcebergTrade[] = [];
    const tracker = new IcebergTracker();
    tracker.update(mkHistory(cols), tr); // ancla
    expect(tracker.events).toHaveLength(0);
    for (let k = 1; k <= 6; k += 1) {
      cols.push(col(k * 1000, { 101: 10 }));
      tr.push(buy(k * 1000 - 500, 101, 10));
      tracker.update(mkHistory(cols), tr);
    }
    const ev = tracker.events;
    expect(ev).toHaveLength(1);
    for (const v of [ev[0].ratio, ev[0].filled, ev[0].price]) expect(Number.isFinite(v)).toBe(true);

  });

  it("snapshot → restore conserva los eventos (como inactivos) y descarta filas corruptas", () => {
    const cols: IcebergColumn[] = [col(0, { 101: 10 })];
    const tr: IcebergTrade[] = [];
    const t = new IcebergTracker();
    t.update(mkHistory(cols), tr);
    for (let k = 1; k <= 6; k += 1) {
      cols.push(col(k * 1000, { 101: 10 }));
      tr.push(buy(k * 1000 - 500, 101, 10));
      t.update(mkHistory(cols), tr);
    }
    const snap = t.snapshot();
    const back = IcebergTracker.restore(JSON.parse(JSON.stringify(snap)));
    expect(back?.events).toHaveLength(1);
    expect(back?.events[0].active).toBe(false);
    expect(IcebergTracker.restore({ v: 1, rows: [["x", 5, "a"]] })?.events).toHaveLength(0);
    expect(IcebergTracker.restore({ v: 2 })).toBeNull();
  });

  it("sanitiza parámetros fuera de rango", () => {
    const p = sanitizeIcebergParams({ minMultiple: -3, minReloads: 999, idleMs: Number.NaN, bandLevels: 0 });
    expect(p.minMultiple).toBe(1);
    expect(p.minReloads).toBe(20);
    expect(p.idleMs).toBe(ICEBERG_DEFAULTS.idleMs);
    expect(p.bandLevels).toBe(5);
  });
});
