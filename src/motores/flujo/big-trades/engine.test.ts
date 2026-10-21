import { describe, expect, it } from "vitest";
import {
  BigTradeDetector,
  RollingStats,
  defaultBigTradeConfig,
  normalizeBigTradeConfig,
  type BigTradeInput,
} from "./engine";

let nextId = 1;
const trade = (
  timestamp: number,
  quantity: number,
  price: number,
  buyerIsMaker = false
): BigTradeInput => ({ timestamp, quantity, price, buyerIsMaker, aggTradeId: nextId++ });

const usdOnly = (minNotionalUsd: number) => ({
  minNotionalUsd,
  useUsdFilter: true,
  useZFilter: false,
});

describe("RollingStats", () => {
  it("coincide con el cálculo exacto (μ, σ poblacional) con la ventana llena", () => {
    const stats = new RollingStats(100);
    const all: number[] = [];
    for (let i = 0; i < 5_000; i += 1) {
      const value = 1_000 + Math.sin(i) * 500 + (i % 7) * 120;
      all.push(value);
      stats.push(value);
    }
    const window = all.slice(-100);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const sigma = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length);
    expect(stats.size).toBe(100);
    expect(stats.mu).toBeCloseTo(mean, 6);
    expect(stats.sigma).toBeCloseTo(sigma, 6);
  });

  it("es estable con valores nocionales grandes (sin cancelación catastrófica)", () => {
    const stats = new RollingStats(1_000);
    for (let i = 0; i < 50_000; i += 1) stats.push(5_000_000 + (i % 10));
    expect(stats.mu).toBeCloseTo(5_000_004.5, 3);
    expect(stats.sigma).toBeCloseTo(2.8722813, 3);
  });

  it("devuelve z=0 cuando σ≈0 y nunca NaN", () => {
    const stats = new RollingStats(50);
    for (let i = 0; i < 60; i += 1) stats.push(10);
    expect(stats.zScore(1_000)).toBe(0);
    stats.push(Number.NaN);
    expect(stats.size).toBe(50);
  });
});

describe("BigTradeDetector — agregación temporal", () => {
  it("agrupa ejecuciones con Δt ≤ τ y mismo lado; calcula V, N y VWAP", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1));
    const base = 1_000_000;
    expect(detector.ingest(trade(base, 1, 100)).length).toBe(0);
    expect(detector.ingest(trade(base + 20, 3, 102)).length).toBe(0);
    expect(detector.ingest(trade(base + 60, 1, 98)).length).toBe(0); // Δt=40 ≤ 50 (contra la anterior)
    const [event] = detector.flush();
    expect(event!.volume_base).toBe(5);
    expect(event!.notional_usd).toBe(100 + 306 + 98);
    expect(event!.price).toBeCloseTo(504 / 5, 8);
    expect(event!.duration_ms).toBe(60);
    expect(event!.side).toBe("BUY");
    expect(event!.timestamp).toBe(base);
    expect(event!.event).toBe("BIG_TRADE");
  });

  it("Δt se mide entre ejecuciones consecutivas, no desde el inicio del bloque", () => {
    const detector = new BigTradeDetector("BTCUSDT", { ...usdOnly(1), maxBlockDurationMs: 0 });
    for (let i = 0; i < 10; i += 1) detector.ingest(trade(1_000 + i * 40, 1, 100));
    expect(detector.flush()[0]!.duration_ms).toBe(360);
  });

  it("cierra el bloque al cambiar de lado", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1));
    detector.ingest(trade(1_000, 2, 100, false));
    const out = detector.ingest(trade(1_010, 1, 100, true));
    expect(out).toHaveLength(1);
    expect(out[0]!.side).toBe("BUY");
    expect(detector.flush()[0]!.side).toBe("SELL");
  });

  it("cierra el bloque cuando Δt > τ", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1));
    detector.ingest(trade(1_000, 2, 100));
    const out = detector.ingest(trade(1_051, 1, 100));
    expect(out).toHaveLength(1);
    expect(out[0]!.volume_base).toBe(2);
  });

  it("cierra por duración máxima en barridos continuos", () => {
    const detector = new BigTradeDetector("BTCUSDT", { ...usdOnly(1), maxBlockDurationMs: 200 });
    let emitted = 0;
    for (let i = 0; i < 30; i += 1) emitted += detector.ingest(trade(1_000 + i * 20, 1, 100)).length;
    expect(emitted).toBeGreaterThan(0);
  });

  it("ignora duplicados y ejecuciones fuera de orden", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1));
    const first = trade(1_000, 1, 100);
    detector.ingest(first);
    detector.ingest(first);
    detector.ingest({ ...trade(1_001, 1, 100), aggTradeId: first.aggTradeId - 1 });
    expect(detector.flush()[0]!.volume_base).toBe(1);
  });

  it("flushIfIdle sólo cierra tras τ + gracia sin tráfico (reloj local)", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1));
    detector.ingest(trade(1_000, 1, 100), 10_000);
    expect(detector.flushIfIdle(10_040)).toHaveLength(0);
    expect(detector.flushIfIdle(10_080)).toHaveLength(1);
    expect(detector.hasActiveBlock()).toBe(false);
  });
});

describe("BigTradeDetector — filtros", () => {
  it("filtro USD: emite sólo si N_B ≥ umbral", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1_000));
    detector.ingest(trade(1_000, 5, 100)); // 500
    expect(detector.ingest(trade(1_100, 20, 100))).toHaveLength(0); // cierra 500 → no pasa
    expect(detector.ingest(trade(1_200, 1, 100))).toHaveLength(1); // cierra 2000 → pasa
  });

  it("filtro Z-score: detecta un bloque atípico y respeta el precalentamiento", () => {
    const detector = new BigTradeDetector("BTCUSDT", {
      useUsdFilter: false,
      useZFilter: true,
      zCut: 2.5,
      minZSamples: 50,
      windowSize: 200,
    });
    let ts = 1_000;
    // 100 bloques "normales" (~1 000 USD con algo de variación), separados por > τ.
    for (let i = 0; i < 100; i += 1) {
      ts += 100;
      detector.ingest(trade(ts, 10 + (i % 5), 100));
    }
    ts += 100;
    detector.ingest(trade(ts, 500, 100)); // 50 000 USD: muy atípico
    ts += 100;
    const out = detector.ingest(trade(ts, 10, 100)); // cierra el bloque atípico
    expect(out).toHaveLength(1);
    expect(out[0]!.notional_usd).toBe(50_000);
    expect(out[0]!.z_score).toBeGreaterThanOrEqual(2.5);
  });

  it("no emite por Z antes de reunir minZSamples", () => {
    const detector = new BigTradeDetector("BTCUSDT", {
      useUsdFilter: false,
      useZFilter: true,
      minZSamples: 50,
    });
    let ts = 1_000;
    let emitted = 0;
    for (let i = 0; i < 10; i += 1) {
      ts += 100;
      emitted += detector.ingest(trade(ts, i === 5 ? 1_000 : 1, 100)).length;
    }
    expect(emitted).toBe(0);
  });

  it("el Z se calcula contra la ventana previa (el bloque no se auto-atenúa)", () => {
    const detector = new BigTradeDetector("BTCUSDT", {
      useUsdFilter: false,
      useZFilter: true,
      minZSamples: 10,
      windowSize: 50,
      zCut: 3,
    });
    let ts = 0;
    for (let i = 0; i < 40; i += 1) {
      ts += 100;
      detector.ingest(trade(ts, 1 + (i % 3) * 0.1, 100));
    }
    ts += 100;
    detector.ingest(trade(ts, 100, 100));
    ts += 100;
    expect(detector.ingest(trade(ts, 1, 100))).toHaveLength(1);
  });

  it("prime() calienta la ventana sin emitir", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1));
    const history: BigTradeInput[] = [];
    for (let i = 0; i < 20; i += 1) history.push(trade(1_000 + i * 100, 10, 100));
    detector.prime(history);
    expect(detector.getWindowStats().samples).toBe(20);
    expect(detector.hasActiveBlock()).toBe(false);
    expect(detector.flush()).toHaveLength(0);
  });

  it("ingestDetailed expone los ids de auditoría del bloque", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1));
    const a = trade(1_000, 1, 100);
    const b = trade(1_010, 1, 100);
    detector.ingestDetailed(a);
    detector.ingestDetailed(b);
    const [info] = detector.flushDetailed();
    expect(info!.firstAggTradeId).toBe(a.aggTradeId);
    expect(info!.lastAggTradeId).toBe(b.aggTradeId);
    expect(info!.tradeCount).toBe(2);
  });
});

describe("normalizeBigTradeConfig", () => {
  it("aplica defaults, límites y exige al menos un filtro", () => {
    const config = normalizeBigTradeConfig(
      { tauMs: -5, windowSize: 10, useUsdFilter: false, useZFilter: false },
      "ETHUSDT"
    );
    expect(config.tauMs).toBe(1);
    expect(config.windowSize).toBe(50);
    expect(config.useUsdFilter || config.useZFilter).toBe(true);
    expect(config.minNotionalUsd).toBe(defaultBigTradeConfig("ETHUSDT").minNotionalUsd);
    expect(normalizeBigTradeConfig({ zCut: Number.NaN }, "BTCUSDT").zCut).toBe(2.5);
  });
});

describe("F4 — Z sobre volumen + AND estricto", () => {
  const bothFilters = {
    useUsdFilter: true,
    useZFilter: true,
    minNotionalUsd: 1_000,
    zCut: 2.5,
    minZSamples: 10,
    windowSize: 50,
  };

  it("salto de precio con volumen normal NO emite (antes: z=1.2e+13 sobre notional)", () => {
    const detector = new BigTradeDetector("BTCUSDT", bothFilters);
    let ts = 1_000;
    // 20 bloques normales: 2.4 BTC @ 100000 (notional 240000, pasa USD).
    for (let i = 0; i < 20; i += 1) {
      ts += 100;
      detector.ingest(trade(ts, 2.4, 100_000));
    }
    // Bloque con el MISMO volumen pero precio 105000: notional 252000 (pasa USD),
    // z sobre volumen ≈ 0 (no pasa Z). Con AND no debe emitir.
    ts += 100;
    detector.ingest(trade(ts, 2.4, 105_000));
    ts += 100;
    expect(detector.ingest(trade(ts, 2.4, 100_000))).toHaveLength(0);
  });

  it("AND estricto: solo emite si pasan AMBOS filtros", () => {
    const detector = new BigTradeDetector("BTCUSDT", bothFilters);
    let ts = 1_000;
    for (let i = 0; i < 20; i += 1) {
      ts += 100;
      detector.ingest(trade(ts, 10 + (i % 3), 100)); // ~1000-1200 USD
    }
    // Solo USD: notional alto (500×100=50000) pero volumen normal → z bajo.
    ts += 100;
    detector.ingest(trade(ts, 12, 100));
    ts += 100;
    detector.ingest(trade(ts, 500, 100)); // notional 50000, volumen 500 → z alto
    ts += 100;
    const out = detector.ingest(trade(ts, 10, 100)); // cierra el bloque de 500
    expect(out).toHaveLength(1); // pasa USD (50000≥1000) Y Z (500 atípico)
    expect(out[0]!.volume_base).toBe(500);
  });

  it("con un solo filtro activo se respeta ese único filtro (sin AND)", () => {
    const detector = new BigTradeDetector("BTCUSDT", usdOnly(1_000));
    let ts = 1_000;
    for (let i = 0; i < 5; i += 1) {
      ts += 100;
      detector.ingest(trade(ts, 5, 100)); // 500 < 1000
    }
    ts += 100;
    expect(detector.ingest(trade(ts, 20, 100))).toHaveLength(0); // cierra 500 → no pasa
    ts += 100;
    expect(detector.ingest(trade(ts, 1, 100))).toHaveLength(1); // cierra 2000 → pasa
  });
});
