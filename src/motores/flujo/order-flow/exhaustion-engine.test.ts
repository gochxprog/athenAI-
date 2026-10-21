import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAbsorptionAt } from "./absorption-engine";
import {
  DEFAULT_EXHAUSTION_CONFIG,
  ExhaustionEngine,
  evaluateExhaustionAt,
  type ExhaustionCandleInput,
} from "./exhaustion-engine";

// Fixtures deterministas SOLO para pruebas unitarias (el motor nunca genera datos).
const STEP = 1;
const T0 = 1_700_000_000_000;
const MIN = 60_000;

type Row = [price: number, bid: number, ask: number];
const mk = (i: number, rows: Row[], ohlc?: ExhaustionCandleInput["ohlc"]): ExhaustionCandleInput => ({
  timestamp: T0 + i * MIN,
  levels: rows.map(([price, bidQty, askQty]) => ({ price, bidQty, askQty })),
  complete: true,
  ohlc,
});

const normalCandle = (i: number): ExhaustionCandleInput =>
  mk(i, Array.from({ length: 8 }, (_, k): Row => [100 + k, 9 + ((i + k) % 2), 8 + ((i + 2 * k) % 3)]));
const history = (n: number) => Array.from({ length: n }, (_, i) => normalCandle(i));

/** Empuje alcista (104..111): aproximación 107-109 muy agresiva y extremo 110-111 casi sin agresión. */
const fadingUp = (i: number, ohlc?: ExhaustionCandleInput["ohlc"], extremeAsk: [number, number] = [8, 4]) =>
  mk(i, [
    [104, 10, 10], [105, 10, 12], [106, 10, 15], [107, 6, 30], [108, 6, 32], [109, 6, 28],
    [110, 5, extremeAsk[0]], [111, 5, extremeAsk[1]],
  ], ohlc);

/** Empuje bajista espejo (96..103) sobre un historial que opera 100..107. */
const fadingDown = (i: number, ohlc?: ExhaustionCandleInput["ohlc"]) =>
  mk(i, [
    [96, 4, 5], [97, 8, 5], [98, 30, 6], [99, 32, 6], [100, 28, 6],
    [101, 15, 10], [102, 12, 10], [103, 10, 10],
  ], ohlc);

const UP_OHLC = { open: 104, high: 111.9, low: 104, close: 108 }; // cierre lejos del high
const UP_AT_HIGH = { open: 104, high: 111.9, low: 104, close: 111.8 }; // cierre pegado al high

describe("ExhaustionEngine", () => {
  it("detecta posible bullish exhaustion: agresión fuerte en el extremo + pérdida de continuación", () => {
    const candles = [...history(10), fadingUp(10, UP_OHLC)];
    const result = evaluateExhaustionAt(candles, 10, STEP);
    expect(result.state).toBe("detected");
    const d = result.detections[0];
    expect(d.side).toBe("bullish");
    expect(d.aggressorSide).toBe("ask");
    expect(d.price).toBe(111);
    expect(d.timestamp).toBe(candles[10].timestamp);
    expect(d.raw.decayRatio).toBeLessThan(DEFAULT_EXHAUSTION_CONFIG.maxDecayRatio);
    expect(d.raw.extremePosition).toBe(1);
    expect(d.exhaustionScore).toBeGreaterThanOrEqual(DEFAULT_EXHAUSTION_CONFIG.minScore);
    expect(d.exhaustionScore).toBeLessThanOrEqual(100);
    expect(result.detections.every(x => x.side === "bullish")).toBe(true);
  });

  it("no marca exhaustion automáticamente si la agresión sigue con continuación normal", () => {
    // El extremo conserva la agresión (sin decaimiento) y el cierre queda en el high.
    const continuing = [...history(10), fadingUp(10, UP_AT_HIGH, [31, 30])];
    expect(evaluateExhaustionAt(continuing, 10, STEP).state).toBe("none");
    // Hay decaimiento de agresión pero el precio cierra en el high (sin falta de continuación).
    const closesAtHigh = [...history(10), fadingUp(10, UP_AT_HIGH)];
    expect(evaluateExhaustionAt(closesAtHigh, 10, STEP).state).toBe("none");
  });

  it("no detecta si el volumen agresivo de aproximación es insuficiente", () => {
    const weak = mk(10, [
      [104, 10, 10], [105, 10, 12], [106, 10, 15], [107, 6, 6], [108, 6, 6], [109, 6, 6],
      [110, 5, 1], [111, 5, 1],
    ], UP_OHLC);
    expect(evaluateExhaustionAt([...history(10), weak], 10, STEP).state).toBe("none");
    const strict = new ExhaustionEngine({ minAggressiveVolume: 10_000 });
    expect(strict.evaluateAt([...history(10), fadingUp(10, UP_OHLC)], 10, STEP).state).toBe("none");
  });

  it("devuelve insufficientData sin base, sin contexto o sin evidencia de continuación", () => {
    const noBaseline = evaluateExhaustionAt([...history(2), fadingUp(2, UP_OHLC)], 2, STEP);
    expect(noBaseline.state).toBe("insufficientData");
    expect(noBaseline.reason).toBe("baseline");

    const noContinuation = evaluateExhaustionAt([...history(10), fadingUp(10)], 10, STEP);
    expect(noContinuation.state).toBe("insufficientData");
    expect(noContinuation.reason).toBe("noContinuationEvidence");
    expect(noContinuation.detections).toHaveLength(0);

    const few = evaluateExhaustionAt([...history(10), mk(10, [[100, 1, 1], [101, 1, 9]], UP_OHLC)], 10, STEP);
    expect(few.state).toBe("insufficientData");
    expect(few.reason).toBe("fewLevels");
  });

  it("el score es determinista y reproducible desde sus componentes normalizados", () => {
    const candles = [...history(10), fadingUp(10, UP_OHLC)];
    const a = evaluateExhaustionAt(candles, 10, STEP);
    expect(evaluateExhaustionAt(candles, 10, STEP)).toEqual(a);
    const d = a.detections[0];
    const w = DEFAULT_EXHAUSTION_CONFIG.weights;
    let num = 0, den = 0;
    for (const key of d.componentsUsed) { num += w[key] * (d.normalized[key] as number); den += w[key]; }
    expect(d.exhaustionScore).toBeCloseTo(100 * num / den, 1);
  });

  it("detecta bearish exhaustion con side, precio y lado agresor correctos", () => {
    const ohlc = { open: 103, high: 103, low: 96.1, close: 99 }; // rebote desde el low
    const candles = [...history(10), fadingDown(10, ohlc)];
    const result = evaluateExhaustionAt(candles, 10, STEP);
    expect(result.state).toBe("detected");
    const d = result.detections[0];
    expect(d.side).toBe("bearish");
    expect(d.aggressorSide).toBe("bid");
    expect(d.price).toBe(96);
    expect(result.detections.every(x => x.side === "bearish")).toBe(true);
  });

  it("usa la vela siguiente como evidencia de continuación cuando no hay OHLC", () => {
    const stalls = mk(11, [[104, 10, 10], [105, 10, 10], [106, 10, 10], [107, 10, 10], [108, 10, 10], [109, 10, 10], [110, 10, 10], [111, 10, 10]]);
    const runs = mk(11, [[108, 10, 10], [109, 10, 10], [110, 10, 10], [111, 10, 10], [112, 10, 10], [113, 10, 10], [114, 10, 10], [115, 10, 10]]);
    expect(evaluateExhaustionAt([...history(10), fadingUp(10), stalls], 10, STEP).state).toBe("detected");
    expect(evaluateExhaustionAt([...history(10), fadingUp(10), runs], 10, STEP).state).toBe("none");
  });

  it("es independiente de AbsorptionEngine: mismos resultados en cualquier orden y sin importarlo", () => {
    const candles = [...history(10), fadingUp(10, UP_OHLC)];
    const alone = evaluateExhaustionAt(candles, 10, STEP);
    evaluateAbsorptionAt(candles, 10, STEP);
    expect(evaluateExhaustionAt(candles, 10, STEP)).toEqual(alone);
    const source = readFileSync(join(__dirname, "exhaustion-engine.ts"), "utf8");
    expect(source).not.toMatch(/absorption-engine/);
  });
});
