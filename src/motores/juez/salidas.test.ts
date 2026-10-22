import { describe, expect, it } from 'vitest';
import { abrirGestionada, actualizarGestion, atrSerie, backtestConSalidas, revisarSalida, type ReglasSalida, type Vela } from './salidas';
import { backtest } from './backtest';

const SIN_COSTOS = { comisionPb: 0, deslizamientoPb: 0 };
/** Velas con rango fijo ±0,5 alrededor del cierre (ATR = 1 en cuanto hay barras). */
const velas = (cierres: number[], rango = 0.5): Vela[] => cierres.map((c) => ({ high: c + rango, low: c - rango, close: c }));

describe('Gestión de salidas (stop, objetivo, break-even, escalonada)', () => {
  it('ATR causal: el valor en i no cambia si se añaden barras futuras', () => {
    const v = velas([100, 101, 103, 102, 106, 104, 110]);
    const a = atrSerie(v, 3);
    const b = atrSerie([...v, { high: 500, low: 1, close: 300 }], 3);
    expect(b.slice(0, v.length)).toEqual(a);
    expect(a[0]).toBeNull();
  });

  it('stop y objetivo en la misma barra: se asume el stop (lo peor)', () => {
    const reglas: ReglasSalida = { stopAtr: 1, rr: 2, gestion: 'fija' };
    const p = abrirGestionada(1, 0, 100, 1, reglas)!;
    expect(p.stop).toBe(99);
    expect(p.objetivo).toBe(102);
    expect(revisarSalida(p, { high: 103, low: 98, close: 100 })).toEqual({ precio: 99, motivo: 'stop' });
    expect(revisarSalida(p, { high: 102.5, low: 99.5, close: 102 })).toEqual({ precio: 102, motivo: 'objetivo' });
  });

  it('escalonada 1:3 — a 1R break-even (+costos), a 2R asegura 1R; nunca retrocede', () => {
    const reglas: ReglasSalida = { stopAtr: 1, rr: 3, gestion: 'escalonada' };
    const costos = { comisionPb: 5, deslizamientoPb: 0 };
    const p = abrirGestionada(1, 0, 100, 1, reglas)!;
    actualizarGestion(p, { high: 100.5, low: 99.6, close: 100.2 }, 1, reglas, costos);
    expect(p.stop).toBe(99); // aún no llegó a 1R
    actualizarGestion(p, { high: 101.1, low: 100.1, close: 101 }, 2, reglas, costos);
    expect(p.stop).toBeCloseTo(100 + 2 * 0.0005 * 100, 10); // break-even cubriendo comisión de entrada y salida
    actualizarGestion(p, { high: 102.2, low: 101.2, close: 102 }, 3, reglas, costos);
    expect(p.stop).toBe(101); // +1R asegurado
    actualizarGestion(p, { high: 101.5, low: 101.2, close: 101.3 }, 4, reglas, costos);
    expect(p.stop).toBe(101); // no baja
    expect(p.movimientos.map((m) => m.r)).toEqual([0, 1]);
    expect(revisarSalida(p, { high: 101.4, low: 100.9, close: 101 })).toEqual({ precio: 101, motivo: 'stop-en-ganancia' });
  });

  it('be1R mueve solo a break-even; fija nunca mueve', () => {
    const be: ReglasSalida = { stopAtr: 1, rr: 3, gestion: 'be1R' };
    const p = abrirGestionada(-1, 0, 100, 2, be)!; // corto, 1R = 2
    actualizarGestion(p, { high: 99, low: 95.5, close: 96 }, 1, be, SIN_COSTOS); // MFE 2,25R
    expect(p.stop).toBe(100);
    expect(revisarSalida(p, { high: 100.2, low: 99, close: 100 })?.motivo).toBe('break-even');
    const fija: ReglasSalida = { ...be, gestion: 'fija' };
    const q = abrirGestionada(-1, 0, 100, 2, fija)!;
    actualizarGestion(q, { high: 99, low: 90, close: 91 }, 1, fija, SIN_COSTOS);
    expect(q.stop).toBe(102);
    expect(q.mfe).toBe(5);
  });

  it('backtest: toca el objetivo → sale en el objetivo; el capital cuadra con las operaciones', () => {
    const cierres = [100, 100, 100, 100, 101, 103, 104, 104];
    const pos = [0, 0, 0, 1, 1, 1, 1, 0];
    const r = backtestConSalidas(velas(cierres), pos, { stopAtr: 1, rr: 2, gestion: 'fija', periodoAtr: 2 }, SIN_COSTOS);
    expect(r.operaciones).toHaveLength(1);
    const o = r.operaciones[0];
    expect(o.motivo).toBe('objetivo');
    expect(o.precioSalida).toBe(102);
    expect(o.r).toBeCloseTo(2, 10);
    const producto = r.operaciones.reduce((a, x) => a * (1 + x.retorno), 1);
    expect(r.equity[r.equity.length - 1]).toBeCloseTo(producto, 12);
    // Tras el objetivo no vuelve a entrar con la misma señal.
    expect(r.retornos.slice(6).every((x) => x === 0)).toBe(true);
  });

  it('backtest: tras un stop no re-entra con la misma señal, pero sí con una señal nueva', () => {
    const cierres = [100, 100, 100, 100, 98, 98, 98, 98, 98, 98];
    const pos = [0, 0, 0, 1, 1, 1, 0, 1, 1, 0];
    const r = backtestConSalidas(velas(cierres), pos, { stopAtr: 1, rr: 2, gestion: 'fija', periodoAtr: 2 }, SIN_COSTOS);
    expect(r.operaciones.map((o) => o.motivo)).toEqual(['stop', 'senal']);
    expect(r.operaciones[1].entrada).toBe(7);
  });

  it('sin tocar stop ni objetivo, cuadra exactamente con el Backtest de siempre (con costos)', () => {
    const cierres = [100, 100.1, 100.2, 100.15, 100.3, 100.25, 100.4, 100.35, 100.5, 100.6];
    const pos = [0, 1, 1, 1, 0, -1, -1, 0, 0, 0];
    const costos = { comisionPb: 4, deslizamientoPb: 1 };
    const a = backtestConSalidas(velas(cierres, 0.01), pos, { stopAtr: 50, rr: 50, gestion: 'escalonada', periodoAtr: 2 }, costos);
    const b = backtest(cierres, pos, costos);
    expect(a.operaciones.map((o) => o.motivo)).toEqual(['senal', 'senal']);
    a.retornos.forEach((x, i) => expect(x).toBeCloseTo(b.retornos[i], 12));
    a.operaciones.forEach((o, i) => expect(o.retorno).toBeCloseTo(b.operaciones[i].retorno, 12));
  });

  it('anti-futuro: cambiar barras posteriores no cambia las operaciones ya cerradas', () => {
    const cierres = [100, 100, 100, 100, 101, 103, 104, 104, 104, 104];
    const pos = [0, 0, 0, 1, 1, 1, 1, 0, 0, 0];
    const reglas: ReglasSalida = { stopAtr: 1, rr: 2, gestion: 'escalonada', periodoAtr: 2 };
    const a = backtestConSalidas(velas(cierres), pos, reglas, SIN_COSTOS);
    const b = backtestConSalidas(velas([...cierres.slice(0, 7), 50, 200, 10]), pos, reglas, SIN_COSTOS);
    expect(b.operaciones[0]).toEqual(a.operaciones[0]);
    expect(b.retornos.slice(0, 7)).toEqual(a.retornos.slice(0, 7));
  });

  it('salida por tiempo y cierre forzado al final del tramo', () => {
    const cierres = [100, 100, 100, 100, 100.1, 100.2, 100.1, 100.2, 100.1];
    const pos = [0, 0, 1, 1, 1, 1, 1, 1, 1];
    const r = backtestConSalidas(velas(cierres), pos, { stopAtr: 2, rr: 3, gestion: 'fija', periodoAtr: 2, maxBarras: 3 }, SIN_COSTOS);
    expect(r.operaciones[0].motivo).toBe('tiempo');
    expect(r.operaciones[0].barras).toBe(3);
    expect(r.operaciones).toHaveLength(1);
    const s = backtestConSalidas(velas(cierres), pos, { stopAtr: 2, rr: 3, gestion: 'fija', periodoAtr: 2 }, SIN_COSTOS);
    expect(s.operaciones[0].motivo).toBe('fin');
  });
});

describe('Auditoría: el stop nunca se llena a un precio que no se negoció', () => {
  it('break-even movido por encima del cierre: sale al precio de apertura de la vela siguiente, no al stop', () => {
    const v = (high: number, low: number, close: number): Vela => ({ high, low, close });
    const velas = [v(100, 100, 100), v(101, 99, 100), v(102.5, 99.5, 99), v(99.5, 98.5, 99), v(99, 99, 99)];
    const r = backtestConSalidas(velas, [0, 1, 1, 1, 1], { stopAtr: 1, rr: 5, gestion: 'be1R', periodoAtr: 1 }, { comisionPb: 0, deslizamientoPb: 0 });
    const op = r.operaciones[0];
    expect(op.motivo).toBe('break-even');
    // Antes: salía a 100 (el stop) con retorno 0 y la barra ganaba +1 %. Ahora sale a 99 (donde abrió la vela).
    expect(op.precioSalida).toBe(99);
    expect(op.retorno).toBeCloseTo(-0.01, 10);
    expect(r.retornos[3]).toBeCloseTo(0, 10);
  });
});
