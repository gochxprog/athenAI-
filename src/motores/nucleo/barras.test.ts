import { describe, expect, it } from 'vitest';
import { aggregateFootprintTrades } from '../urus/order-flow/footprint';
import { ConstructorBarras, type BarraCerrada } from './barras';
import { TEMPORALIDADES, type AggTrade } from './tipos';
import { crearAleatorio, normal } from '@/lib/random';

function generarTrades(n: number, semilla = 7, inicio = 1_760_000_000_000): AggTrade[] {
  const r = crearAleatorio(semilla);
  const out: AggTrade[] = [];
  let precio = 84_700;
  let ts = inicio;
  for (let i = 0; i < n; i += 1) {
    ts += Math.floor(r() * 120);
    precio = Math.round((precio + normal(r) * 2) * 10) / 10;
    out.push({ symbol: 'BTCUSDT', price: precio, quantity: Math.round(Math.exp(normal(r) * 0.8) * 50) / 1000 + 0.001, timestamp: ts, aggTradeId: i + 1, buyerIsMaker: r() < 0.5 });
  }
  return out;
}

describe('ConstructorBarras', () => {
  it('produce exactamente los mismos niveles de Footprint que Urus (aggregateFootprintTrades)', () => {
    const trades = generarTrades(20_000);
    const c = new ConstructorBarras(TEMPORALIDADES['1m'], 5);
    const barras: BarraCerrada[] = [];
    for (const t of trades) {
      const b = c.agregar(t);
      if (b) barras.push(b);
    }
    expect(barras.length).toBeGreaterThan(5);
    for (const b of barras) {
      const delIntervalo = trades.filter((t) => t.timestamp >= b.inicio && t.timestamp < b.inicio + 60_000);
      const urus = aggregateFootprintTrades(delIntervalo, { timeframeMs: 60_000, tickSize: 0.1, priceMultiplier: 50, candleStart: b.inicio, candleClose: b.ohlc.close, complete: true });
      expect(b.footprint.levels.length).toBe(urus.levels.length);
      b.footprint.levels.forEach((l, i) => {
        expect(l.price).toBe(urus.levels[i].price);
        expect(l.bidQty).toBeCloseTo(urus.levels[i].bidQty, 9);
        expect(l.askQty).toBeCloseTo(urus.levels[i].askQty, 9);
        expect(l.tradeCount).toBe(urus.levels[i].tradeCount);
      });
      expect(b.footprint.pocPrice).toBe(urus.pocPrice);
      expect(b.delta).toBeCloseTo(urus.delta, 9);
    }
  });

  it('cierra las dollar bars al cruzar el umbral de nocional', () => {
    const trades = generarTrades(30_000, 3);
    const c = new ConstructorBarras({ id: 'dollar', tipo: 'dolar', usd: 2_000_000 }, 5);
    const barras = trades.map((t) => c.agregar(t)).filter((b): b is BarraCerrada => b !== null);
    expect(barras.length).toBeGreaterThan(10);
    for (const b of barras) {
      expect(b.nocional).toBeGreaterThanOrEqual(2_000_000);
      // El exceso nunca supera el último trade (que cruzó el umbral).
      expect(b.nocional - 2_000_000).toBeLessThan(85_000 * 2);
    }
  });

  it('cierra las volume bars al cruzar el umbral de volumen', () => {
    const trades = generarTrades(30_000, 4);
    const c = new ConstructorBarras({ id: 'volume', tipo: 'volumen', base: 20 }, 5);
    const barras = trades.map((t) => c.agregar(t)).filter((b): b is BarraCerrada => b !== null);
    expect(barras.length).toBeGreaterThan(10);
    for (const b of barras) expect(b.volumen).toBeGreaterThanOrEqual(20);
  });

  it('ignora trades duplicados o desordenados por id', () => {
    const c = new ConstructorBarras(TEMPORALIDADES['1m'], 5);
    const t: AggTrade = { symbol: 'BTCUSDT', price: 84_700, quantity: 1, timestamp: 1_760_000_000_000, aggTradeId: 10, buyerIsMaker: false };
    c.agregar(t);
    c.agregar({ ...t });
    c.agregar({ ...t, aggTradeId: 9 });
    expect(c.enCurso()?.volumen).toBe(1);
  });
});
