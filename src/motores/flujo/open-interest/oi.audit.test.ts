import { describe, it, expect } from 'vitest';
import { 
  calculateRobustZScore, 
  checkOIInvariant,
  detectOIGap
} from './engine';

describe('Auditoría de Open Interest - Parte 2', () => {
  it('Z-Score Robusto debe retornar 0 si MAD es cero (Mercado Plano / Consolidación)', () => {
    // Si el OI no varía en varios minutos, MAD = 0. No debe emitir NaN ni Infinity
    const zScore = calculateRobustZScore(150, 150, 0);
    expect(Number.isNaN(zScore)).toBe(false);
    expect(Number.isFinite(zScore)).toBe(true);
    expect(zScore).toBe(0);
  });

  it('Invariante del Perfil de OI: La suma acumulada de deltas debe ser idéntica a OI_t - OI_0', () => {
    const oiInitial = 1000000;
    const deltas = [+5000, -2000, +15000, -8000, +300];
    const oiFinal = oiInitial + deltas.reduce((acc, d) => acc + d, 0);

    const isInvariantValid = checkOIInvariant(oiInitial, oiFinal, deltas);
    expect(isInvariantValid).toBe(true);
  });

  it('Detección de Gaps: Debe marcar anomalía o gap si el salto de tiempo entre lecturas es excesivo', () => {
    const lastTimestamp = 1700000000000;
    const currentTimestamp = lastTimestamp + (60 * 1000 * 10); // 10 minutos después (esperado cada 5s/1m)

    const isGap = detectOIGap(lastTimestamp, currentTimestamp, 60000); // Max threshold 1 min
    expect(isGap).toBe(true);
  });
});
