import { describe, expect, it } from 'vitest';
import { inferirTick, parametrosParaSimbolo, redondeoAmable } from './parametros';

describe('parámetros por activo', () => {
  it('BTCUSDT conserva la calibración original', () => {
    const p = parametrosParaSimbolo('BTCUSDT', 0.1, 84_700, 18e9);
    expect(p.pasos).toEqual({ '1m': 5, '5m': 10, '15m': 20, dollar: 5, volume: 5 });
    expect(p.temporalidades.dollar).toEqual({ id: 'dollar', tipo: 'dolar', usd: 10_000_000 });
    expect(p.temporalidades.volume).toEqual({ id: 'volume', tipo: 'volumen', base: 100 });
  });

  it('escala ETH y un activo pequeño al precio, al tick y al volumen', () => {
    const eth = parametrosParaSimbolo('ETHUSDT', 0.01, 3_000, 9e9);
    expect(eth.pasos['1m']).toBe(0.2);
    expect(eth.temporalidades.dollar).toMatchObject({ usd: 5_000_000 });
    const chico = parametrosParaSimbolo('DOGEUSDT', 0.00001, 0.15, 600e6);
    expect(chico.pasos['1m']).toBeCloseTo(0.00001, 10);
    expect(chico.temporalidades.dollar).toMatchObject({ usd: 200_000 });
  });

  it('redondea a 1 · 2 · 5', () => {
    expect([0.9, 1.4, 1.6, 4, 8].map(redondeoAmable)).toEqual([1, 1, 2, 5, 10]);
  });
});

describe('tick sin metadatos', () => {
  it('usa la tabla de futuros y si no, el menor salto observado', () => {
    expect(inferirTick('ESZ6', [])).toBe(0.25);
    expect(inferirTick('MNQ', [])).toBe(0.25);
    expect(inferirTick('XYZ', [10.01, 10.02, 10.05])).toBe(0.01);
    expect(inferirTick('XYZ', [100, 100.5, 101])).toBe(0.5);
  });
});
