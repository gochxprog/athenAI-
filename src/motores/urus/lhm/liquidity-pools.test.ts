import { describe, expect, it } from "vitest";
import { LiquidityHistory, type LiquidityColumn } from "./liquidity-history";
import {
  DEFAULT_POOL_CONFIG,
  LiquidityPoolEngine,
  type PoolConfig,
} from "./liquidity-pools";

/**
 * Tests del detector de pools de liquidez con datos sintéticos.
 * Verifica: persistencia anti-ruido, clasificación por lado, barrido (swept),
 * retiro (withdrawn) y respeto del umbral.
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

function historyWith(cols: LiquidityColumn[]): LiquidityHistory {
  const h = new LiquidityHistory();
  h.appendColumns(cols, STEP);
  return h;
}

function feed(engine: LiquidityPoolEngine, history: LiquidityHistory, c: PoolConfig): void {
  engine.sync(history, c);
}

describe("LiquidityPoolEngine: persistencia anti-ruido", () => {
  it("no crea el pool antes de minPersistence fotos consecutivas", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const sizes = baseSizes();
    sizes[15] = 1000; // bucket ask grande
    const history = new LiquidityHistory();
    for (let i = 0; i < 2; i += 1) {
      history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
      feed(engine, history, c);
      expect(engine.list()).toHaveLength(0);
    }
    history.appendColumns([col(T0 + 2 * 2000, 9, sizes)], STEP);
    feed(engine, history, c);
    expect(engine.list()).toHaveLength(1);
    expect(engine.list()[0]?.price).toBe(15);
  });

  it("un bucket que parpadea (flicker) nunca llega a pool", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg({ minPersistence: 3 });
    const history = new LiquidityHistory();
    // Alterna 1000 / 10: la racha nunca llega a 3 consecutivas.
    for (let i = 0; i < 9; i += 1) {
      const sizes = baseSizes();
      sizes[15] = i % 2 === 0 ? 1000 : 10;
      history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
      feed(engine, history, c);
    }
    expect(engine.list()).toHaveLength(0);
  });

  it("con minPersistence = 1 el pool se confirma de inmediato (comportamiento anterior)", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg({ minPersistence: 1 });
    const sizes = baseSizes();
    sizes[15] = 1000;
    const history = historyWith([col(T0, 9, sizes)]);
    feed(engine, history, c);
    expect(engine.list()).toHaveLength(1);
  });
});

describe("LiquidityPoolEngine: lado y umbral", () => {
  it("clasifica ask (sobre el mid) y bid (bajo el mid)", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const history = new LiquidityHistory();
    for (let i = 0; i < 3; i += 1) {
      const sizes = baseSizes();
      sizes[15] = 1000; // ask: centro 15 > mid 9.5
      sizes[5] = 2000; // bid: centro 5 < mid 9.5
      history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
      feed(engine, history, c);
    }
    const pools = engine.list();
    expect(pools).toHaveLength(2);
    const ask = pools.find(p => p.price === 15);
    const bid = pools.find(p => p.price === 5);
    expect(ask?.side).toBe("ask");
    expect(bid?.side).toBe("bid");
  });

  it("el bucket que se está negociando no se convierte en pool", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const sizes = baseSizes();
    sizes[10] = 5000; // bucket del mid: [9.5, 10.5] contiene al mid 9.5
    const history = new LiquidityHistory();
    for (let i = 0; i < 3; i += 1) {
      history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
      feed(engine, history, c);
    }
    expect(engine.list()).toHaveLength(0);
  });

  it("respeta el umbral manual: bajo el umbral no hay pool", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg({ threshold: 5000 });
    const sizes = baseSizes();
    sizes[15] = 1000;
    const history = new LiquidityHistory();
    for (let i = 0; i < 5; i += 1) {
      history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
      feed(engine, history, c);
    }
    expect(engine.list()).toHaveLength(0);
  });
});

describe("LiquidityPoolEngine: barrido y retiro", () => {
  it("barre el pool cuando el precio lo atraviesa", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const history = new LiquidityHistory();
    for (let i = 0; i < 3; i += 1) {
      const sizes = baseSizes();
      sizes[15] = 1000;
      history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
      feed(engine, history, c);
    }
    expect(engine.list()).toHaveLength(1);
    // El mid sube de 9.5 a 16.5: atraviesa el pool en 15.
    const sizes = new Array(20).fill(0);
    sizes[17] = 1;
    sizes[15] = 1000;
    history.appendColumns([col(T0 + 3 * 2000, 16, sizes)], STEP);
    feed(engine, history, c);
    expect(engine.list()).toHaveLength(0);
    expect(engine.stats.swept).toBe(1);
  });

  it("retira el pool cuando el volumen cae bajo el umbral", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const history = new LiquidityHistory();
    for (let i = 0; i < 3; i += 1) {
      const sizes = baseSizes();
      sizes[15] = 1000;
      history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
      feed(engine, history, c);
    }
    expect(engine.list()).toHaveLength(1);
    const sizes = baseSizes();
    sizes[15] = 10; // bajo el umbral de 100
    history.appendColumns([col(T0 + 3 * 2000, 9, sizes)], STEP);
    feed(engine, history, c);
    expect(engine.list()).toHaveLength(0);
    expect(engine.stats.withdrawn).toBe(1);
  });

  it("el t0 del pool es el inicio de la racha de persistencia", () => {
    const engine = new LiquidityPoolEngine();
    const c = cfg();
    const history = new LiquidityHistory();
    for (let i = 0; i < 3; i += 1) {
      const sizes = baseSizes();
      sizes[15] = 1000;
      history.appendColumns([col(T0 + i * 2000, 9, sizes)], STEP);
      feed(engine, history, c);
    }
    expect(engine.list()[0]?.t0).toBe(T0);
  });
});
