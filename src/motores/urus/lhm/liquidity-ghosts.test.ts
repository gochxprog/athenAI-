import { describe, expect, it } from "vitest";
import { LiquidityHistory, type LiquidityColumn } from "./liquidity-history";
import {
  DEFAULT_POOL_CONFIG,
  LiquidityPoolEngine,
  type PoolConfig,
} from "./liquidity-pools";

/**
 * Tests de la huella de absorción (marca fantasma) con valores fijos de prueba.
 * Verifica: el barrido registra huella con precio/lado/tiempos, el retiro NO deja
 * huella, la huella expira tras el TTL, clear() la borra y el barrido por vela
 * también la genera.
 */

const STEP = 1;
const T0 = 1_700_000_000_000;

function col(t: number, bestBidIdx: number, sizes: number[], minIdx = 0): LiquidityColumn {
  return { t, minIdx, bestBidIdx, sizes: new Float32Array(sizes) };
}

/** Libro base: 20 niveles, mejor ask en idx 10 con volumen 1 → mid = 9.5. */
function baseSizes(): number[] {
  const s = new Array(20).fill(0);
  s[10] = 1; // mejor ask: fija el mid en (9+10)/2 = 9.5
  return s;
}

function cfg(over: Partial<PoolConfig> = {}): PoolConfig {
  return {
    ...DEFAULT_POOL_CONFIG,
    auto: false,
    threshold: 100,
    group: 1,
    maxPools: 24,
    minPersistence: 3,
    ...over,
  };
}

/** Construye un pool ask en el precio 15 con t0 = T0 (3 fotos de persistencia). */
function buildPool(engine: LiquidityPoolEngine, c: PoolConfig): LiquidityHistory {
  const history = new LiquidityHistory();
  for (let i = 0; i < 3; i += 1) {
    const sizes = baseSizes();
    sizes[15] = 1000;
    history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
    engine.sync(history, c);
  }
  expect(engine.list()).toHaveLength(1);
  return history;
}

/** Barre el pool moviendo el mid de 9.5 a 16.5 (atraviesa el nivel 15). */
function sweepByBook(engine: LiquidityPoolEngine, history: LiquidityHistory, c: PoolConfig): number {
  const tSweep = T0 + 3 * 2000;
  const sizes = new Array(20).fill(0);
  sizes[17] = 1; // best ask en 17 → mid = 16.5
  sizes[15] = 1000;
  history.appendColumns([col(tSweep, 16, sizes)], STEP);
  engine.sync(history, c);
  expect(engine.list()).toHaveLength(0);
  return tSweep;
}

describe("LiquidityPoolEngine: huella de absorción", () => {
  it("el barrido registra una huella con precio, lado y tiempos", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const history = buildPool(engine, c);
    const tSweep = sweepByBook(engine, history, c);
    expect(engine.stats.swept).toBe(1);

    const ghosts = engine.ghostsAlive(tSweep + 1000);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.price).toBe(15);
    expect(ghosts[0]?.side).toBe("ask");
    expect(ghosts[0]?.volume).toBe(1000);
    expect(ghosts[0]?.t0).toBe(T0);
    expect(ghosts[0]?.tSwept).toBe(tSweep);
  });

  it("el retiro voluntario NO deja huella (solo el barrido)", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const history = buildPool(engine, c);
    // El volumen cae bajo el umbral sin que el precio toque el nivel.
    const sizes = baseSizes();
    sizes[15] = 10;
    history.appendColumns([col(T0 + 3 * 2000, 9, sizes)], STEP);
    engine.sync(history, c);
    expect(engine.list()).toHaveLength(0);
    expect(engine.stats.withdrawn).toBe(1);
    expect(engine.ghostsAlive(T0 + 3 * 2000 + 1000)).toHaveLength(0);
  });

  it("la huella expira tras el TTL", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg({ ghostTtlMs: 10_000 });
    const history = buildPool(engine, c);
    const tSweep = sweepByBook(engine, history, c);
    expect(engine.ghostsAlive(tSweep + 9_999)).toHaveLength(1);
    expect(engine.ghostsAlive(tSweep + 10_000)).toHaveLength(0);
  });

  it("clear() borra también las huellas", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const history = buildPool(engine, c);
    const tSweep = sweepByBook(engine, history, c);
    expect(engine.ghostsAlive(tSweep + 1000)).toHaveLength(1);
    engine.clear();
    expect(engine.ghostsAlive(tSweep + 1000)).toHaveLength(0);
  });

  it("el barrido por vela (mecha) también deja huella con el timestamp de la vela", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const history = buildPool(engine, c);
    const candleT = T0 + 10_000;
    engine.sync(history, c, [{ timestamp: candleT, high: 16, low: 14 }]);
    expect(engine.list()).toHaveLength(0);
    expect(engine.stats.swept).toBe(1);

    const ghosts = engine.ghostsAlive(candleT + 1000);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.price).toBe(15);
    expect(ghosts[0]?.tSwept).toBe(candleT);
  });
});
