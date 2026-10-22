import { describe, expect, it } from 'vitest';
import { armarVelas } from './velas';
import { backtest } from '../juez/backtest';
import { backtestConSalidas } from '../juez/salidas';
import type { FilaFeatures } from '../nucleo/features';

const T0 = Date.UTC(2026, 6, 1);
// Una fila cada 20 s, con apertura/máximo/mínimo y una Feature que crece.
const filas: FilaFeatures[] = Array.from({ length: 60 }, (_, i) => {
  const c = 100 + Math.sin(i / 4) * 5;
  return { n: i, inicio: T0 + i * 20_000, cierre: T0 + i * 20_000 + 19_000, open: c - 0.5, high: c + 1, low: c - 1, close: c, volumen: 2, delta: i % 2 ? 1 : -1, valores: { x: i, hueco: i === 7 ? 1 : 0 } };
});

describe('Velas del Laboratorio', () => {
  it('junta las filas en velas de tiempo: OHLC, volumen y delta sumados, Features de la última fila', () => {
    const v = armarVelas(filas, '1m');
    expect(v).toHaveLength(20);
    const [a] = v;
    expect(a).toMatchObject({ n: 0, inicio: T0, cierre: filas[2].cierre, open: filas[0].open, close: filas[2].close, volumen: 6, delta: -1 });
    expect(a.high).toBe(Math.max(...filas.slice(0, 3).map((f) => f.high!)));
    expect(a.valores.x).toBe(2);
    expect(v[2].valores.hueco).toBe(1); // la fila 7 cae en la tercera vela
    expect(v.map((x) => x.n)).toEqual(v.map((_, i) => i));
  });

  it('sin mirar al futuro: cambiar filas posteriores no cambia las velas ya cerradas', () => {
    const a = armarVelas(filas, '5m');
    const alteradas = filas.map((f, i) => (i >= 40 ? { ...f, close: f.close * 2, high: f.high! * 2, valores: { x: -1 } } : f));
    const b = armarVelas(alteradas, '5m');
    const cerradas = a.filter((x) => x.cierre < filas[40].cierre - 1).length;
    expect(b.slice(0, cerradas - 1)).toEqual(a.slice(0, cerradas - 1));
  });

  it('dollar bars: una vela por fila, y las filas viejas sin OHLC usan el cierre', () => {
    const viejas = filas.map(({ open, high, low, volumen, delta, ...f }) => (void [open, high, low, volumen, delta], f));
    const v = armarVelas(viejas, 'dollar');
    expect(v).toHaveLength(60);
    expect(v[3]).toMatchObject({ open: viejas[3].close, high: viejas[3].close, low: viejas[3].close, volumen: 0 });
  });

  it('el Backtest con GESTION usa el motor de salidas (el mismo de la Terminal)', () => {
    const v = armarVelas(filas, 'dollar');
    const cierres = v.map((x) => x.close);
    const pos = v.map((_, i) => (i % 10 < 5 ? 1 : -1));
    const reglas = { stopAtr: 1, rr: 1.5, gestion: 'be1R' as const };
    expect(backtest(cierres, pos, undefined, 0, cierres.length, { salidas: { reglas, velas: v } })).toEqual(backtestConSalidas(v, pos, reglas));
  });
});
