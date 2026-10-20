import { describe, expect, it } from 'vitest';
import { featuresExtremas } from './extremos';
import type { FilaFeatures } from '../nucleo/features';

const fila = (n: number, valores: Record<string, number | null>): FilaFeatures => ({ n, inicio: n, cierre: n, close: 100, valores });

describe('featuresExtremas', () => {
  it('ordena por |z| y usa solo barras previas', () => {
    const filas = Array.from({ length: 100 }, (_, i) => fila(i, { delta: (i % 5) - 2, retorno: (i % 3) * 0.001, hueco: 0 }));
    filas.push(fila(100, { delta: 40, retorno: 0.001, hueco: 1 }));
    const r = featuresExtremas(filas, 2);
    expect(r[0].clave).toBe('delta');
    expect(r[0].z).toBeGreaterThan(10);
    expect(r[0].percentil).toBe(1);
    expect(r.some((x) => x.clave === 'hueco')).toBe(false);
  });

  it('sin historia suficiente no devuelve nada', () => {
    expect(featuresExtremas([fila(0, { delta: 1 })])).toEqual([]);
  });
});
