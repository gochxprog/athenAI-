// Verificación del motor 10 (Veredicto): puertas de cero tolerancia y puntuación 0–100.
import { describe, expect, it } from 'vitest';
import { puntuar, veredicto, type EntradaVeredicto } from './veredicto';

const buena: EntradaVeredicto = {
  datosSuficientes: true,
  antiFuturoOk: true,
  probRuina: 0,
  pbo: 0,
  dsr: 1,
  luckP: 0.001,
  robustezRechazada: false,
  wfe: 0.9,
  costos2x: { retorno: 0.5, factorBeneficio: 2 },
  vecinosProporcion: 1,
  sharpeOos: 3,
  ddOos: 0.05,
};

describe('Motor 10 · Veredicto', () => {
  it('puntuación calculada a mano', () => {
    // WFE 0,7 → 1 · costos PF 1,25 → 0,5 y vecinos 0,8 → 0,65 · DSR 0,95 → 0,9 y PBO 0,01 → 0,98 → 0,94 ·
    // luck p 0,01 → 0,8, Sharpe 1 → 0,5, DD 15 % → 0,5 → 0,6.
    const s = puntuar({ ...buena, wfe: 0.7, costos2x: { retorno: 0.1, factorBeneficio: 1.25 }, vecinosProporcion: 0.8, dsr: 0.95, pbo: 0.01, luckP: 0.01, sharpeOos: 1, ddOos: 0.15 });
    expect(s.partes.wfo).toBeCloseTo(1, 12);
    expect(s.partes.costosVecinos).toBeCloseTo(0.65, 12);
    expect(s.partes.sobreajuste).toBeCloseTo(0.94, 12);
    expect(s.partes.curva).toBeCloseTo(0.6, 12);
    expect(s.total).toBeCloseTo(100 * (0.25 * 1 + 0.25 * 0.65 + 0.3 * 0.94 + 0.2 * 0.6), 10);
  });

  it('pasa todas las puertas con ≥ 75 puntos: APROBADA para Paper', () => {
    const v = veredicto(buena);
    expect(v.veredicto).toBe('APROBADA');
    expect(v.score!.total).toBeGreaterThanOrEqual(75);
  });

  it('pasa las puertas con < 75 puntos: APROBADA CON RESERVA', () => {
    const v = veredicto({ ...buena, wfe: 0.3, vecinosProporcion: 0.4, costos2x: { retorno: 0.01, factorBeneficio: 1.05 }, dsr: 0.96, pbo: 0.04, luckP: 0.04, sharpeOos: 0.5, ddOos: 0.25 });
    expect(v.veredicto).toBe('APROBADA CON RESERVA');
    expect(v.score!.total).toBeLessThan(75);
  });

  it('cada puerta de cero tolerancia rechaza sola, con su razón', () => {
    const casos: [Partial<EntradaVeredicto>, string][] = [
      [{ antiFuturoOk: false }, 'Anti-futuro'],
      [{ probRuina: 0.06 }, 'ruina'],
      [{ pbo: 0.05 }, 'PBO'],
      [{ dsr: 0.949 }, 'Deflated Sharpe'],
      [{ luckP: 0.05 }, 'Luck test'],
      [{ robustezRechazada: true }, 'robustez'],
    ];
    for (const [cambio, nombre] of casos) {
      const v = veredicto({ ...buena, ...cambio });
      expect(v.veredicto).toBe('RECHAZADA');
      expect(v.score).toBeNull();
      expect(v.falladas.map((p) => p.nombre).join()).toContain(nombre);
    }
  });

  it('una puerta que no aplica no rechaza; sin datos suficientes no se juzga', () => {
    expect(veredicto({ ...buena, pbo: null }).veredicto).toBe('APROBADA');
    expect(veredicto({ ...buena, datosSuficientes: false }).veredicto).toBe('DATOS INSUFICIENTES');
  });
});
