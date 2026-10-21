import { describe, expect, it } from 'vitest';
import { agruparLibro, escalon } from './agruparLibro';

describe('Agrupación del DOM (solo pantalla)', () => {
  const libro = {
    paso: 1,
    asks: [[101, 2, 0], [102, 1, 1], [104, 3, -1], [106, 5, 1]] as [number, number, number][],
    bids: [[100, 4, 1], [99, 1, 1], [96, 2, 0], [95, 7, -1]] as [number, number, number][],
  };

  it('×1 deja el libro igual', () => {
    const g = agruparLibro(libro, 1);
    expect(g.asks.map((x) => [x.p, x.tam])).toEqual([[101, 2], [102, 1], [104, 3], [106, 5]]);
    expect(g.bids.map((x) => [x.p, x.tam])).toEqual([[100, 4], [99, 1], [96, 2], [95, 7]]);
  });

  it('×5: asks hacia arriba y bids hacia abajo, sumando cantidades (a mano)', () => {
    const g = agruparLibro(libro, 5);
    expect(g.paso).toBe(5);
    // asks: 101,102,104 → 105 (2+1+3 = 6) ; 106 → 110 (5)
    expect(g.asks.map((x) => [x.p, x.tam])).toEqual([[105, 6], [110, 5]]);
    // bids: 100 → 100 (4) ; 99,96 → 95 (1+2 = 3) ; 95 → 95 (+7 = 10)
    expect(g.bids.map((x) => [x.p, x.tam])).toEqual([[100, 4], [95, 10]]);
    // Tendencia: 105 mezcla stacking y pulling → 0 ; 110 solo stacking → 1 ; 95 mezcla → 0.
    expect(g.asks.map((x) => x.tendencia)).toEqual([0, 1]);
    expect(g.bids.map((x) => x.tendencia)).toEqual([1, 0]);
  });

  it('el escalón de un golpe casa con el de su lado', () => {
    expect(escalon(101, 5, true)).toBe(105);
    expect(escalon(99, 5, false)).toBe(95);
    expect(escalon(100, 5, false)).toBe(100);
  });
});
