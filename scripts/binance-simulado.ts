// Servidor local que imita Binance USD-M Futures (REST + WebSocket con el formato real) usando el generador
// sintético. Sirve para probar la fuente Binance de punta a punta sin salir a internet:
//   npm run binance-simulado   → http://localhost:8899 · ws://localhost:8899
// En el Centro de datos: Binance Futures → Endpoints (avanzado) → REST http://localhost:8899, WS ws://localhost:8899.
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { GeneradorDemo } from '../src/motores/fuentes/demo';

const PUERTO = Number(process.argv[2] ?? 8899);

interface Mercado {
  simbolo: string;
  tick: number;
  escala: number;
  gen: GeneradorDemo;
  bids: Map<number, number>;
  asks: Map<number, number>;
  u: number;
  aggId: number;
  ultimo: number;
  oi: number;
}

const redondear = (x: number, tick: number) => Number((Math.round(x / tick) * tick).toFixed(8));

const mercados = new Map<string, Mercado>(
  [
    ['BTCUSDT', 0.1, 1],
    ['ETHUSDT', 0.01, 3_000 / 84_712],
  ].map(([s, tick, escala], i) => [s as string, { simbolo: s as string, tick: tick as number, escala: escala as number, gen: new GeneradorDemo(100 + i, Date.now()), bids: new Map(), asks: new Map(), u: 1_000, aggId: 1, ultimo: 0, oi: 80_000 }]),
);

// Igual que Binance desde abr-2026: /public = libro; /market = trades y liquidaciones; /stream (ruta antigua) solo /public.
type Ruta = 'public' | 'market' | 'legado';
const clientes = new Map<WebSocket, { ruta: Ruta; streams: Set<string> }>();
const esPublico = (stream: string) => stream.includes('@depth');

function enviar(stream: string, data: unknown) {
  const txt = JSON.stringify({ stream, data });
  for (const [ws, c] of clientes) {
    if (!c.streams.has(stream) || ws.readyState !== ws.OPEN) continue;
    const permitido = c.ruta === 'market' ? !esPublico(stream) : esPublico(stream);
    if (permitido) ws.send(txt);
  }
}

function paso(m: Mercado, ms: number) {
  for (const msg of m.gen.avanzar(ms)) {
    if (msg.tipo === 'trades') {
      for (const t of msg.trades) {
        const p = redondear(t.price * m.escala, m.tick);
        m.ultimo = p;
        enviar(`${m.simbolo.toLowerCase()}@aggTrade`, { e: 'aggTrade', E: t.timestamp, s: m.simbolo, a: m.aggId++, p: String(p), q: (t.quantity / m.escala).toFixed(3), T: t.timestamp, m: t.buyerIsMaker });
        // Liquidaciones ocasionales en el sentido del trade agresor.
        if (Math.random() < 0.002) {
          const lado = t.buyerIsMaker ? 'SELL' : 'BUY';
          const q = ((0.2 + Math.random() * 3) / m.escala).toFixed(3);
          enviar(`${m.simbolo.toLowerCase()}@forceOrder`, { e: 'forceOrder', E: t.timestamp, o: { s: m.simbolo, S: lado, o: 'LIMIT', f: 'IOC', q, p: String(p), ap: String(p), X: 'FILLED', l: q, z: q, T: t.timestamp } });
        }
      }
    } else if (msg.tipo === 'libro') {
      // Diff entre el libro anterior y el nuevo (formato depthUpdate con U/u/pu).
      const nb = new Map(msg.vista.bids.map((l) => [redondear(l[0] * m.escala, m.tick), l[1] / m.escala]));
      const na = new Map(msg.vista.asks.map((l) => [redondear(l[0] * m.escala, m.tick), l[1] / m.escala]));
      const diff = (viejo: Map<number, number>, nuevo: Map<number, number>) => {
        const out: [string, string][] = [];
        for (const [p, q] of nuevo) if (viejo.get(p) !== q) out.push([String(p), q.toFixed(3)]);
        for (const p of viejo.keys()) if (!nuevo.has(p)) out.push([String(p), '0']);
        return out;
      };
      const b = diff(m.bids, nb);
      const a = diff(m.asks, na);
      m.bids = nb;
      m.asks = na;
      const pu = m.u;
      const U = m.u + 1;
      m.u += 1 + Math.floor(Math.random() * 3);
      enviar(`${m.simbolo.toLowerCase()}@depth@100ms`, { e: 'depthUpdate', E: msg.vista.updatedAt, T: msg.vista.updatedAt, s: m.simbolo, U, u: m.u, pu, b, a });
    }
  }
}

let antes = Date.now();
setInterval(() => {
  const ahora = Date.now();
  for (const m of mercados.values()) paso(m, ahora - antes);
  antes = ahora;
}, 100);

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PUERTO}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json');
  const s = url.searchParams.get('symbol') ?? '';
  const m = mercados.get(s);
  const json = (x: unknown, codigo = 200) => {
    res.statusCode = codigo;
    res.end(JSON.stringify(x));
  };
  switch (url.pathname) {
    case '/fapi/v1/exchangeInfo':
      return json({ symbols: [...mercados.values()].map((x) => ({ symbol: x.simbolo, status: 'TRADING', filters: [{ filterType: 'PRICE_FILTER', tickSize: String(x.tick) }] })) });
    case '/fapi/v1/ticker/24hr':
      // Volumen bajo a propósito: dollar bars pequeñas para que la prueba genere filas rápido.
      return m ? json({ symbol: s, lastPrice: String(m.ultimo || 84_712 * m.escala), quoteVolume: '400000000' }) : json({ code: -1121, msg: 'Invalid symbol.' }, 400);
    case '/fapi/v1/depth':
      if (!m) return json({ code: -1121, msg: 'Invalid symbol.' }, 400);
      return json({
        lastUpdateId: m.u,
        E: Date.now(),
        T: Date.now(),
        bids: [...m.bids].sort((a, b) => b[0] - a[0]).map(([p, q]) => [String(p), q.toFixed(3)]),
        asks: [...m.asks].sort((a, b) => a[0] - b[0]).map(([p, q]) => [String(p), q.toFixed(3)]),
      });
    case '/fapi/v1/openInterest':
      if (!m) return json({ code: -1121, msg: 'Invalid symbol.' }, 400);
      m.oi += (Math.random() - 0.5) * 40;
      return json({ symbol: s, openInterest: m.oi.toFixed(3), time: Date.now() });
    default:
      return json({ code: -1, msg: 'not found' }, 404);
  }
});

const wss = new WebSocketServer({ noServer: true });
servidor.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '', 'http://x');
  const ruta: Ruta | null = url.pathname === '/public/stream' ? 'public' : url.pathname === '/market/stream' ? 'market' : url.pathname === '/stream' ? 'legado' : null;
  if (!ruta) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    clientes.set(ws, { ruta, streams: new Set((url.searchParams.get('streams') ?? '').split('/').filter(Boolean)) });
    ws.on('close', () => clientes.delete(ws));
  });
});

servidor.listen(PUERTO, () => console.log(`Binance simulado en http://localhost:${PUERTO} (BTCUSDT, ETHUSDT)`));
