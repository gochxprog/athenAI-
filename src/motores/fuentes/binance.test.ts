import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FuenteBinance, grupoParaPrecio, type SocketMinimo } from './binance';
import type { MensajeMercado } from '../nucleo/tipos';

class SocketFalso implements SocketMinimo {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  cerrado = false;
  constructor(readonly url: string) {}
  close() {
    this.cerrado = true;
  }
  emitir(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const diff = (U: number, u: number, pu: number, b: [string, string][] = [], a: [string, string][] = []) => ({
  stream: 'btcusdt@depth@100ms',
  data: { e: 'depthUpdate', E: 1, T: 1, s: 'BTCUSDT', U, u, pu, b, a },
});

function montar(snapshotId = 100) {
  const mensajes: { s: string; m: MensajeMercado }[] = [];
  const sockets: SocketFalso[] = [];
  const pedidos: string[] = [];
  let resolverSnapshot: (() => void) | null = null;
  const fetchImpl = vi.fn(async (url: string) => {
    pedidos.push(url);
    const json = (x: unknown) => ({ ok: true, status: 200, json: async () => x }) as Response;
    if (url.includes('exchangeInfo')) return json({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] });
    if (url.includes('ticker/24hr')) return json({ lastPrice: '84700.0', quoteVolume: '18000000000' });
    if (url.includes('openInterest')) return json({ symbol: 'BTCUSDT', openInterest: '81240.123', time: 5 });
    if (url.includes('depth')) {
      await new Promise<void>((ok) => (resolverSnapshot = ok));
      return json({ lastUpdateId: snapshotId, T: 1, bids: [['84699.9', '2.0'], ['84699.0', '5.0']], asks: [['84700.0', '1.5'], ['84701.0', '4.0']] });
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  const infos: unknown[] = [];
  const fuente = new FuenteBinance({
    simbolos: ['btcusdt', 'NOEXISTE'],
    onMensaje: (s, m) => mensajes.push({ s, m }),
    onInfo: (i) => infos.push(i),
    crearSocket: (url) => {
      const so = new SocketFalso(url);
      sockets.push(so);
      return so;
    },
    fetchImpl,
  });
  return { fuente, mensajes, sockets, pedidos, infos, soltarSnapshot: () => resolverSnapshot?.() };
}

const esperar = () => new Promise((ok) => setTimeout(ok, 0));

describe('FuenteBinance (protocolo de Binance USD-M Futures)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval'] }));
  afterEach(() => vi.useRealTimers());

  it('lee tickSize y volumen, abre el stream combinado y rechaza símbolos inexistentes', async () => {
    const { fuente, sockets, infos, mensajes } = montar();
    await fuente.iniciar();
    expect(infos).toEqual([{ simbolo: 'BTCUSDT', tickSize: 0.1, precio: 84700, volumen24hUsd: 18e9 }]);
    expect(sockets[0].url).toBe('wss://fstream.binance.com/stream?streams=btcusdt@aggTrade/btcusdt@depth@100ms');
    expect(mensajes.some((x) => x.s === 'NOEXISTE' && x.m.tipo === 'conexion' && x.m.estado === 'error')).toBe(true);
    fuente.detener();
  });

  it('convierte aggTrades y los entrega en lotes ordenados', async () => {
    const { fuente, sockets, mensajes } = montar();
    await fuente.iniciar();
    const so = sockets[0];
    so.emitir({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', s: 'BTCUSDT', a: 11, p: '84700.1', q: '0.250', T: 1000, m: false } });
    so.emitir({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', s: 'BTCUSDT', a: 10, p: '84700.0', q: '0.100', T: 999, m: true } });
    vi.advanceTimersByTime(100);
    const lote = mensajes.find((x) => x.m.tipo === 'trades')?.m;
    expect(lote).toEqual({
      tipo: 'trades',
      trades: [
        { symbol: 'BTCUSDT', price: 84700, quantity: 0.1, timestamp: 999, aggTradeId: 10, buyerIsMaker: true },
        { symbol: 'BTCUSDT', price: 84700.1, quantity: 0.25, timestamp: 1000, aggTradeId: 11, buyerIsMaker: false },
      ],
    });
    expect(mensajes.some((x) => x.m.tipo === 'conexion' && x.m.estado === 'en-vivo')).toBe(true);
    fuente.detener();
  });

  it('sincroniza el libro: guarda diffs, descarta los viejos y encadena por pu', async () => {
    const { fuente, sockets, soltarSnapshot } = montar(100);
    await fuente.iniciar();
    const so = sockets[0];
    so.onopen?.({});
    so.emitir(diff(90, 95, 89)); // viejo: u < 100 → se descarta
    so.emitir(diff(96, 105, 95, [['84699.9', '3.0']])); // cubre el snapshot (96 ≤ 100 ≤ 105)
    soltarSnapshot();
    await esperar();
    await esperar();
    so.emitir(diff(106, 110, 105, [], [['84700.0', '0']]));
    expect(fuente.estadoLibro('BTCUSDT')).toEqual({ listo: true, resincronizaciones: 0, ultimoU: 110 });
    fuente.detener();
  });

  it('acepta el primer diff en vivo tras un snapshot sin diffs guardados', async () => {
    const { fuente, sockets, soltarSnapshot } = montar(100);
    await fuente.iniciar();
    sockets[0].onopen?.({});
    soltarSnapshot();
    await esperar();
    await esperar();
    sockets[0].emitir(diff(99, 103, 98));
    sockets[0].emitir(diff(104, 108, 103));
    expect(fuente.estadoLibro('BTCUSDT')).toEqual({ listo: true, resincronizaciones: 0, ultimoU: 108 });
    fuente.detener();
  });

  it('detecta un hueco en la cadena y resincroniza con un snapshot nuevo', async () => {
    const { fuente, sockets, soltarSnapshot, pedidos } = montar(100);
    await fuente.iniciar();
    sockets[0].onopen?.({});
    soltarSnapshot();
    await esperar();
    await esperar();
    sockets[0].emitir(diff(99, 103, 98));
    sockets[0].emitir(diff(110, 115, 109)); // pu 109 ≠ 103 → hueco
    const estado = fuente.estadoLibro('BTCUSDT');
    expect(estado?.listo).toBe(false);
    expect(estado?.resincronizaciones).toBe(1);
    expect(pedidos.filter((u) => u.includes('/fapi/v1/depth')).length).toBe(2);
    fuente.detener();
  });

  it('agrupa la vista del libro a ≈ 1,2 puntos básicos', () => {
    expect(grupoParaPrecio(84_700, 0.1)).toBe(10);
    expect(grupoParaPrecio(3_000, 0.01)).toBe(4);
    expect(grupoParaPrecio(150, 0.01)).toBe(1);
  });
});
