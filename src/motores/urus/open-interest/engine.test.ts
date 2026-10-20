import { describe, expect, it } from "vitest";
import { computeOpenInterest, robustZ } from "./engine";
import type { OpenInterestSnapshot } from "./types";
const candle = (timestamp: number, close: number, volume = 100, delta = 10) => ({ timestamp, open: close, high: close + 1, low: close - 1, close, volume, delta });
const snap = (time: number, oiContracts: number, oiValue: number | null = null): OpenInterestSnapshot => ({ symbol: "BTCUSDT", time, oiContracts, oiValue, markPrice: null, source: "poll" });
describe("open interest engine", () => {
  it("step-holds the last snapshot and does not impute missing head data", () => {
    const r = computeOpenInterest([candle(1_000, 101), candle(2_000, 102)], [snap(1_500, 10)]);
    expect(r.points[0].gap).toBe(true);
    expect(r.points[1].oiContracts).toBe(10);
  });
  it("returns null for zero OI previous percentage", () => {
    // F3.1: con la validación OI > 0, un snapshot con OI=0 se rechaza en la ingesta:
    // no hay OI previo válido → deltas nulos (no se propaga un cero corrupto).
    const r = computeOpenInterest([candle(1_000, 100), candle(2_000, 101)], [snap(1_000, 0), snap(2_000, 1)]);
    expect(r.points[1].oiContracts).toBe(1);
    expect(r.points[1].deltaOi).toBeNull();
    expect(r.points[1].deltaOiPct).toBeNull();
  });
  it("F3: %ΔOI se expresa en porcentaje (×100)", () => {
    const r = computeOpenInterest(
      [candle(1_000, 100), candle(2_000, 101)],
      [snap(1_000, 100), snap(2_000, 110)]
    );
    expect(r.points[1].deltaOi).toBe(10);
    expect(r.points[1].deltaOiPct).toBeCloseTo(10, 10);
  });
  it("F3: forward-fill arrastra el último OI válido cuando no hay snapshot ≤ cierre", () => {
    // La vela B cierra (closeTime) antes del primer snapshot: no hay snapshot ≤ su
    // cierre, pero sí OI previo válido → forward-fill, gap=true, sin imputar desde cero.
    const a = { timestamp: 1_000, closeTime: 5_000, open: 100, high: 101, low: 99, close: 100, volume: 100, delta: 10 };
    const b = { timestamp: 2_000, closeTime: 1_500, open: 100, high: 101, low: 99, close: 100, volume: 100, delta: 10 };
    const r = computeOpenInterest([a, b], [snap(3_000, 50)]);
    expect(r.points[0].oiContracts).toBe(50);
    expect(r.points[0].gap).toBe(false);
    expect(r.points[1].gap).toBe(true);
    expect(r.points[1].oiContracts).toBe(50);
    expect(r.points[1].deltaOi).toBe(0);
  });
  it("F3: sin OI previo no se imputa nada (gap sin dato)", () => {
    const r = computeOpenInterest([candle(1_000, 101), candle(2_000, 102)], [snap(1_500, 10)]);
    expect(r.points[0].gap).toBe(true);
    expect(r.points[0].oiContracts).toBeNull();
    expect(r.points[1].oiContracts).toBe(10);
  });
  it("F3: spike guard marca anomaly con |z(ΔOI)| > 5", () => {
    const candles = [];
    const snaps = [];
    // Baseline con dispersión real (deltas todos distintos → MAD > 0).
    for (let i = 0; i < 30; i += 1) {
      candles.push(candle((i + 1) * 1_000, 100));
      snaps.push(snap((i + 1) * 1_000, 100 + ((i * i) % 31)));
    }
    // Pico corrupto: el OI se multiplica ×50 de una vela a otra.
    candles.push(candle(31_000, 100));
    snaps.push(snap(31_000, 5_000));
    const r = computeOpenInterest(candles, snaps);
    const last = r.points.at(-1)!;
    expect(Math.abs(last.deltaOiZ ?? 0)).toBeGreaterThan(5);
    expect(last.anomaly).toBe(true);
    // Sin historial no hay z: no se marca anomalía.
    expect(r.points[0].anomaly).toBe(false);
  });
  it("MAD zero normalization is zero", () => expect(robustZ(5, [5, 5, 5])).toBe(0));
  it("does not recalculate aggressive delta", () => {
    const r = computeOpenInterest([candle(1_000, 100, 100, 999), candle(2_000, 101, 100, 999)], [snap(1_000, 10), snap(2_000, 12)]);
    expect(r.points[1].aggressiveDelta).toBe(999);
  });
});

describe("open interest engine: quadrants and profile", () => {
  const c = (t: number, close: number) => ({ timestamp: t, open: close, high: close + 1, low: close - 1, close, volume: 100, delta: 10, buyVolume: 55 });
  const candles = [c(1_000, 100), c(2_000, 101), c(3_000, 100), c(4_000, 99), c(5_000, 102)];
  const snaps = [snap(1_000, 100), snap(2_000, 110), snap(3_000, 105), snap(4_000, 120), snap(5_000, 118)];
  it("classifies price × OI quadrants", () => {
    const q = computeOpenInterest(candles, snaps).points.map(p => p.quadrant);
    expect(q.slice(1)).toEqual(["longs_nuevos", "liquidacion_longs", "shorts_nuevos", "cobertura_shorts"]);
  });
  it("profile invariant: sum of buckets = OI_t − OI_0 and never negative", () => {
    const { profile } = computeOpenInterest(candles, snaps);
    const sum = profile!.buckets.reduce((a, b) => a + b.longOpen + b.shortOpen, 0);
    expect(sum).toBeCloseTo(118 - 100, 9);
    expect(profile!.buckets.every(b => b.longOpen >= 0 && b.shortOpen >= 0)).toBe(true);
  });
});

describe("open interest engine: stale", () => {
  it("does not mark an open candle stale just because its close is in the future", () => {
    const cs = [{ timestamp: 0, closeTime: 60_000, open: 1, high: 2, low: 0, close: 1, volume: 1 }];
    const p = computeOpenInterest(cs, [snap(1_000, 10)], { nowMs: 3_000 }).points[0];
    expect(p.ageMs).toBe(2_000);
    expect(p.stale).toBe(false);
  });
  it("uses a 10 min limit for 5m historical snapshots", () => {
    const cs = [{ timestamp: 0, closeTime: 300_000, open: 1, high: 2, low: 0, close: 1, volume: 1 }];
    const hist = { ...snap(0, 10), source: "hist" as const };
    expect(computeOpenInterest(cs, [hist], { nowMs: 400_000 }).points[0].stale).toBe(false);
  });
});
