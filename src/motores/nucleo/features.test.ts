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
    p.mercado.libroEn = () => {
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

describe('Auditoría: cada barra solo usa lo conocido a su cierre', () => {
  const vista = (updatedAt: number) => ({ updatedAt, bids: [{ price: 99, quantity: 30 }], asks: [{ price: 101, quantity: 10 }] }) as never;
  it('el libro vigente es el último con hora ≤ cierre y de hace menos de 2 s (nunca uno posterior ni uno viejo)', () => {
    const m = new MotorMercado();
    m.libroNuevo(vista(1_000), []);
    m.libroNuevo(vista(2_000_000), []);
    expect(m.libroEn(1_500)?.vista).toMatchObject({ updatedAt: 1_000 });
    expect(m.libroEn(999)).toBeNull();
    expect(m.libroEn(600_000)).toBeNull();
  });

  it('cada evento cuenta en UNA barra: (cierre previo, cierre]', () => {
    const m = new MotorMercado();
    m.liquidacion({ t: 1_000, precio: 100, cantidad: 10_000, lado: 'venta' } as never);
    m.liquidacion({ t: 1_010, precio: 100, cantidad: 10_000, lado: 'venta' } as never);
    expect(m.eventosDisponibles(1_000, 990)).toHaveLength(1);
    expect(m.eventosDisponibles(1_020, 1_000)).toHaveLength(1);
  });

  it('el funding es el publicado hasta el cierre', () => {
    const m = new MotorMercado();
    m.funding(0.0001, 1_000);
    m.funding(0.0005, 3_000);
    expect(m.fundingEn(2_000)).toBe(0.0001);
    expect(m.fundingEn(500)).toBeNull();
  });

  it('poc_pos y delta_poc_pos quedan siempre dentro de [0, 1]', () => {
    const p = new Pipeline();
    const t0 = Date.UTC(2026, 9, 21, 10, 0, 0);
    const filas = p.procesar({ tipo: 'trades', trades: Array.from({ length: 4_000 }, (_, i) => ({ symbol: 'BTCUSDT', price: 100_000 + Math.round(Math.sin(i / 50) * 400) + (i % 7) * 0.5, quantity: 0.5 + (i % 5), timestamp: t0 + i * 50, aggTradeId: i + 1, buyerIsMaker: i % 3 === 0 })) });
    expect(filas.length).toBeGreaterThan(3);
    const pos = filas.flatMap((f) => [f.valores.poc_pos, f.valores.delta_poc_pos]).filter((x): x is number => x !== null);
    expect(pos.length).toBeGreaterThan(0);
    expect(pos.every((x) => x >= 0 && x <= 1)).toBe(true);
  });
});
