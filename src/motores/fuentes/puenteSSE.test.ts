import { describe, expect, it } from 'vitest';
import { interpretarEnvelope } from './puenteSSE';
import { OrderBookEngine } from '../flujo/order-flow/order-book';

describe('interpretarEnvelope (protocolo del puente)', () => {
  it('traduce un lote de trades', () => {
    const m = interpretarEnvelope({ t: 'trades:BTCUSDT', e: 'trades', d: [{ symbol: 'BTCUSDT', price: 84_700.1, quantity: 0.5, timestamp: 1, aggTradeId: 9, buyerIsMaker: true }, { basura: 1 }] });
    expect(m).toEqual({ tipo: 'trades', trades: [{ symbol: 'BTCUSDT', price: 84_700.1, quantity: 0.5, timestamp: 1, aggTradeId: 9, buyerIsMaker: true }] });
  });
  it('traduce la vista del libro que calcula el OrderBookEngine del servidor', () => {
    const libro = new OrderBookEngine({ symbol: 'BTCUSDT', tickSize: 0.1 });
    libro.applySnapshot({ lastUpdateId: 1, timestamp: 1, bids: [[84_700, 2]], asks: [[84_700.1, 3]] });
    const vista = libro.getView(20, 1);
    expect(interpretarEnvelope({ t: 'book:BTCUSDT:200:10', e: 'book', d: vista })).toEqual({ tipo: 'libro', vista });
  });
  it('convierte errores de proveedor en estado de conexión e ignora lo desconocido', () => {
    expect(interpretarEnvelope({ t: 'book:BTCUSDT:200:10', e: 'status', d: { state: 'PROVIDER_ERROR' } })?.tipo).toBe('conexion');
    expect(interpretarEnvelope({ t: 'kline:BTCUSDT:1m', e: 'data', d: {} })).toBeNull();
    expect(interpretarEnvelope({ t: 'trades:BTCUSDT', e: 'trades', d: [] })).toBeNull();
  });
});
