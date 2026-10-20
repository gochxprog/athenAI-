import { describe, expect, it } from "vitest";
import {
  STOPRUN_DEFAULTS,
  StopRunSeries,
  aggregateTradesIntoBars,
  detectStopRuns,
  sanitizeStopRunParams,
  type StopRunBar,
  type StopRunTrade,
} from "./stoprun-detector";

const TICK = 1;
const P = { ...STOPRUN_DEFAULTS, barMs: 1_000, lookbackMs: 60_000, gapMs: 3_000, minBars: 10, rejectBars: 4 };

const bar = (i: number, o: number, h: number, l: number, c: number, buy = 10, sell = 10): StopRunBar => ({ idx: i, t: i * 1000, open: o, high: h, low: l, close: c, buyQty: buy, sellQty: sell });
// 30 barras de rango 100..110 con volumen 20 (mediana 20)
const base = (): StopRunBar[] => Array.from({ length: 30 }, (_, i) => bar(i, 105, 110, 100, 105));

describe("detectStopRuns", () => {
  it("barre el máximo con ráfaga compradora y cierra de vuelta dentro → HIGH", () => {
    const bars = [...base(), bar(30, 109, 113, 108, 112, 60, 5), bar(31, 112, 112, 104, 105, 5, 40)];
    const ev = detectStopRuns(bars, TICK, P);
    expect(ev).toHaveLength(1);
    expect(ev[0].direction).toBe("HIGH");
    expect(ev[0].level).toBe(110);
    expect(ev[0].extreme).toBe(113);
    expect(ev[0].breakT).toBe(30_000);
    expect(ev[0].rejectT).toBe(31_000);
    expect(ev[0].reversal).toBe(8);
    expect(ev[0].burstMultiple).toBeGreaterThanOrEqual(2);
  });

  it("barre el mínimo con ráfaga vendedora y recupera → LOW", () => {
    const bars = [...base(), bar(30, 101, 102, 97, 98, 5, 60), bar(31, 98, 106, 98, 105, 40, 5)];
    const ev = detectStopRuns(bars, TICK, P);
    expect(ev).toHaveLength(1);
    expect(ev[0].direction).toBe("LOW");
    expect(ev[0].level).toBe(100);
  });

  it("ruptura que sigue de largo (sin rechazo) NO es stoprun", () => {
    const bars = [...base(), bar(30, 109, 113, 108, 112, 60, 5), bar(31, 112, 116, 111, 115, 50, 5), bar(32, 115, 119, 114, 118, 50, 5), bar(33, 118, 122, 117, 121, 50, 5), bar(34, 121, 125, 120, 124, 50, 5), bar(35, 124, 128, 123, 127, 50, 5)];
    expect(detectStopRuns(bars, TICK, P)).toHaveLength(0);
  });

  it("deriva lenta de varias barras sobre el nivel NO es ráfaga (la intensidad es por barra)", () => {
    const bars = [
      ...base(),
      bar(30, 109, 112, 108, 111, 30, 0),
      bar(31, 111, 113, 110, 112, 30, 0),
      bar(32, 112, 114, 111, 113, 30, 0),
      bar(33, 113, 114, 111, 112, 30, 0),
      bar(34, 112, 112, 104, 105, 0, 40),
    ];
    expect(detectStopRuns(bars, TICK, P)).toHaveLength(0);
  });

  it("sin ráfaga (volumen normal) NO es stoprun", () => {
    const bars = [...base(), bar(30, 109, 113, 108, 112, 10, 10), bar(31, 112, 112, 104, 105, 10, 10)];
    expect(detectStopRuns(bars, TICK, P)).toHaveLength(0);
  });

  it("ráfaga en sentido contrario al barrido NO cuenta", () => {
    const bars = [...base(), bar(30, 109, 113, 108, 112, 5, 60), bar(31, 112, 112, 104, 105, 5, 40)];
    expect(detectStopRuns(bars, TICK, P)).toHaveLength(0);
  });

  it("ruptura menor que minBreakTicks se ignora", () => {
    const bars = [...base(), bar(30, 109, 110.5, 108, 112, 60, 5), bar(31, 112, 112, 104, 105, 5, 40)];
    expect(detectStopRuns(bars, TICK, { ...P, minBreakTicks: 2 })).toHaveLength(0);
  });

  it("pocas barras de contexto → nada (no se fía de la mediana)", () => {
    const few = Array.from({ length: 5 }, (_, i) => bar(i, 105, 110, 100, 105));
    expect(detectStopRuns([...few, bar(5, 109, 113, 108, 112, 60, 5), bar(6, 112, 112, 104, 105, 5, 40)], TICK, P)).toHaveLength(0);
  });

  it("no cuenta el mismo barrido dos veces y no emite NaN/Infinity", () => {
    const bars = [...base(), bar(30, 109, 113, 108, 112, 60, 5), bar(31, 112, 112, 104, 105, 5, 40)];
    const ev = detectStopRuns(bars, TICK, P);
    expect(ev).toHaveLength(1);
    for (const v of [ev[0].level, ev[0].extreme, ev[0].share, ev[0].burstMultiple, ev[0].reversal]) expect(Number.isFinite(v)).toBe(true);
    expect(detectStopRuns(bars, 0, P)).toEqual([]);
  });
});

describe("aggregateTradesIntoBars / StopRunSeries", () => {
  const trade = (id: number, ts: number, price: number, qty: number, side: "BUY" | "SELL"): StopRunTrade => ({ id, ts, price, qty, side });

  it("agrupa por barra, separa BUY/SELL y no repite ids", () => {
    const bars: StopRunBar[] = [];
    const last = aggregateTradesIntoBars(bars, [trade(1, 100, 10, 2, "BUY"), trade(2, 200, 12, 3, "SELL"), trade(2, 250, 99, 9, "BUY"), trade(3, 1100, 11, 1, "BUY")], 1000, 0);
    expect(last).toBe(3);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ high: 12, low: 10, buyQty: 2, sellQty: 3, close: 12 });
    expect(bars[1]).toMatchObject({ open: 11, buyQty: 1 });
  });

  it("serie en vivo: detecta el barrido cuando llega el rechazo y conserva el evento", () => {
    const s = new StopRunSeries();
    s.setParams(P);
    let id = 0;
    const tr: StopRunTrade[] = [];
    // contexto: 30 s con trades entre 100 y 110 (volumen 20 por barra)
    for (let b = 0; b < 30; b += 1) {
      tr.push(trade(++id, b * 1000 + 100, 100, 10, "SELL"), trade(++id, b * 1000 + 500, 110, 10, "BUY"));
    }
    s.update(tr, TICK); // ancla (no emite del pasado)
    expect(s.events).toHaveLength(0);
    const live: StopRunTrade[] = [...tr];
    live.push(trade(++id, 30_100, 108, 5, "SELL"), trade(++id, 30_300, 113, 60, "BUY"), trade(++id, 30_900, 112, 1, "BUY"));
    s.update(live, TICK);
    expect(s.events).toHaveLength(0); // aún sin rechazo
    live.push(trade(++id, 31_100, 112, 5, "BUY"), trade(++id, 31_500, 104, 40, "SELL"), trade(++id, 31_900, 105, 5, "SELL"));
    s.update(live, TICK);
    live.push(trade(++id, 32_100, 105, 5, "SELL"));
    s.update(live, TICK);
    const ev = s.events;
    expect(ev).toHaveLength(1);
    expect(ev[0].direction).toBe("HIGH");
    // sigue ahí aunque la cinta se recorte
    s.update(live.slice(-2), TICK);
    expect(s.events).toHaveLength(1);
    // y no se duplica al reevaluar
    live.push(trade(++id, 33_100, 105, 5, "SELL"));
    s.update(live, TICK);
    expect(s.events).toHaveLength(1);
  });

  it("snapshot → restore y parámetros saneados", () => {
    const s = new StopRunSeries();
    const restored = StopRunSeries.restore({ v: 1, rows: [["HIGH:110:1", 0, 110, 113, 1, 2, 60, 0.9, 3, 8], ["bad", 9]] });
    expect(restored?.events).toHaveLength(1);
    expect(StopRunSeries.restore({ v: 0 })).toBeNull();
    expect(s.snapshot().rows).toEqual([]);
    const p = sanitizeStopRunParams({ burstMult: 0, minShare: 5, barMs: 10 });
    expect(p.burstMult).toBe(1);
    expect(p.minShare).toBe(1);
    expect(p.barMs).toBe(1000);
  });
});
