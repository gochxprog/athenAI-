// Verificación del motor 4 (Monte Carlo) con la especificación del usuario.
import { describe, expect, it } from 'vitest';
import { curvaCapital, monteCarlo, percentil, remuestrear } from './monteCarlo';
import { maxDrawdown } from './backtest';
import { crearAleatorio } from '@/lib/random';

describe('Motor 4 · Monte Carlo', () => {
  it('curva de capital y drawdown calculados a mano', () => {
    // 1 → 1,1 → 0,88 → 0,968: pico 1,1; peor caída (1,1 − 0,88) / 1,1 = 20 %.
    const c = curvaCapital([0.1, -0.2, 0.1]);
    expect(c[3]).toBeCloseTo(1.1 * 0.8 * 1.1, 12);
    expect(maxDrawdown(c)).toBeCloseTo(0.2, 12);
  });

  it('percentil con interpolación lineal', () => {
    const xs = [0, 10, 20, 30, 40];
    expect(percentil(xs, 0.5)).toBe(20);
    expect(percentil(xs, 0.05)).toBeCloseTo(2, 12); // (5 − 1) × 0,05 = 0,2 → 0 + 0,2 × 10
    expect(percentil(xs, 0.95)).toBeCloseTo(38, 12);
  });

  it('shuffle: mismas operaciones en otro orden (el retorno final no cambia)', () => {
    const trades = [0.05, -0.03, 0.02, -0.04, 0.06, 0.01];
    const az = crearAleatorio(1);
    const s = remuestrear(trades, 'shuffle', az);
    expect([...s].sort()).toEqual([...trades].sort());
    const r = monteCarlo(trades, crearAleatorio(2), { metodo: 'shuffle', simulaciones: 500 });
    const final = trades.reduce((a, t) => a * (1 + t), 1) - 1;
    expect(r.p5).toBeCloseTo(final, 12);
    expect(r.p95).toBeCloseTo(final, 12);
    expect(r.ddP95).toBeGreaterThanOrEqual(r.ddP50);
  });

  it('bootstrap: cada operación sale con probabilidad 1/N (puede repetirse)', () => {
    const trades = [1, 2, 3, 4];
    const az = crearAleatorio(3);
    const cuenta = new Map<number, number>();
    for (let k = 0; k < 5_000; k += 1) for (const t of remuestrear(trades, 'bootstrap', az)) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
    for (const t of trades) expect((cuenta.get(t) ?? 0) / 20_000).toBeCloseTo(0.25, 1);
  });

  it('probabilidad de ruina: 0 con operaciones siempre ganadoras; alta con pérdidas grandes', () => {
    expect(monteCarlo([0.01, 0.02, 0.005, 0.01, 0.03], crearAleatorio(4)).probRuina).toBe(0);
    // 30 operaciones de ±10 %: en muchas simulaciones llegan rachas que caen ≥ 30 %.
    const volatil = Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.1 : -0.1));
    const r = monteCarlo(volatil, crearAleatorio(5), { umbralRuina: 0.3 });
    expect(r.probRuina).toBeGreaterThan(0.3);
    // Con un umbral más alto, menos ruina.
    expect(monteCarlo(volatil, crearAleatorio(5), { umbralRuina: 0.6 }).probRuina).toBeLessThan(r.probRuina);
  });

  it('alerta si el DD P95 es más del doble que el del orden original', () => {
    // Orden original alternado (caídas cortas); barajado, las pérdidas se juntan.
    const alternado = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.03 : -0.025));
    const r = monteCarlo(alternado, crearAleatorio(6), { metodo: 'shuffle' });
    expect(r.ddOriginal).toBeCloseTo(0.025, 12);
    expect(r.alertaOrden).toBe(true);
    // Con las pérdidas ya juntas en el original, no hay alerta.
    const juntas = [...alternado].sort((a, b) => a - b);
    expect(monteCarlo(juntas, crearAleatorio(6), { metodo: 'shuffle' }).alertaOrden).toBe(false);
  });

  it('es reproducible con la misma semilla y respeta el número de simulaciones', () => {
    const t = [0.02, -0.01, 0.03, -0.02, 0.01];
    const a = monteCarlo(t, crearAleatorio(7), { simulaciones: 1_000 });
    const b = monteCarlo(t, crearAleatorio(7), { simulaciones: 1_000 });
    expect(a.p50).toBe(b.p50);
    expect(a.simulaciones).toBe(1_000);
    expect(a.muestras).toHaveLength(100);
  });
});
