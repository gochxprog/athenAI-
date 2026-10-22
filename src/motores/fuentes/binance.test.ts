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

function montar(snapshotId = 100, opciones: { ws?: string; restCaido?: boolean } = {}) {
  const mensajes: { s: string; m: MensajeMercado }[] = [];
  const sockets: SocketFalso[] = [];
  const pedidos: string[] = [];
  let resolverSnapshot: (() => void) | null = null;
  const fetchImpl = vi.fn(async (url: string) => {
    pedidos.push(url);
    if (opciones.restCaido) throw new TypeError('Failed to fetch');
    const json = (x: unknown) => ({ ok: true, status: 200, json: async () => x }) as Response;
    if (url.includes('exchangeInfo')) return json({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] });
    if (url.includes('ticker/24hr')) return json({ lastPrice: '84700.0', quoteVolume: '18000000000' });
    if (url.includes('aggTrades')) {
      const desde = Number(new URL(url).searchParams.get('fromId'));
      return json(Array.from({ length: 1000 }, (_, i) => ({ a: desde + i, p: '84700.0', q: '0.100', T: 2000 + desde + i, m: i % 2 === 0 })));
    }
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
    ws: opciones.ws,
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
    // Desde abr-2026: libro por /public y trades + liquidaciones por /market.
    expect(sockets.map((x) => x.url)).toEqual([
      'wss://fstream.binance.com/public/stream?streams=btcusdt@depth@100ms',
      'wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@forceOrder/btcusdt@markPrice@1s',
    ]);
    expect(mensajes.some((x) => x.s === 'NOEXISTE' && x.m.tipo === 'conexion' && x.m.estado === 'error')).toBe(true);
    fuente.detener();
  });

  it('convierte aggTrades y los entrega en lotes ordenados', async () => {
    const { fuente, sockets, mensajes } = montar();
    await fuente.iniciar();
    const so = sockets[1];
    sockets[0].emitir(diff(1, 2, 0));
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

  it('trades perdidos en una reconexión: los pide por REST y los publica en orden antes de seguir (sin hueco)', async () => {
    const { fuente, sockets, mensajes, pedidos } = montar();
    await fuente.iniciar();
    const trade = (a: number) => sockets[1].emitir({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', s: 'BTCUSDT', a, p: '84700.0', q: '0.100', T: 2000 + a, m: false } });
    trade(10);
    vi.advanceTimersByTime(100);
    trade(25);
    vi.advanceTimersByTime(100);
    for (let i = 0; i < 5; i++) await esperar();
    vi.advanceTimersByTime(100);
    expect(pedidos.some((u) => u.includes('aggTrades?symbol=BTCUSDT&fromId=11'))).toBe(true);
    const ids = mensajes.flatMap((x) => (x.m.tipo === 'trades' ? x.m.trades.map((t) => t.aggTradeId) : []));
    expect(ids).toEqual(Array.from({ length: 16 }, (_, i) => 10 + i));
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

  it('regla de Futures: si el primer diff empieza en lastUpdateId + 1 (U = 101 > 100) se resincroniza', async () => {
    const { fuente, sockets, soltarSnapshot } = montar(100);
    await fuente.iniciar();
    sockets[0].onopen?.({});
    soltarSnapshot();
    await esperar();
    await esperar();
    sockets[0].emitir(diff(101, 105, 100));
    expect(fuente.estadoLibro('BTCUSDT')?.resincronizaciones).toBe(1);
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

  it('lee el funding (markPrice) y solo lo reenvía cuando cambia', async () => {
    const { fuente, sockets, mensajes } = montar();
    await fuente.iniciar();
    const mp = (r: string, E: number) => sockets[1].emitir({ stream: 'btcusdt@markPrice@1s', data: { e: 'markPriceUpdate', E, s: 'BTCUSDT', p: '84700', r, T: 28_800_000 } });
    mp('0.00010000', 1_000);
    mp('0.00010000', 2_000);
    mp('0.00012000', 3_000);
    const f = mensajes.filter((x) => x.m.tipo === 'funding').map((x) => x.m);
    expect(f).toEqual([
      { tipo: 'funding', tasa: 0.0001, t: 1_000 },
      { tipo: 'funding', tasa: 0.00012, t: 3_000 },
    ]);
    fuente.detener();
  });

  it('convierte liquidaciones (forceOrder) del canal /market', async () => {
    const { fuente, sockets, mensajes } = montar();
    await fuente.iniciar();
    sockets[1].emitir({ stream: 'btcusdt@forceOrder', data: { e: 'forceOrder', E: 5, o: { s: 'BTCUSDT', S: 'SELL', q: '0.5', p: '84000', ap: '84010', z: '0.5', T: 4 } } });
    expect(mensajes.find((x) => x.m.tipo === 'liquidacion')?.m).toEqual({ tipo: 'liquidacion', liq: { simbolo: 'BTCUSDT', t: 4, precio: 84010, cantidad: 0.5, lado: 'venta' } });
    fuente.detener();
  });
});

describe('FuenteBinance · rutas /public y /market', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('con el servidor oficial nunca salta a la ruta antigua: reintenta /market', async () => {
    const { fuente, sockets, mensajes } = montar();
    await fuente.iniciar();
    sockets[0].emitir(diff(1, 2, 0));
    vi.advanceTimersByTime(16_000);
    expect(mensajes.some((x) => x.m.tipo === 'conexion' && x.m.estado === 'sin-datos' && /no los trades/.test(x.m.detalle ?? ''))).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets.some((x) => x.url.includes('/stream?') && !x.url.includes('/market/') && !x.url.includes('/public/'))).toBe(false);
    expect(fuente.rutas()).toEqual({ libro: '/public/stream', trades: '/market/stream' });
    [...sockets].reverse().find((x) => x.url.includes('/public/'))!.emitir(diff(3, 4, 2));
    const ultimo = [...sockets].reverse().find((x) => x.url.includes('/market/'))!;
    ultimo.emitir({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', s: 'BTCUSDT', a: 1, p: '84700', q: '0.1', T: 1, m: false } });
    expect(mensajes[mensajes.length - 1].m).toMatchObject({ tipo: 'conexion', estado: 'en-vivo' });
    fuente.detener();
  });

  it('un servidor propio sin rutas nuevas prueba una sola vez la ruta antigua', async () => {
    const { fuente, sockets } = montar(100, { ws: 'ws://localhost:9999' });
    await fuente.iniciar();
    sockets[0].emitir(diff(1, 2, 0));
    vi.advanceTimersByTime(20_001);
    expect(fuente.rutas().trades).toBe('/stream');
    vi.advanceTimersByTime(120_000);
    expect(fuente.rutas().trades).toBe('/stream');
    fuente.detener();
  });

  it('si el REST no responde abre igual los WebSockets', async () => {
    const { fuente, sockets, mensajes } = montar(100, { restCaido: true });
    await fuente.iniciar();
    expect(sockets.map((x) => x.url)).toEqual([
      'wss://fstream.binance.com/public/stream?streams=btcusdt@depth@100ms/noexiste@depth@100ms',
      'wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@forceOrder/btcusdt@markPrice@1s/noexiste@aggTrade/noexiste@forceOrder/noexiste@markPrice@1s',
    ]);
    sockets[0].onopen?.({});
    sockets[0].emitir(diff(1, 2, 0));
    sockets[1].emitir({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', s: 'BTCUSDT', a: 1, p: '84700', q: '0.1', T: 1, m: false } });
    await Promise.resolve();
    expect(mensajes.some((x) => x.m.tipo === 'conexion' && x.m.estado === 'error')).toBe(false);
    expect(mensajes.filter((x) => x.m.tipo === 'conexion').pop()?.m).toMatchObject({ estado: 'en-vivo' });
    fuente.detener();
  });
});

describe('FuenteBinance: el libro se recupera solo (sin tocar nada)', () => {
  const json = (x: unknown) => ({ ok: true, status: 200, json: async () => x }) as Response;
  const libroDe = (id: number) => ({ lastUpdateId: id, T: 1, bids: [['99', '1']], asks: [['101', '1']] });
  function fuenteCon(depth: () => Promise<Response>) {
    const sockets: SocketFalso[] = [];
    const pedidos: string[] = [];
    const fetchImpl = (async (url: string) => {
      pedidos.push(url);
      if (url.includes('exchangeInfo')) return json({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] });
      if (url.includes('depth')) return depth();
      return json({});
    }) as unknown as typeof fetch;
    const fuente = new FuenteBinance({ simbolos: ['BTCUSDT'], onMensaje: () => undefined, crearSocket: (u) => (sockets.push(new SocketFalso(u)), sockets.at(-1)!), fetchImpl });
    return { fuente, sockets, snapshots: () => pedidos.filter((u) => u.includes('depth')).length };
  }
  afterEach(() => vi.useRealTimers());

  it('un snapshot más viejo que los diffs se repide con espera creciente (no cada 500 ms: el límite de Binance)', async () => {
    vi.useFakeTimers();
    const { fuente, sockets, snapshots } = fuenteCon(async () => json(libroDe(100)));
    await fuente.iniciar();
    sockets[0].emitir(diff(150, 160, 149));
    sockets[0].onopen?.({});
    await vi.advanceTimersByTimeAsync(10_000);
    // Antes: ~20 pedidos en 10 s (peso 400). Ahora la espera crece 0,5 → 1 → 2 → 4 → 8 s.
    expect(snapshots()).toBeLessThanOrEqual(6);
    fuente.detener();
  });

  it('un snapshot viejo que llega tarde no pisa el libro que ya está vivo', async () => {
    const respuestas: ((r: Response) => void)[] = [];
    const { fuente, sockets } = fuenteCon(() => new Promise((ok) => respuestas.push(ok)));
    await fuente.iniciar();
    const so = sockets[0];
    so.onopen?.({});
    so.emitir(diff(150, 160, 149));
    respuestas[0](json(libroDe(155)));
    await esperar();
    expect(fuente.estadoLibro('BTCUSDT')).toMatchObject({ listo: true, ultimoU: 160 });
    so.emitir(diff(161, 170, 160));
    // Un pedido viejo (de antes de una reconexión) llega ahora con un lastUpdateId atrasado: se descarta.
    (fuente as unknown as { libros: Map<string, { pidiendoSnapshot: boolean }> }).libros.get('BTCUSDT')!.pidiendoSnapshot = false;
    void (fuente as unknown as { pedirSnapshot: (s: string) => Promise<void> }).pedirSnapshot('BTCUSDT');
    respuestas[1]?.(json(libroDe(150)));
    await esperar();
    expect(fuente.estadoLibro('BTCUSDT')).toMatchObject({ listo: true, ultimoU: 170, resincronizaciones: 0 });
    fuente.detener();
  });
});
