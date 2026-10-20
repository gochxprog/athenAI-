// Verificación del motor 1 (Backtest) con casos calculados a mano y un invariante.
import { describe, expect, it } from 'vitest';
import { aplicarHuecos, backtest, maxDrawdown, metricas, sharpeBarras } from './backtest';
import { crearAleatorio } from '@/lib/random';

const SIN = { comisionPb: 0, deslizamientoPb: 0 };
const C10 = { comisionPb: 10, deslizamientoPb: 0 }; // c = 0,001 por lado

describe('Motor 1 · Backtest', () => {
  it('largo 1 barra: gana el movimiento de la barra siguiente, paga entrada y salida', () => {
    // Decide largo al cierre de la barra 0 (100); rige en la barra 1 (100 → 110); sale al cierre de la 1.
    const b = backtest([100, 110, 121], [1, 0, 0], C10);
    expect(b.retornos[0]).toBeCloseTo(-0.001, 12); // entrada
    expect(b.retornos[1]).toBeCloseTo(1.1 * 0.999 - 1, 12); // +10 % y salida
    expect(b.retornos[2]).toBe(0); // la barra 2 (+10 %) ya no cuenta
    expect(b.operaciones).toEqual([{ entrada: 0, salida: 1, lado: 1, retorno: expect.closeTo(0.999 * 1.1 * 0.999 - 1, 12), barras: 1 }]);
  });

  it('corto 1 barra: gana cuando baja', () => {
    const b = backtest([100, 90, 90], [-1, 0, 0], SIN);
    expect(b.equity[2]).toBeCloseTo(1.1, 12); // −1 × (90/100 − 1) = +10 %
    expect(b.operaciones[0]).toMatchObject({ lado: -1, barras: 1 });
  });

  it('giro de largo a corto paga dos lados y separa las operaciones', () => {
    const b = backtest([100, 110, 99, 99], [1, -1, 0, 0], C10);
    expect(b.retornos[1]).toBeCloseTo(1.1 * 0.999 ** 2 - 1, 12);
    expect(b.operaciones.map((o) => o.lado)).toEqual([1, -1]);
    expect(b.operaciones[1].retorno).toBeCloseTo(0.999 * (1 - (99 / 110 - 1)) * 0.999 - 1, 12);
  });

  it('cierre forzado en la última barra del tramo', () => {
    const b = backtest([100, 101, 102, 103], [1, 1, 1, 1], SIN);
    expect(b.operaciones).toEqual([{ entrada: 0, salida: 3, lado: 1, retorno: expect.closeTo(0.03, 12), barras: 3 }]);
    // Un tramo parcial también cierra en su última barra.
    const t = backtest([100, 101, 102, 103], [1, 1, 1, 1], SIN, 0, 2);
    expect(t.operaciones[0]).toMatchObject({ salida: 1, barras: 1 });
    expect(t.equity[3]).toBeCloseTo(1.01, 12);
  });

  it('nunca mantiene posición a través de un hueco de datos', () => {
    const huecos = [false, false, true, false, false];
    // Sin la regla, la barra 2 (hueco, +50 %) contaría.
    const b = backtest([100, 100, 150, 150, 160], [1, 1, 1, 1, 0], SIN, 0, 5, huecos);
    expect(b.retornos[2]).toBe(0);
    expect(b.operaciones.map((o) => [o.entrada, o.salida])).toEqual([
      [0, 1],
      [2, 4],
    ]);
    expect(b.equity[4]).toBeCloseTo(160 / 150, 12);
    expect(aplicarHuecos([1, 1, 1, 1, 0], huecos)).toEqual([1, 0, 1, 1, 0]);
  });

  it('sin costos: capital final = producto de los movimientos con posición', () => {
    const cierres = [100, 102, 101, 105, 104, 108];
    const pos = [1, 1, 0, -1, -1, 0];
    let esperado = 1;
    for (let i = 0; i + 1 < cierres.length; i += 1) esperado *= 1 + pos[i] * (cierres[i + 1] / cierres[i] - 1);
    expect(backtest(cierres, pos, SIN).equity[cierres.length - 1]).toBeCloseTo(esperado, 12);
  });

  it('invariante: capital final = Π(1 + retorno de cada operación), con costos y posiciones al azar', () => {
    const r = crearAleatorio(7);
    for (let prueba = 0; prueba < 20; prueba += 1) {
      const n = 1_000;
      const cierres = [100];
      for (let i = 1; i < n; i += 1) cierres.push(cierres[i - 1] * (1 + (r() - 0.5) * 0.02));
      const pos = cierres.map(() => [-1, 0, 1][Math.floor(r() * 3)]);
      const huecos = cierres.map(() => r() < 0.01);
      const b = backtest(cierres, pos, { comisionPb: 4, deslizamientoPb: 1 }, 0, n, huecos);
      const porOperaciones = b.operaciones.reduce((a, o) => a * (1 + o.retorno), 1);
      expect(b.equity[n - 1]).toBeCloseTo(porOperaciones, 10);
    }
  });

  it('drawdown, Sharpe y factor de beneficio contra cálculo directo', () => {
    expect(maxDrawdown([1, 1.2, 0.9, 1.1, 0.6, 1.3])).toBeCloseTo(0.5, 12); // 1,2 → 0,6
    const rets = [0.01, -0.02, 0.03, 0.0, 0.01, -0.01, 0.02, 0.0, 0.01, -0.005];
    const m = rets.reduce((a, v) => a + v, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, v) => a + (v - m) ** 2, 0) / (rets.length - 1));
    expect(sharpeBarras(rets)).toBeCloseTo(m / sd, 12);
    // Dos operaciones ganadoras y ninguna perdedora: factor de beneficio infinito.
    const b = backtest([100, 110, 110, 121, 121], [1, 0, 1, 0, 0], SIN);
    expect(metricas(b, [0, 1, 2, 3, 4].map((x) => x * 86_400_000)).factorBeneficio).toBe(Infinity);
  });
});
