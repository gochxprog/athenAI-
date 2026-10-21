// Verificación del motor 6 (Robustez) con la especificación del usuario.
import { describe, expect, it } from 'vitest';
import { robustez, subperiodos, vecinosContiguos } from './robustez';
import { backtest, metricas } from './backtest';
import { elegirVariante, walkForward } from './walkForward';
import type { Combo } from './juez';
import { crearAleatorio, normal } from '@/lib/random';

const H = 3_600_000;
function mercado(n: number, persistencia: number, semilla: number) {
  const r = crearAleatorio(semilla);
  const cierres = [100];
  let previo = 0;
  for (let i = 1; i < n; i += 1) {
    const ret = persistencia * previo + normal(r) * 0.003;
    previo = ret;
    cierres.push(cierres[i - 1] * (1 + ret));
  }
  return { cierres, tiempos: cierres.map((_, i) => i * H) };
}
const momentum = (c: number[], k: number) => c.map((x, i) => (i < k ? 0 : Math.sign(x - c[i - k])));

function correr(cierres: number[], tiempos: number[], combos: Combo[], posiciones: number[][], comisionPb = 2) {
  const costos = { comisionPb, deslizamientoPb: 0 };
  const w = walkForward({ cierres, tiempos, posiciones, costos });
  const mejor = elegirVariante({ cierres, tiempos, posiciones, costos }, 0, w.inicioOos - w.embargo, 'sharpe').combo;
  const met = posiciones.map((p) => metricas(backtest(cierres, p, costos, w.inicioOos, cierres.length), tiempos, w.inicioOos, cierres.length));
  return robustez({ cierres, tiempos, posiciones, combos, mejor, metOos: met, ventanas: w.ventanas, inicioOos: w.inicioOos, retornosOos: w.retornos, costos });
}

describe('Motor 6 · Robustez', () => {
  it('vecinos contiguos: un paso arriba y abajo de cada parámetro, el resto igual', () => {
    const combos: Combo[] = [];
    for (const a of [10, 20, 30, 40]) for (const b of [1, 2]) combos.push({ a, b });
    const base = combos.findIndex((c) => c.a === 20 && c.b === 1);
    const v = vecinosContiguos(combos, base).map((x) => x.cambio).sort();
    expect(v).toEqual(['a 20 → 10', 'a 20 → 30', 'b 1 → 2']);
    expect(vecinosContiguos([{ k: 1 }], 0)).toEqual([]);
  });

  it('sub-periodos: 10 tramos estancos con dirección y volatilidad', () => {
    const cierres = Array.from({ length: 101 }, (_, i) => 100 + (i < 50 ? i : 100 - i) * (i % 2 ? 1.5 : 1));
    const s = subperiodos(cierres, new Array(101).fill(0), 0, 100);
    expect(s).toHaveLength(10);
    expect(s[0].direccion).toBe('sube');
    expect(s[9].direccion).toBe('baja');
    expect(s.filter((x) => x.volatilidad === 'alta').length).toBeLessThanOrEqual(5);
  });

  it('estrategia con ventaja real y parámetros estables: aprobada', () => {
    const { cierres, tiempos } = mercado(6_000, 0.5, 1);
    const combos: Combo[] = [1, 2, 3, 4, 5].map((k) => ({ k }));
    const r = correr(cierres, tiempos, combos, combos.map((c) => momentum(cierres, c.k as number)));
    expect(r.costos2x.ok).toBe(true);
    expect(r.vecinos.ok).toBe(true);
    expect(r.estabilidad.consistencia).toBeGreaterThanOrEqual(0.6);
    expect(r.estado).toBe('aprobado');
  });

  it('frágil ante fricciones: con costos altos el doble de costos la tumba', () => {
    const { cierres, tiempos } = mercado(6_000, 0.5, 1);
    const combos: Combo[] = [{ k: 1 }];
    const r = correr(cierres, tiempos, combos, [momentum(cierres, 1)], 25);
    expect(r.costos2x.ok).toBe(false);
  });

  it('isla de optimización: solo un valor del parámetro funciona', () => {
    const { cierres, tiempos } = mercado(6_000, 0.5, 2);
    const az = crearAleatorio(3);
    const combos: Combo[] = [1, 2, 3, 4, 5].map((k) => ({ k }));
    const posiciones = combos.map((c) => (c.k === 3 ? momentum(cierres, 1) : cierres.map(() => (az() < 0.5 ? 1 : -1))));
    const r = correr(cierres, tiempos, combos, posiciones);
    expect(r.vecinos.ok).toBe(false);
    expect(r.vecinos.isla).toBe(true);
  });

  it('sin ventaja (paseo aleatorio): rechazada por robustez', () => {
    const { cierres, tiempos } = mercado(6_000, 0, 4);
    const combos: Combo[] = [1, 2, 3].map((k) => ({ k }));
    const r = correr(cierres, tiempos, combos, combos.map((c) => momentum(cierres, c.k as number)));
    expect(r.fallas).toBeGreaterThanOrEqual(2);
    expect(r.estado).toBe('rechazado');
  });
});
