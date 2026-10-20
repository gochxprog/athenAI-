import { describe, it, expect } from 'vitest';
import { evaluateBigTradeFilter, type BigTradeFilterConfig as BigTradeConfig, type TradeCandidate } from './filter';
import { BigTradeDetector } from './engine';

describe('Auditoría Parte 4 - Filtro de Big Trades', () => {
  const baseConfig: BigTradeConfig = {
    minNotionalUSD: 50000,
    minZScore: 2.0,
    minZSamples: 10,
    useNotionalFilter: true,
    useZScoreFilter: true,
  };

  it('Filtro AND: Debe rechazar un trade si cumple Notional pero NO cumple Z-Score', () => {
    const trade: TradeCandidate = { notionalUSD: 100000, zScore: 1.2, sampleCount: 20 };
    const isBig = evaluateBigTradeFilter(trade, baseConfig);
    expect(isBig).toBe(false);
  });

  it('Filtro AND: Debe rechazar un trade si cumple Z-Score pero NO cumple Notional', () => {
    const trade: TradeCandidate = { notionalUSD: 10000, zScore: 3.5, sampleCount: 20 };
    const isBig = evaluateBigTradeFilter(trade, baseConfig);
    expect(isBig).toBe(false);
  });

  it('Filtro AND: Debe ACEPTAR un trade que cumple AMBOS criterios', () => {
    const trade: TradeCandidate = { notionalUSD: 75000, zScore: 2.5, sampleCount: 20 };
    const isBig = evaluateBigTradeFilter(trade, baseConfig);
    expect(isBig).toBe(true);
  });

  it('M10: Debe rechazar un trade con Z alto pero sin muestras suficientes (minZSamples)', () => {
    const trade: TradeCandidate = { notionalUSD: 75000, zScore: 9.9, sampleCount: 3 };
    const isBig = evaluateBigTradeFilter(trade, baseConfig);
    expect(isBig).toBe(false);
  });

  it('Si el filtro de Z-Score está desactivado, solo debe validar el Notional USD', () => {
    const configOnlyNotional = { ...baseConfig, useZScoreFilter: false };
    const trade: TradeCandidate = { notionalUSD: 60000, zScore: 0.1, sampleCount: 20 };
    const isBig = evaluateBigTradeFilter(trade, configOnlyNotional);
    expect(isBig).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------------
 * Mismas reglas, pero contra el BigTradeDetector REAL (lo que de verdad corre en el servidor).
 * ------------------------------------------------------------------------------------------- */
describe('Auditoría Parte 4 - Filtro AND en el detector real', () => {
  const tr = (id: number, t: number, quantity: number, price: number) => ({
    aggTradeId: id, timestamp: t, quantity, price, buyerIsMaker: false,
  });

  /** 20 bloques previos con volúmenes 1..2 (media 1.5, σ ≈ 0.35) para que el Z-score sea fiable. */
  function primed(over: Record<string, unknown> = {}) {
    const d = new BigTradeDetector('BTCUSDT', { minNotionalUsd: 50_000, zCut: 2.5, minZSamples: 10, ...over });
    d.prime(Array.from({ length: 20 }, (_, i) => tr(i + 1, 1_000 * (i + 1), 1 + (i % 5) * 0.25, 100)));
    return d;
  }
  /** Envía un solo bloque y lo cierra; devuelve los eventos emitidos. */
  const emit = (d: BigTradeDetector, volume: number, price: number) =>
    [...d.ingest(tr(100, 100_000, volume, price)), ...d.flush()];

  // A: notional enorme pero volumen normal (Z ≈ 0).  B: volumen enorme pero notional minúsculo.
  const A = { volume: 1.5, price: 1_000_000 };
  const B = { volume: 100, price: 1 };
  const C = { volume: 100, price: 1_000 }; // cumple ambos

  it('ambos filtros activos: notional sí, Z no → NO emite', () => {
    expect(emit(primed(), A.volume, A.price)).toHaveLength(0);
  });
  it('ambos filtros activos: Z sí, notional no → NO emite', () => {
    expect(emit(primed(), B.volume, B.price)).toHaveLength(0);
  });
  it('ambos filtros activos: cumple ambos → emite', () => {
    expect(emit(primed(), C.volume, C.price)).toHaveLength(1);
  });
  it('Z desactivado: decide solo el notional (el caso A ahora sí emite)', () => {
    expect(emit(primed({ useZFilter: false }), A.volume, A.price)).toHaveLength(1);
  });
  it('USD desactivado: decide solo el Z-score (el caso B ahora sí emite)', () => {
    expect(emit(primed({ useUsdFilter: false }), B.volume, B.price)).toHaveLength(1);
  });
  it('ambos desactivados: el motor fuerza el filtro USD activo (invariante)', () => {
    const cfg = primed({ useUsdFilter: false, useZFilter: false }).getConfig();
    expect(cfg.useUsdFilter).toBe(true);
    expect(cfg.useZFilter).toBe(false);
  });
});
