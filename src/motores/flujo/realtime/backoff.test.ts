import { describe, expect, it } from "vitest";
import { Backoff, computeBackoffDelay, parseRetryAfterMs } from "./backoff";

describe("computeBackoffDelay", () => {
  const opts = { baseMs: 1_000, maxMs: 30_000, jitter: "none" as const };

  it("crece exponencialmente y respeta el techo", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(n => computeBackoffDelay(n, opts))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it("full jitter reparte los reintentos entre el suelo y el retardo exponencial", () => {
    const full = { baseMs: 1_000, maxMs: 30_000, jitter: "full" as const, floorMs: 500 };
    expect(computeBackoffDelay(3, full, () => 0)).toBe(500);
    expect(computeBackoffDelay(3, full, () => 1)).toBe(4_000);
    const mid = computeBackoffDelay(3, full, () => 0.5);
    expect(mid).toBeGreaterThan(500);
    expect(mid).toBeLessThan(4_000);
  });

  it("equal jitter nunca baja de la mitad", () => {
    const equal = { baseMs: 1_000, maxMs: 30_000, jitter: "equal" as const };
    expect(computeBackoffDelay(4, equal, () => 0)).toBe(4_000);
    expect(computeBackoffDelay(4, equal, () => 1)).toBe(8_000);
  });

  it("clientes con rng distinto NO reintentan en el mismo instante (anti efecto manada)", () => {
    const full = { baseMs: 1_000, maxMs: 30_000, jitter: "full" as const, floorMs: 250 };
    const delays = [0.05, 0.3, 0.55, 0.8, 0.97].map(r => computeBackoffDelay(4, full, () => r));
    expect(new Set(delays).size).toBe(delays.length);
  });

  it("el suelo evita reintentos inmediatos", () => {
    const full = { baseMs: 100, maxMs: 30_000, jitter: "full" as const, floorMs: 500 };
    expect(computeBackoffDelay(1, full, () => 0)).toBeGreaterThanOrEqual(100);
    const floored = { baseMs: 1_000, maxMs: 30_000, jitter: "full" as const, floorMs: 500 };
    expect(computeBackoffDelay(1, floored, () => 0)).toBe(500);
  });
});

describe("Backoff", () => {
  it("avanza con next() y vuelve a empezar con reset()", () => {
    const b = new Backoff({ baseMs: 1_000, maxMs: 8_000, jitter: "none" });
    expect([b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
    expect(b.attemptCount).toBe(5);
    b.reset();
    expect(b.next()).toBe(1_000);
  });
});

describe("parseRetryAfterMs", () => {
  it("segundos, fecha HTTP e inválidos", () => {
    expect(parseRetryAfterMs("12")).toBe(12_000);
    expect(parseRetryAfterMs("1.5")).toBe(1_500);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("nonsense")).toBeNull();
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:00 GMT", now + 5_000)).toBe(0);
  });
});
