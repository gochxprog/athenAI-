import { describe, expect, it } from 'vitest';
import { carpetaMercado, esMercadoId, mercadoDeCarpeta, mercadoId, mercadoIdSeguro, partesMercado } from './mercadoId';

describe('market_id', () => {
  it('se forma con proveedor y símbolo y se separa igual', () => {
    expect(mercadoId('binance', 'BTCUSDT')).toBe('binance:BTCUSDT');
    expect(partesMercado('binance:XAUUSDT')).toEqual({ proveedor: 'binance', simbolo: 'XAUUSDT' });
  });

  it('rechaza proveedores o símbolos raros (nada de rutas ni minúsculas)', () => {
    expect(() => mercadoId('binance', '../etc')).toThrow();
    expect(() => mercadoId('binance', 'btcusdt')).toThrow();
    expect(() => mercadoId('otro' as never, 'BTCUSDT')).toThrow();
    expect(esMercadoId('binance:BTCUSDT')).toBe(true);
    expect(esMercadoId('BTCUSDT')).toBe(false);
    expect(esMercadoId('binance:BTC/USDT')).toBe(false);
    expect(mercadoIdSeguro('binance', 'ETHUSDT')).toBe('binance:ETHUSDT');
    expect(mercadoIdSeguro('binance', 'ETH/USDT')).toBeNull();
  });

  it('cada mercado tiene su carpeta, ida y vuelta', () => {
    expect(carpetaMercado('binance:BTCUSDT')).toBe('binance_btcusdt');
    expect(carpetaMercado('binance:XAUUSDT')).toBe('binance_xauusdt');
    expect(mercadoDeCarpeta('binance_btcusdt')).toBe('binance:BTCUSDT');
    expect(mercadoDeCarpeta('BTCUSDT')).toBeNull();
    expect(mercadoDeCarpeta('nada_btcusdt')).toBeNull();
  });
});
