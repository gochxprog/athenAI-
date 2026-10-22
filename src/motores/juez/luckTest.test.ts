// Verificación del motor 5 (Luck test) con la especificación del usuario.
import { describe, expect, it } from 'vitest';
import { entradasAleatorias, luckTest, metricaLuck, permutarRetornos } from './luckTest';
import { backtest } from './backtest';
import { crearAleatorio, normal } from '@/lib/random';

const SIN = { comisionPb: 0, deslizamientoPb: 0 };

function mercado(n: number, persistencia: number, semilla: number) {
  const r = crearAleatorio(semilla);
  const cierres = [100];
  let previo = 0;
  for (let i = 1; i < n; i += 1) {
    const ret = persistencia * previo + normal(r) * 0.003;
    previo = ret;
    cierres.push(cierres[i - 1] * (1 + ret));
  }
  return cierres;
}
const momentum = (c: number[]) => c.map((x, i) => (i < 1 ? 0 : Math.sign(x - c[i - 1])));

describe('Motor 5 · Luck test', () => {
  it('permutación: mismos retornos en otro orden (comprar y mantener da lo mismo)', () => {
    const c = mercado(300, 0, 1);
    const f = permutarRetornos(c, 100, 300, crearAleatorio(2));
    expect(f.slice(0, 101)).toEqual(c.slice(0, 101));
    const rets = (x: number[]) => x.slice(100).map((v, i, a) => (i ? v / a[i - 1] - 1 : 0)).slice(1);
    expect([...rets(f)].sort().map((x) => x.toFixed(12))).toEqual([...rets(c)].sort().map((x) => x.toFixed(12)));
    expect(f[299] / f[100]).toBeCloseTo(c[299] / c[100], 10);
    expect(f).not.toEqual(c);
  });

  it('entradas aleatorias: mismas duraciones, sin solapes y ≈ 50 % largos', () => {
    const ops = [3, 5, 1, 8, 2].map((barras) => ({ barras }));
    let largos = 0;
    let total = 0;
    for (let k = 0; k < 400; k += 1) {
      const pos = entradasAleatorias(200, ops, 50, 200, crearAleatorio(k + 1));
      expect(pos.slice(0, 50).every((x) => x === 0)).toBe(true);
      expect(pos[199]).toBe(0);
      // Tramos seguidos con posición = duraciones (en algún orden), separados por al menos una barra fuera.
      const tramos: number[] = [];
      let i = 50;
      while (i < 200) {
        if (pos[i] !== 0) {
          let j = i;
          while (j < 200 && pos[j] === pos[i]) j += 1;
          tramos.push(j - i);
          if (pos[i] > 0) largos += 1;
          total += 1;
          i = j;
        } else i += 1;
      }
      expect(tramos.sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 8]);
    }
    expect(largos / total).toBeGreaterThan(0.45);
    expect(largos / total).toBeLessThan(0.55);
  });

  it('el backtest de las entradas aleatorias reproduce las mismas duraciones', () => {
    const c = mercado(400, 0, 3);
    const ops = [4, 6, 2].map((barras) => ({ barras }));
    const b = backtest(c, entradasAleatorias(400, ops, 0, 400, crearAleatorio(4)), SIN);
    expect(b.operaciones.map((o) => o.barras).sort((a, x) => a - x)).toEqual([2, 4, 6]);
  });

  it('p = (c + 1) / (N + 1) y métricas calculadas a mano', () => {
    const c = [100, 110, 99, 99];
    const b = backtest(c, [1, 1, 0, 0], SIN);
    expect(metricaLuck(b, 0, 4, 'retorno')).toBeCloseTo(1.1 * 0.9 - 1, 12);
    expect(metricaLuck(b, 0, 4, 'esperanza')).toBeCloseTo(1.1 * 0.9 - 1, 12);
    // Una estrategia «perfecta» (sabe el siguiente movimiento) en 1 barra de mercado: ninguna permutación la supera.
    const m = mercado(600, 0, 5);
    const perfecta = m.map((x, i) => (i + 1 < m.length ? Math.sign(m[i + 1] - x) : 0));
    const b2 = backtest(m, perfecta, SIN);
    const r = luckTest({ cierres: m, posiciones: perfecta, operaciones: b2.operaciones, desde: 0, hasta: 600, costos: SIN, azar: crearAleatorio(6), config: { permutaciones: 200 } });
    expect(r.superiores).toBe(0);
    expect(r.p).toBeCloseTo(1 / 201, 12);
  });

  it('ventaja real: p < 0,05 con los dos métodos', () => {
    const c = mercado(3_000, 0.5, 7);
    const pos = momentum(c);
    const b = backtest(c, pos, SIN, 1_000, 3_000);
    for (const metodo of ['permutacion', 'entradas-aleatorias'] as const) {
      const r = luckTest({ cierres: c, posiciones: pos, operaciones: b.operaciones, desde: 1_000, hasta: 3_000, costos: SIN, azar: crearAleatorio(8), config: { metodo, permutaciones: 300 } });
      expect(r.p).toBeLessThan(0.05);
    }
  });

  it('sin ventaja (paseo aleatorio): p < 0,05 solo pocas veces (falsos positivos)', () => {
    let aprobadas = 0;
    for (let s = 1; s <= 20; s += 1) {
      const c = mercado(1_500, 0, 100 + s);
      const pos = momentum(c);
      const b = backtest(c, pos, SIN, 500, 1_500);
      const r = luckTest({ cierres: c, posiciones: pos, operaciones: b.operaciones, desde: 500, hasta: 1_500, costos: SIN, azar: crearAleatorio(s), config: { permutaciones: 200 } });
      if (r.p < 0.05) aprobadas += 1;
    }
    expect(aprobadas / 20).toBeLessThanOrEqual(0.2);
  });
});

