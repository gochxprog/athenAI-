import { describe, expect, it } from 'vitest';
import { DEFINICIONES_FEATURES, div, MIN_Z, zMovil } from './features';
import { MotorMercado } from './motorMercado';
import { Pipeline } from './pipeline';

describe('Features sin escala (valores a mano)', () => {
  it('el catálogo tiene 39 Features y ninguna en USD, BTC ni acumulada', () => {
    expect(DEFINICIONES_FEATURES).toHaveLength(39);
    const claves = DEFINICIONES_FEATURES.map((d) => d.clave);
    for (const vieja of ['delta', 'cvd_sesion', 'cvd_pendiente_5', 'duracion_s', 'imb_compra', 'imb_venta', 'bigtrades_compra_usd', 'bigtrades_venta_usd', 'liq_largos_usd', 'liq_cortos_usd', 'microprice_ticks']) expect(claves).not.toContain(vieja);
    expect(new Set(claves).size).toBe(39);
  });

  it('div: nunca NaN ni infinito', () => {
    expect(div(1, 4)).toBe(0.25);
    expect(div(1, 0)).toBeNull();
    expect(div(1, 1e-15)).toBeNull();
    expect(div(NaN, 2)).toBeNull();
    expect(div(1, Infinity)).toBeNull();
    expect(div(null, 2)).toBeNull();
  });

  it('z robusto con ventana móvil: 0,6745 × (x − mediana) / MAD, solo pasado, recortado a ±10', () => {
    const previos = Array.from({ length: 30 }, (_, i) => i + 1); // 1…30: mediana 15,5; |x − 15,5| = 0,5…14,5 → MAD 7,5
    expect(zMovil(30.5, previos)).toBeCloseTo((0.6745 * 15) / 7.5, 12); // 1,349
    expect(zMovil(1_000, previos)).toBe(10);
    expect(zMovil(-1_000, previos)).toBe(-10);
    expect(zMovil(5, previos.slice(0, MIN_Z - 1))).toBeNull(); // menos de 30 barras previas
    expect(zMovil(NaN, previos)).toBeNull();
    // Todos iguales (MAD 0): z = 0, nunca infinito.
    expect(zMovil(5, Array(40).fill(3))).toBe(0);
  });

  it('CVD de sesión / volumen de la sesión ∈ [−1, 1]', () => {
    let id = 1;
    const m = new MotorMercado();
    const t0 = Date.UTC(2026, 9, 21, 7, 0, 5); // inicio de Londres
    m.trade({ symbol: 'BTCUSDT', price: 100, quantity: 2, timestamp: t0, aggTradeId: id++, buyerIsMaker: false });
    m.trade({ symbol: 'BTCUSDT', price: 100, quantity: 0.5, timestamp: t0 + 1, aggTradeId: id++, buyerIsMaker: true });
    // CVD = 2 − 0,5 = 1,5 ; volumen = 2,5 ; ratio = 0,6
    expect(div(m.cvdSesion, m.cvdVolumenSesion)).toBeCloseTo(0.6, 12);
  });

  it('si el cálculo de una fila falla, el motor sigue: la fila sale vacía y con hueco = 1', () => {
    const p = new Pipeline();
    p.mercado.poolsVivos = () => {
      throw new Error('fallo de prueba');
    };
    const t0 = Date.UTC(2026, 9, 21, 10, 0, 0);
    const filas = p.procesar({ tipo: 'trades', trades: [1, 2, 3, 4, 5].map((i) => ({ symbol: 'BTCUSDT', price: 1_000_000, quantity: 2, timestamp: t0 + i, aggTradeId: i, buyerIsMaker: false })) });
    expect(filas).toHaveLength(1);
    expect(filas[0].valores.hueco).toBe(1);
    expect(filas[0].valores.delta_ratio).toBeNull();
    expect(p.erroresFeatures).toBe(1);
  });
});
