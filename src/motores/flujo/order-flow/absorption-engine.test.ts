import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AbsorptionEngine,
  DEFAULT_ABSORPTION_CONFIG,
  evaluateAbsorptionAt,
  type AbsorptionCandleInput,
} from "./absorption-engine";
import { evaluateExhaustionAt } from "./exhaustion-engine";

// Fixtures deterministas SOLO para pruebas unitarias (el motor nunca genera datos).
const STEP = 1;
const T0 = 1_700_000_000_000;
const MIN = 60_000;

type Row = [price: number, bid: number, ask: number];
const mk = (i: number, rows: Row[], ohlc?: AbsorptionCandleInput["ohlc"]): AbsorptionCandleInput => ({
  timestamp: T0 + i * MIN,
  levels: rows.map(([price, bidQty, askQty]) => ({ price, bidQty, askQty })),
  complete: true,
  ohlc,
});

/** Vela "normal": niveles 100..107 con volumen casi uniforme y algo de varianza. */
const normalCandle = (i: number): AbsorptionCandleInput =>
  mk(i, Array.from({ length: 8 }, (_, k): Row => [100 + k, 9 + ((i + k) % 2), 8 + ((i + 2 * k) % 3)]));

const history = (n: number) => Array.from({ length: n }, (_, i) => normalCandle(i));

/** Vela con ask concentrado en 106 (cerca del high 107) y poco avance posterior. */
const absorbingAsk = (i: number, ohlc?: AbsorptionCandleInput["ohlc"]) =>
  mk(i, [
    [100, 10, 10], [101, 10, 10], [102, 10, 10], [103, 10, 10], [104, 10, 10],
    [105, 6, 25], [106, 5, 40], [107, 4, 20],
  ], ohlc);

describe("AbsorptionEngine", () => {
  it("detecta posible absorción cuando hay agresión alta y poco desplazamiento", () => {
    const candles = [...history(10), absorbingAsk(10)];
    const result = evaluateAbsorptionAt(candles, 10, STEP);
    expect(result.state).toBe("detected");
    const d = result.detections.find(x => x.side === "ask");
    expect(d).toBeDefined();
    expect(d!.price).toBe(106);
    expect(d!.timestamp).toBe(candles[10].timestamp);
    expect(d!.absorbedBy).toBe("sellers");
    expect(d!.raw.aggressiveVolume).toBe(40);
    expect(d!.raw.delta).toBe(35);
    expect(d!.raw.priceDisplacementSteps).toBe(1);
    expect(d!.absorptionScore).toBeGreaterThanOrEqual(DEFAULT_ABSORPTION_CONFIG.minScore);
    expect(d!.absorptionScore).toBeLessThanOrEqual(100);
    expect(result.detections.every(x => x.side === "ask")).toBe(true);
  });

  it("no marca absorción automáticamente si el precio se desplazó de forma proporcional", () => {
    // Mismo volumen agresivo, pero en 102: el precio siguió 5 filas más arriba (5/7 > 0.35).
    const displaced = mk(10, [
      [100, 10, 10], [101, 10, 10], [102, 5, 40], [103, 10, 25], [104, 10, 10],
      [105, 10, 10], [106, 10, 10], [107, 10, 10],
    ]);
    const result = evaluateAbsorptionAt([...history(10), displaced], 10, STEP);
    expect(result.state).toBe("none");
    expect(result.detections).toHaveLength(0);
  });

  it("no detecta si el volumen agresivo es insuficiente", () => {
    const weak = mk(10, [
      [100, 10, 10], [101, 10, 10], [102, 10, 10], [103, 10, 10], [104, 10, 10],
      [105, 6, 10], [106, 5, 11], [107, 4, 10],
    ]);
    const result = evaluateAbsorptionAt([...history(10), weak], 10, STEP);
    expect(result.state).toBe("none");
    // Un mínimo absoluto configurable también bloquea la detección.
    const strict = new AbsorptionEngine({ minAggressiveVolume: 1_000 });
    expect(strict.evaluateAt([...history(10), absorbingAsk(10)], 10, STEP).state).toBe("none");
  });

  it("devuelve insufficientData cuando no hay historia o filas suficientes (sin inventar señal)", () => {
    const short = evaluateAbsorptionAt([...history(2), absorbingAsk(2)], 2, STEP);
    expect(short.state).toBe("insufficientData");
    expect(short.reason).toBe("baseline");
    expect(short.detections).toHaveLength(0);

    const few = evaluateAbsorptionAt([...history(10), mk(10, [[100, 1, 1], [101, 1, 50]])], 10, STEP);
    expect(few.state).toBe("insufficientData");
    expect(few.reason).toBe("fewLevels");

    const empty = evaluateAbsorptionAt([...history(10), mk(10, [])], 10, STEP);
    expect(empty.state).toBe("insufficientData");
    expect(empty.reason).toBe("noLevels");
  });

  it("el score es determinista y reproducible desde sus componentes normalizados", () => {
    const candles = [...history(10), absorbingAsk(10, { open: 105, high: 107, low: 100, close: 105 })];
    const a = evaluateAbsorptionAt(candles, 10, STEP);
    const b = evaluateAbsorptionAt(candles, 10, STEP);
    expect(b).toEqual(a);
    const d = a.detections[0];
    const w = DEFAULT_ABSORPTION_CONFIG.weights;
    let num = 0, den = 0;
    for (const key of d.componentsUsed) { num += w[key] * (d.normalized[key] as number); den += w[key]; }
    expect(d.absorptionScore).toBeCloseTo(100 * num / den, 1);
    // closeFailure solo existe con OHLC real; sin él el componente no se usa ni se inventa.
    expect(d.componentsUsed).toContain("closeFailure");
    const noOhlc = evaluateAbsorptionAt([...history(10), absorbingAsk(10)], 10, STEP).detections[0];
    expect(noOhlc.raw.closeFailure).toBeNull();
    expect(noOhlc.componentsUsed).not.toContain("closeFailure");
  });

  it("detecta el lado vendedor (absorción por compradores) con side y precio correctos", () => {
    const sellAggression = mk(10, [
      [100, 20, 4], [101, 40, 5], [102, 25, 6], [103, 10, 10], [104, 10, 10],
      [105, 10, 10], [106, 10, 10], [107, 10, 10],
    ]);
    const result = evaluateAbsorptionAt([...history(10), sellAggression], 10, STEP);
    const d = result.detections[0];
    expect(result.state).toBe("detected");
    expect(d.side).toBe("bid");
    expect(d.absorbedBy).toBe("buyers");
    expect(d.price).toBe(101);
    expect(d.raw.delta).toBe(-35);
  });

  it("es independiente de ExhaustionEngine: mismos resultados en cualquier orden y sin importarlo", () => {
    const candles = [...history(10), absorbingAsk(10)];
    const alone = evaluateAbsorptionAt(candles, 10, STEP);
    evaluateExhaustionAt(candles, 10, STEP);
    expect(evaluateAbsorptionAt(candles, 10, STEP)).toEqual(alone);
    const source = readFileSync(join(__dirname, "absorption-engine.ts"), "utf8");
    expect(source).not.toMatch(/exhaustion-engine/);
  });

  it("evaluateFrom solo procesa la cola indicada (procesamiento incremental)", () => {
    const candles = [...history(10), absorbingAsk(10)];
    const engine = new AbsorptionEngine();
    const tail = engine.evaluateFrom(candles, 10, STEP);
    expect(tail).toHaveLength(1);
    expect(tail[0]).toEqual(engine.evaluateAll(candles, STEP)[10]);
  });
});
