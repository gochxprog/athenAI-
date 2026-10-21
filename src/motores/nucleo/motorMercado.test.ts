import { describe, expect, it } from 'vitest';
import { MotorMercado } from './motorMercado';
import type { AggTrade } from './tipos';

let id = 1;
const trade = (timestamp: number, price: number, quantity: number, compra: boolean): AggTrade => ({ symbol: 'BTCUSDT', price, quantity, timestamp, aggTradeId: id++, buyerIsMaker: !compra });

describe('CVD y VWAP de sesión: completos solo si se vio el inicio', () => {
  it('desde el inicio de Londres (07:00 UTC) el CVD es completo y vale compras − ventas (a mano)', () => {
    const m = new MotorMercado();
    const t0 = Date.UTC(2026, 9, 21, 7, 0, 5);
    m.trade(trade(t0, 100, 2, true));
    m.trade(trade(t0 + 1_000, 101, 0.5, false));
    expect(m.cvdCompleto).toBe(true);
    expect(m.cvdSesion).toBeCloseTo(1.5, 12);
    // Un corte deja la sesión a medias.
    m.marcarHueco();
    expect(m.cvdCompleto).toBe(false);
  });

  it('abrir la app a mitad de sesión → incompleto (no se inventa el CVD que no se vio)', () => {
    const m = new MotorMercado();
    m.trade(trade(Date.UTC(2026, 9, 21, 8, 30, 0), 100, 1, true));
    expect(m.cvdCompleto).toBe(false);
    // Al empezar la sesión siguiente (Nueva York, 12:30 UTC) ya es completo.
    m.trade(trade(Date.UTC(2026, 9, 21, 12, 30, 1), 100, 1, false));
    expect(m.cvdCompleto).toBe(true);
    expect(m.cvdSesion).toBeCloseTo(-1, 12);
  });

  it('VWAP del día = Σ precio × cantidad / Σ cantidad, completo solo desde las 00:00 UTC', () => {
    const m = new MotorMercado();
    const t0 = Date.UTC(2026, 9, 21, 0, 0, 10);
    m.trade(trade(t0, 100, 1, true));
    m.trade(trade(t0 + 1, 103, 2, false));
    expect(m.vwapSesion).toBeCloseTo((100 + 206) / 3, 12);
    expect(m.vwapCompleto).toBe(true);
    const tarde = new MotorMercado();
    tarde.trade(trade(Date.UTC(2026, 9, 21, 9, 0, 0), 100, 1, true));
    expect(tarde.vwapCompleto).toBe(false);
  });
});
