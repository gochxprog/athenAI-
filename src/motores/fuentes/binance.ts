// Fuente Binance USD-M Futures directa (datos públicos de mercado: no requiere API key).
//
//   REST  {rest}/fapi/v1/exchangeInfo           → tickSize de cada símbolo
//   REST  {rest}/fapi/v1/ticker/24hr?symbol=S   → volumen 24 h (calibra el tamaño de las dollar bars)
//   REST  {rest}/fapi/v1/depth?symbol=S&limit=1000 → snapshot del libro
//   REST  {rest}/fapi/v1/openInterest?symbol=S  → Open Interest (cada 5 s)
//   WS    {ws}/stream?streams=s@aggTrade/s@depth@100ms/…
//
// Libro sincronizado con el procedimiento oficial de Binance Futures: se guardan los diffs mientras llega el
// snapshot, se descartan los que tienen u < lastUpdateId, el primero debe cumplir U ≤ lastUpdateId ≤ u y cada
// diff siguiente debe encadenar (pu === u anterior). Si se rompe la cadena se resincroniza.
import { OrderBookEngine } from '../urus/order-flow/order-book';
import { Backoff } from '../urus/realtime/backoff';
import type { AggTrade, MensajeMercado } from '../nucleo/tipos';

export const BINANCE_REST = 'https://fapi.binance.com';
export const BINANCE_WS = 'wss://fstream.binance.com';

export interface InfoSimbolo {
  simbolo: string;
  tickSize: number;
  precio: number;
  volumen24hUsd: number;
}

export interface SocketMinimo {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

export interface OpcionesBinance {
  simbolos: string[];
  rest?: string;
  ws?: string;
  onMensaje: (simbolo: string, m: MensajeMercado) => void;
  onInfo: (info: InfoSimbolo) => void;
  /** Inyectables (pruebas). */
  crearSocket?: (url: string) => SocketMinimo;
  fetchImpl?: typeof fetch;
  /** Cada cuánto se publica la vista del libro (ms). */
  cadaVistaMs?: number;
}

interface DiffBinance {
  e: 'depthUpdate';
  E: number;
  T: number;
  s: string;
  U: number;
  u: number;
  pu: number;
  b: [string, string][];
  a: [string, string][];
}

interface AggTradeBinance {
  e: 'aggTrade';
  s: string;
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

/** Estado de sincronización del libro de un símbolo. */
interface EstadoLibro {
  motor: OrderBookEngine;
  grupo: number;
  listo: boolean;
  pendientes: DiffBinance[];
  ultimoU: number | null;
  /** lastUpdateId del snapshot mientras aún no se aplicó ningún diff (el primero se valida con U ≤ id ≤ u). */
  snapshotId: number | null;
  pidiendoSnapshot: boolean;
  resincronizaciones: number;
}

/** Agrupación de la vista del libro: ≈ 1,2 puntos básicos por nivel (BTC a 85.000 → 1 USD). */
export function grupoParaPrecio(precio: number, tick: number): number {
  if (!(precio > 0) || !(tick > 0)) return 1;
  return Math.max(1, Math.round((precio * 0.0000118) / tick));
}

export function convertirAggTrade(d: AggTradeBinance): AggTrade | null {
  const price = Number(d.p);
  const quantity = Number(d.q);
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || !Number.isFinite(d.T) || !Number.isFinite(d.a)) return null;
  return { symbol: d.s, price, quantity, timestamp: d.T, aggTradeId: d.a, buyerIsMaker: d.m === true };
}

const aTuplas = (xs: [string, string][]): [number, number][] => xs.map(([p, q]) => [Number(p), Number(q)]);

export class FuenteBinance {
  private socket: SocketMinimo | null = null;
  private detenida = false;
  private libros = new Map<string, EstadoLibro>();
  private lotes = new Map<string, AggTrade[]>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private reintento: ReturnType<typeof setTimeout> | null = null;
  private ultimoMensaje = 0;
  private readonly backoff = new Backoff({ baseMs: 1_000, maxMs: 30_000, jitter: 'equal', floorMs: 500 });
  private readonly rest: string;
  private readonly ws: string;
  private readonly fetchImpl: typeof fetch;
  readonly simbolos: string[];

  constructor(private readonly o: OpcionesBinance) {
    this.rest = (o.rest ?? BINANCE_REST).replace(/\/+$/, '');
    this.ws = (o.ws ?? BINANCE_WS).replace(/\/+$/, '');
    this.fetchImpl = o.fetchImpl ?? ((...a) => fetch(...a));
    this.simbolos = [...new Set(o.simbolos.map((s) => s.toUpperCase()))];
  }

  /** Diagnóstico de la sincronización del libro (para el Centro de datos y las pruebas). */
  estadoLibro(simbolo: string): { listo: boolean; resincronizaciones: number; ultimoU: number | null } | null {
    const l = this.libros.get(simbolo);
    return l ? { listo: l.listo, resincronizaciones: l.resincronizaciones, ultimoU: l.ultimoU } : null;
  }

  async iniciar(): Promise<void> {
    this.detenida = false;
    for (const s of this.simbolos) this.o.onMensaje(s, { tipo: 'conexion', estado: 'conectando', detalle: 'Binance USD-M Futures' });
    try {
      await this.cargarInfo();
    } catch (e) {
      for (const s of this.simbolos) this.o.onMensaje(s, { tipo: 'conexion', estado: 'error', detalle: `No se pudo leer exchangeInfo: ${e instanceof Error ? e.message : e}` });
      this.programarReintento();
      return;
    }
    this.abrirSocket();
    const cadaVista = this.o.cadaVistaMs ?? 250;
    this.timers.push(setInterval(() => this.vaciarLotes(), 100));
    this.timers.push(setInterval(() => this.publicarLibros(), cadaVista));
    this.timers.push(setInterval(() => void this.leerOi(), 5_000));
    this.timers.push(
      setInterval(() => {
        if (this.ultimoMensaje && Date.now() - this.ultimoMensaje > 20_000) this.reconectar('Sin mensajes desde hace 20 s');
      }, 5_000),
    );
    void this.leerOi();
  }

  detener(): void {
    this.detenida = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.reintento) clearTimeout(this.reintento);
    this.reintento = null;
    this.socket?.close();
    this.socket = null;
    for (const s of this.simbolos) this.o.onMensaje(s, { tipo: 'conexion', estado: 'detenido' });
  }

  // ---------------------------------------------------------------------------

  private async json<T>(ruta: string): Promise<T> {
    const r = await this.fetchImpl(`${this.rest}${ruta}`);
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${ruta.split('?')[0]}`);
    return (await r.json()) as T;
  }

  private async cargarInfo(): Promise<void> {
    const info = await this.json<{ symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] }>('/fapi/v1/exchangeInfo');
    for (const s of this.simbolos) {
      const def = info.symbols.find((x) => x.symbol === s);
      if (!def) {
        this.o.onMensaje(s, { tipo: 'conexion', estado: 'error', detalle: `${s} no existe en Binance Futures` });
        continue;
      }
      const tick = Number(def.filters.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize ?? 0.1);
      let precio = 0;
      let volumen = 0;
      try {
        const t = await this.json<{ lastPrice: string; quoteVolume: string }>(`/fapi/v1/ticker/24hr?symbol=${s}`);
        precio = Number(t.lastPrice);
        volumen = Number(t.quoteVolume);
      } catch {
        // Sin ticker se usan valores por defecto del pipeline.
      }
      this.libros.set(s, {
        motor: new OrderBookEngine({ symbol: s, tickSize: tick, maxLevelsPerSide: 3_000 }),
        grupo: grupoParaPrecio(precio, tick),
        listo: false,
        pendientes: [],
        ultimoU: null,
        snapshotId: null,
        pidiendoSnapshot: false,
        resincronizaciones: 0,
      });
      this.lotes.set(s, []);
      this.o.onInfo({ simbolo: s, tickSize: tick, precio, volumen24hUsd: volumen });
    }
  }

  private abrirSocket(): void {
    if (this.detenida) return;
    const validos = [...this.libros.keys()];
    if (!validos.length) return;
    const streams = validos.flatMap((s) => [`${s.toLowerCase()}@aggTrade`, `${s.toLowerCase()}@depth@100ms`]).join('/');
    const url = `${this.ws}/stream?streams=${streams}`;
    const sock = this.o.crearSocket ? this.o.crearSocket(url) : (new WebSocket(url) as unknown as SocketMinimo);
    this.socket = sock;
    sock.onopen = () => {
      this.backoff.reset();
      for (const s of validos) {
        const l = this.libros.get(s)!;
        l.listo = false;
        l.pendientes = [];
        l.ultimoU = null;
        l.snapshotId = null;
        void this.pedirSnapshot(s);
      }
    };
    sock.onmessage = (ev) => this.alMensaje(ev.data);
    sock.onclose = () => {
      if (this.socket === sock) this.reconectar('Conexión WebSocket cerrada');
    };
    sock.onerror = () => {
      for (const s of validos) this.o.onMensaje(s, { tipo: 'conexion', estado: 'reconectando', detalle: 'Error en el WebSocket' });
    };
  }

  /** Procesa un frame del stream combinado. Público para pruebas. */
  alMensaje(bruto: unknown): void {
    let env: { stream?: string; data?: AggTradeBinance | DiffBinance };
    try {
      env = typeof bruto === 'string' ? JSON.parse(bruto) : (bruto as typeof env);
    } catch {
      return;
    }
    const d = env?.data;
    if (!d || typeof d !== 'object') return;
    // Primer mensaje tras (re)conectar: todos los símbolos pasan a "en vivo".
    if (this.ultimoMensaje === 0) for (const s of this.libros.keys()) this.o.onMensaje(s, { tipo: 'conexion', estado: 'en-vivo', detalle: 'Binance USD-M Futures' });
    this.ultimoMensaje = Date.now();
    if (d.e === 'aggTrade') {
      const t = convertirAggTrade(d);
      if (!t) return;
      const lote = this.lotes.get(t.symbol);
      if (!lote) return;
      lote.push(t);
    } else if (d.e === 'depthUpdate') {
      this.aplicarDiff(d);
    }
  }

  private aplicarDiff(d: DiffBinance): void {
    const l = this.libros.get(d.s);
    if (!l) return;
    if (!l.listo) {
      l.pendientes.push(d);
      if (l.pendientes.length > 2_000) l.pendientes.splice(0, l.pendientes.length - 1_000);
      return;
    }
    if (l.snapshotId !== null) {
      // Primer diff tras un snapshot sin diffs guardados.
      if (d.u < l.snapshotId) return;
      if (d.U > l.snapshotId + 1) {
        this.resincronizar(d.s, 'El primer diff no cubre el snapshot');
        l.pendientes.push(d);
        return;
      }
      l.snapshotId = null;
      l.motor.applyDiff({ bids: aTuplas(d.b), asks: aTuplas(d.a), finalUpdateId: d.u, timestamp: d.T || d.E });
      l.ultimoU = d.u;
      return;
    }
    if (l.ultimoU !== null && d.pu !== l.ultimoU) {
      this.resincronizar(d.s, `Hueco en el libro (pu ${d.pu} ≠ ${l.ultimoU})`);
      l.pendientes.push(d);
      return;
    }
    l.motor.applyDiff({ bids: aTuplas(d.b), asks: aTuplas(d.a), finalUpdateId: d.u, timestamp: d.T || d.E });
    l.ultimoU = d.u;
    if (l.motor.isCrossed()) this.resincronizar(d.s, 'Libro cruzado');
  }

  private resincronizar(s: string, motivo: string): void {
    const l = this.libros.get(s);
    if (!l) return;
    l.listo = false;
    l.ultimoU = null;
    l.snapshotId = null;
    l.resincronizaciones += 1;
    this.o.onMensaje(s, { tipo: 'conexion', estado: 'reconectando', detalle: `Resincronizando libro: ${motivo}` });
    void this.pedirSnapshot(s);
  }

  private async pedirSnapshot(s: string): Promise<void> {
    const l = this.libros.get(s);
    if (!l || l.pidiendoSnapshot || this.detenida) return;
    l.pidiendoSnapshot = true;
    try {
      const snap = await this.json<{ lastUpdateId: number; E?: number; T?: number; bids: [string, string][]; asks: [string, string][] }>(`/fapi/v1/depth?symbol=${s}&limit=1000`);
      l.motor.applySnapshot({ lastUpdateId: snap.lastUpdateId, bids: aTuplas(snap.bids), asks: aTuplas(snap.asks), timestamp: snap.T ?? snap.E ?? Date.now() });
      // Diffs guardados: descartar los viejos; el primero válido debe contener lastUpdateId.
      const validos = l.pendientes.filter((x) => x.u >= snap.lastUpdateId);
      l.pendientes = [];
      if (validos.length && !(validos[0].U <= snap.lastUpdateId && validos[0].u >= snap.lastUpdateId)) {
        l.pidiendoSnapshot = false;
        // El snapshot llegó antes que los diffs que lo cubren: esperar más diffs y reintentar.
        l.pendientes = validos;
        setTimeout(() => void this.pedirSnapshot(s), 500);
        return;
      }
      l.listo = true;
      l.ultimoU = null;
      for (const x of validos) {
        if (l.ultimoU !== null && x.pu !== l.ultimoU) {
          l.pidiendoSnapshot = false;
          this.resincronizar(s, 'Hueco al aplicar los diffs guardados');
          return;
        }
        l.motor.applyDiff({ bids: aTuplas(x.b), asks: aTuplas(x.a), finalUpdateId: x.u, timestamp: x.T || x.E });
        l.ultimoU = x.u;
      }
      if (l.ultimoU === null) l.snapshotId = snap.lastUpdateId;
    } catch (e) {
      this.o.onMensaje(s, { tipo: 'conexion', estado: 'error', detalle: `Snapshot del libro: ${e instanceof Error ? e.message : e}` });
      setTimeout(() => void this.pedirSnapshot(s), 3_000);
    } finally {
      l.pidiendoSnapshot = false;
    }
  }

  private vaciarLotes(): void {
    for (const [s, lote] of this.lotes) {
      if (!lote.length) continue;
      lote.sort((a, b) => a.aggTradeId - b.aggTradeId);
      this.o.onMensaje(s, { tipo: 'trades', trades: lote.splice(0, lote.length) });
    }
  }

  private publicarLibros(): void {
    for (const [s, l] of this.libros) {
      if (!l.listo) continue;
      this.o.onMensaje(s, { tipo: 'libro', vista: l.motor.getView(200, l.grupo) });
    }
  }

  private async leerOi(): Promise<void> {
    for (const s of this.libros.keys()) {
      try {
        const r = await this.json<{ openInterest: string; symbol: string; time: number }>(`/fapi/v1/openInterest?symbol=${s}`);
        const oi = Number(r.openInterest);
        if (Number.isFinite(oi) && oi > 0) this.o.onMensaje(s, { tipo: 'oi', snapshot: { symbol: s, time: r.time, oiContracts: oi, oiValue: null, markPrice: null, source: 'poll' } });
      } catch {
        // El OI es secundario.
      }
    }
  }

  private reconectar(motivo: string): void {
    if (this.detenida) return;
    const viejo = this.socket;
    this.socket = null;
    viejo?.close();
    this.ultimoMensaje = 0;
    for (const s of this.libros.keys()) this.o.onMensaje(s, { tipo: 'conexion', estado: 'reconectando', detalle: motivo });
    this.programarReintento();
  }

  private programarReintento(): void {
    if (this.detenida || this.reintento) return;
    const espera = this.backoff.next();
    this.reintento = setTimeout(() => {
      this.reintento = null;
      if (this.libros.size === 0) void this.iniciarDeNuevo();
      else this.abrirSocket();
    }, espera);
  }

  private async iniciarDeNuevo(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.iniciar();
  }
}
