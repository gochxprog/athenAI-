// Verificación de los motores 7 (Deflated Sharpe) y 8 (PBO) con la especificación del usuario.
import { describe, expect, it } from 'vitest';
import { combinaciones, deflatedSharpe, EULER_GAMMA, normalCdf, normalInversa, pboCscv, sigmaSharpe, srEsperadoMaximo } from './sobreajuste';
import { crearAleatorio, normal } from '@/lib/random';

describe('Normal estándar', () => {
  it('Φ y Z⁻¹ con valores de tabla', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.6448536)).toBeCloseTo(0.95, 6);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 6);
    expect(normalInversa(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalInversa(0.99)).toBeCloseTo(2.326348, 5);
    for (const p of [0.001, 0.2, 0.5, 0.8, 0.999]) expect(normalCdf(normalInversa(p))).toBeCloseTo(p, 6);
  });
});

describe('Motor 7 · Deflated Sharpe', () => {
  it('SR* calculado a mano: Var_SR = 1 y N = 100', () => {
    const aMano = (1 - EULER_GAMMA) * normalInversa(0.99) + EULER_GAMMA * normalInversa(1 - 1 / (100 * Math.E));
    expect(srEsperadoMaximo(1, 100)).toBeCloseTo(aMano, 12);
    expect(aMano).toBeCloseTo(2.5306, 3);
    // Escala con √Var_SR.
    expect(srEsperadoMaximo(0.04, 100)).toBeCloseTo(0.2 * aMano, 12);
    expect(srEsperadoMaximo(1, 1)).toBe(0);
  });

  it('σ_SR: con retornos normales (γ₃ = 0, γ₄ = 3) = √((1 + SR²/2) / (T − 1))', () => {
    expect(sigmaSharpe(0.1, 1_001, 0, 3)).toBeCloseTo(Math.sqrt((1 + 0.01 / 2) / 1_000), 12);
    // Asimetría negativa (colas de pérdidas) agranda la incertidumbre.
    expect(sigmaSharpe(0.1, 1_001, -1, 6)).toBeGreaterThan(sigmaSharpe(0.1, 1_001, 0, 3));
  });

  it('DSR = 0,5 cuando SR_obs = SR*; baja con más variantes; sube con más barras', () => {
    const r = crearAleatorio(1);
    const ret = Array.from({ length: 2_000 }, () => 0.0005 + normal(r) * 0.01);
    const sharpes = Array.from({ length: 20 }, () => normal(r) * 0.03);
    const base = deflatedSharpe(ret, 0.05, 20, sharpes);
    const enUmbral = deflatedSharpe(ret, base.srEstrella, 20, sharpes);
    expect(enUmbral.dsr).toBeCloseTo(0.5, 6);
    expect(deflatedSharpe(ret, 0.05, 200, sharpes).dsr).toBeLessThan(base.dsr);
    const largo = Array.from({ length: 8_000 }, () => 0.0005 + normal(r) * 0.01);
    expect(deflatedSharpe(largo, 0.05, 20, sharpes).dsr).toBeGreaterThan(base.dsr);
    // Con una sola variante en la ejecución: Var_SR = 1/T.
    const una = deflatedSharpe(ret, 0.05, 5, [0.05]);
    expect(una.origenVarSr).toBe('azar');
    expect(una.varSr).toBeCloseTo(1 / 2_000, 15);
    // DSR = Φ((SR_obs − SR*) / σ_SR) con sus propios términos.
    expect(base.dsr).toBeCloseTo(normalCdf((base.srObs - base.srEstrella) / base.sigma), 12);
  });
});

describe('Motor 8 · PBO (CSCV)', () => {
  it('C(16, 8) = 12.870 combinaciones', () => {
    expect(combinaciones(16, 8)).toHaveLength(12_870);
    expect(combinaciones(4, 2)).toEqual([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
  });

  it('cálculo rápido por bloques = cálculo directo (S = 4)', () => {
    const r = crearAleatorio(2);
    const vs = Array.from({ length: 5 }, () => Array.from({ length: 80 }, () => normal(r) * 0.01));
    const rapido = pboCscv(vs, 4)!;
    // Directo: para cada mitad, producto de (1 + r) en IS y OOS.
    const acum = (v: number[], bloques: number[]) => bloques.reduce((a, b) => a * v.slice(b * 20, b * 20 + 20).reduce((x, y) => x * (1 + y), 1), 1);
    let malas = 0;
    for (const dentro of combinaciones(4, 2)) {
      const fuera = [0, 1, 2, 3].filter((b) => !dentro.includes(b));
      const is = vs.map((v) => acum(v, dentro));
      const mejor = is.indexOf(Math.max(...is));
      const oos = vs.map((v) => acum(v, fuera));
      const w = (oos.filter((x) => x < oos[mejor]).length + 1) / (vs.length + 1);
      if (w <= 0.5) malas += 1;
    }
    expect(rapido.pbo).toBeCloseTo(malas / 6, 12);
    expect(rapido.malas).toBe(malas);
  });

  it('puro ruido → PBO ≈ 0,5; una variante buena entre ruido → PBO < 0,05; una sola → null', () => {
    let suma = 0;
    for (let s = 1; s <= 8; s += 1) {
      const rs = crearAleatorio(s);
      suma += pboCscv(Array.from({ length: 10 }, () => Array.from({ length: 1_600 }, () => normal(rs) * 0.01)))!.pbo;
    }
    expect(suma / 8).toBeGreaterThan(0.35);
    expect(suma / 8).toBeLessThan(0.65);
    const r = crearAleatorio(5);
    const ruido = Array.from({ length: 6 }, () => Array.from({ length: 3_200 }, () => normal(r) * 0.01));
    const buena = Array.from({ length: 3_200 }, () => 0.003 + normal(r) * 0.01);
    const pbo = pboCscv([buena, ...ruido])!;
    expect(pbo.pbo).toBeLessThan(0.05);
    expect(pbo.combinaciones).toBe(12_870);
    expect(pboCscv([buena])).toBeNull();
  });
});
