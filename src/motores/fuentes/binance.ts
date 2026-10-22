// Fuente Binance USD-M Futures directa (datos públicos de mercado: no requiere API key).
//
//   REST  {rest}/fapi/v1/exchangeInfo           → tickSize de cada símbolo
//   REST  {rest}/fapi/v1/ticker/24hr?symbol=S   → volumen 24 h (calibra el tamaño de las dollar bars)
//   REST  {rest}/fapi/v1/depth?symbol=S&limit=1000 → snapshot del libro
//   REST  {rest}/fapi/v1/openInterest?symbol=S  → Open Interest (cada 5 s)
//   WS    {ws}/public/stream?streams=s@depth@100ms/…          → libro (datos de alta frecuencia)
//   WS    {ws}/market/stream?streams=s@aggTrade/s@forceOrder/… → trades y liquidaciones
//
// Desde el 23-abr-2026 Binance separa los WebSockets de futuros en rutas /public, /market y /private.
// La ruta antigua ({ws}/stream) solo entrega los streams de /public: el libro llega pero los trades NO.
// Por eso se abren dos conexiones. Con el servidor oficial NUNCA se usa la ruta antigua (no da trades): si un
// canal no recibe nada se reconecta a la misma ruta con espera creciente. Solo un endpoint propio (p. ej. un
// proxy) sin las rutas nuevas prueba una vez la ruta antigua.
// Si el REST no responde (bloqueo de red, CORS), se abren igual los WebSockets con el tick conocido; el libro
// espera a que el snapshot llegue (se reintenta en segundo plano).
//
// Libro sincronizado con el procedimiento oficial de Binance Futures: se guardan los diffs mientras llega el
// snapshot, se descartan los que tienen u < lastUpdateId, el primero debe cumplir U ≤ lastUpdateId ≤ u y cada
// diff siguiente debe encadenar (pu === u anterior). Si se rompe la cadena se resincroniza.
import { OrderBookEngine } from '../flujo/order-flow/order-book';
import { Backoff } from '../flujo/realtime/backoff';

/** Tope de espera de cada pedido REST (exchangeInfo, snapshot, OI). */
const REST_MS = 10_000;
/** Trades perdidos que se recuperan como mucho tras una reconexión (5 pedidos de 1.000). */
const MAX_RELLENO = 5_000;
import type { AggTrade, Liquidacion, MensajeMercado } from '../nucleo/tipos';
import { grupoParaPrecio, inferirTick } from '../nucleo/parametros';

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

interface LiquidacionBinance {
  e: 'forceOrder';
  E: number;
  o: { s: string; S: 'BUY' | 'SELL'; q: string; p: string; ap: string; z: string; T: number };
}

export function convertirLiquidacion(d: LiquidacionBinance): Liquidacion | null {
  const precio = Number(d.o?.ap) || Number(d.o?.p);
  const cantidad = Number(d.o?.z) || Number(d.o?.q);
  if (!Number.isFinite(precio) || !Number.isFinite(cantidad) || precio <= 0 || cantidad <= 0) return null;
  return { simbolo: d.o.s, t: d.o.T || d.E, precio, cantidad, lado: d.o.S === 'BUY' ? 'compra' : 'venta' };
}

/** Canal de WebSocket: el libro va por /public; trades y liquidaciones por /market. */
export type Canal = 'libro' | 'trades';

interface Conexion {
  sock: SocketMinimo | null;
  /** Ruta antigua ({ws}/stream) en lugar de /public o /market. */
  legado: boolean;
  abiertoEn: number;
  ultimo: number;
  /** Mensajes recibidos por esta conexión. */
  mensajes: number;
  /** Ya se probó la ruta antigua (solo endpoints propios). */
  probadoLegado: boolean;
  reintento: ReturnType<typeof setTimeout> | null;
  backoff: Backoff;
}

interface MarkPriceBinance {
  e: 'markPriceUpdate';
  E: number;
  s: string;
  /** Tasa de funding vigente. */
  r: string;
  /** Próxima hora de cobro. */
  T: number;
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
  /** Reintento pendiente del snapshot (uno por libro: se cancela al pedir otro) y su espera creciente. */
  reintento: ReturnType<typeof setTimeout> | null;
  backoff: Backoff;
  /** Cuándo empezó el último pedido de snapshot (el vigilante repide si el libro lleva mucho sin sincronizar). */
  pedidoEn: number;
  resincronizaciones: number;
}

export { grupoParaPrecio };

export function convertirAggTrade(d: AggTradeBinance): AggTrade | null {
  const price = Number(d.p);
  const quantity = Number(d.q);
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || !Number.isFinite(d.T) || !Number.isFinite(d.a)) return null;
  return { symbol: d.s, price, quantity, timestamp: d.T, aggTradeId: d.a, buyerIsMaker: d.m === true };
}

const aTuplas = (xs: [string, string][]): [number, number][] => xs.map(([p, q]) => [Number(p), Number(q)]);

export class FuenteBinance {
  private detenida = false;
  private libros = new Map<string, EstadoLibro>();
  private lotes = new Map<string, AggTrade[]>();
  /** Último aggTradeId publicado por mercado y los que están recuperando trades perdidos (no publican mientras). */
  private ultimoId = new Map<string, number>();
  private rellenando = new Set<string>();
  private funding = new Map<string, { tasa: number; t: number }>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly backoffInfo = new Backoff({ baseMs: 1_000, maxMs: 30_000, jitter: 'equal', floorMs: 500 });
  private readonly conexiones: Record<Canal, Conexion> = {
    libro: this.nuevaConexion(),
    trades: this.nuevaConexion(),
  };
  /** Último estado anunciado por símbolo (solo se emiten cambios). */
  private anunciado = new Map<string, string>();
  private readonly rest: string;
  private readonly ws: string;
  /** Servidor oficial de Binance: tiene /public y /market; la ruta antigua no sirve. */
  private readonly oficial: boolean;
  /** El REST no respondió: tick estimado y libro pendiente del snapshot. */
  private sinRest = false;
  private readonly fetchImpl: typeof fetch;
  readonly simbolos: string[];

  constructor(private readonly o: OpcionesBinance) {
    this.rest = (o.rest ?? BINANCE_REST).replace(/\/+$/, '');
    this.ws = (o.ws ?? BINANCE_WS).replace(/\/+$/, '');
    this.oficial = /^wss?:\/\/fstream\.binance\.com$/i.test(this.ws);
    this.fetchImpl = o.fetchImpl ?? ((...a) => fetch(...a));
    this.simbolos = [...new Set(o.simbolos.map((s) => s.toUpperCase()))];
  }

  private nuevaConexion(): Conexion {
    return { sock: null, legado: false, probadoLegado: false, abiertoEn: 0, ultimo: 0, mensajes: 0, reintento: null, backoff: new Backoff({ baseMs: 1_000, maxMs: 30_000, jitter: 'equal', floorMs: 500 }) };
  }

  /** Diagnóstico de la sincronización del libro (para el Centro de datos y las pruebas). */
  estadoLibro(simbolo: string): { listo: boolean; resincronizaciones: number; ultimoU: number | null } | null {
    const l = this.libros.get(simbolo);
    return l ? { listo: l.listo, resincronizaciones: l.resincronizaciones, ultimoU: l.ultimoU } : null;
  }

  /** Ruta en uso por canal (diagnóstico). */
  rutas(): Record<Canal, string> {
    const r = (c: Canal) => (this.conexiones[c].legado ? '/stream' : c === 'libro' ? '/public/stream' : '/market/stream');
    return { libro: r('libro'), trades: r('trades') };
  }

  async iniciar(): Promise<void> {
    this.detenida = false;
    for (const s of this.simbolos) this.anunciar(s, 'conectando', 'Binance USD-M Futures');
    try {
      await this.cargarInfo();
      this.sinRest = false;
    } catch {
      // Sin REST se sigue igual: los WebSockets suelen funcionar aunque el REST esté bloqueado.
      this.sinRest = true;
      this.infoEstimada();
    }
    if (this.detenida) return;
    this.abrir('libro');
    this.abrir('trades');
    const cadaVista = this.o.cadaVistaMs ?? 250;
    this.timers.push(setInterval(() => this.vaciarLotes(), 100));
    this.timers.push(setInterval(() => this.publicarLibros(), cadaVista));
    this.timers.push(setInterval(() => void this.leerOi(), 5_000));
    this.timers.push(setInterval(() => this.vigilar(), 5_000));
    void this.leerOi();
  }

  detener(): void {
    this.detenida = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const c of ['libro', 'trades'] as Canal[]) {
      const x = this.conexiones[c];
      if (x.reintento) clearTimeout(x.reintento);
      x.reintento = null;
      const so = x.sock;
      x.sock = null;
      so?.close();
    }
    for (const l of this.libros.values()) if (l.reintento) clearTimeout(l.reintento);
    for (const s of this.simbolos) this.anunciar(s, 'detenido', '');
  }

  // ---------------------------------------------------------------------------

  private anunciar(s: string, estado: 'conectando' | 'en-vivo' | 'reconectando' | 'sin-datos' | 'error' | 'detenido', detalle: string): void {
    const clave = `${estado}|${detalle}`;
    if (this.anunciado.get(s) === clave) return;
    this.anunciado.set(s, clave);
    this.o.onMensaje(s, { tipo: 'conexion', estado, detalle });
  }

  /** Estado combinado de los dos canales para cada símbolo válido. */
  private actualizarEstado(): void {
    const l = this.conexiones.libro;
    const t = this.conexiones.trades;
    for (const s of this.libros.keys()) {
      if (t.mensajes > 0 && l.mensajes > 0) this.anunciar(s, 'en-vivo', `Binance USD-M Futures · libro ${this.rutas().libro} · trades ${this.rutas().trades}${this.sinRest ? ' · REST sin respuesta: tick estimado, libro pendiente' : ''}`);
      else if (l.mensajes > 0 && t.sock && Date.now() - t.abiertoEn > 10_000) this.anunciar(s, 'sin-datos', `Llega el libro pero no los trades (${this.rutas().trades}). Reintentando…`);
      else if (t.mensajes > 0 && l.sock && Date.now() - l.abiertoEn > 10_000) this.anunciar(s, 'sin-datos', `Llegan los trades pero no el libro (${this.rutas().libro}). Reintentando…`);
    }
  }

  private async json<T>(ruta: string): Promise<T> {
    // Con tope de 10 s: un pedido colgado no deja el libro (ni el arranque) esperando para siempre.
    const r = await this.fetchImpl(`${this.rest}${ruta}`, { signal: AbortSignal.timeout(REST_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${ruta.split('?')[0]}`);
    return (await r.json()) as T;
  }

  private async cargarInfo(): Promise<void> {
    const info = await this.json<{ symbols: { symbol: string; status: string; filters: { filterType: string; tickSize?: string }[] }[] }>('/fapi/v1/exchangeInfo');
    for (const s of this.simbolos) {
      const def = info.symbols.find((x) => x.symbol === s);
      if (!def) {
        this.anunciar(s, 'error', `${s} no existe en Binance Futures`);
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
        reintento: null,
        backoff: new Backoff({ baseMs: 500, maxMs: 8_000, jitter: 'equal', floorMs: 500 }),
        pedidoEn: 0,
        resincronizaciones: 0,
      });
      this.lotes.set(s, []);
      this.o.onInfo({ simbolo: s, tickSize: tick, precio, volumen24hUsd: volumen });
    }
  }

  /** Sin exchangeInfo: tick de la tabla conocida; la agrupación del libro se fija con el primer precio. */
  private infoEstimada(): void {
    for (const s of this.simbolos) {
      if (this.libros.has(s)) continue;
      this.libros.set(s, {
        motor: new OrderBookEngine({ symbol: s, tickSize: inferirTick(s, []), maxLevelsPerSide: 3_000 }),
        grupo: 0,
        listo: false,
        pendientes: [],
        ultimoU: null,
        snapshotId: null,
        pidiendoSnapshot: false,
        reintento: null,
        backoff: new Backoff({ baseMs: 500, maxMs: 8_000, jitter: 'equal', floorMs: 500 }),
        pedidoEn: 0,
        resincronizaciones: 0,
      });
      this.lotes.set(s, []);
    }
  }

  private url(canal: Canal): string | null {
    const validos = [...this.libros.keys()].map((s) => s.toLowerCase());
    if (!validos.length) return null;
    const streams = canal === 'libro' ? validos.map((s) => `${s}@depth@100ms`) : validos.flatMap((s) => [`${s}@aggTrade`, `${s}@forceOrder`, `${s}@markPrice@1s`]);
    const x = this.conexiones[canal];
    const ruta = x.legado ? '/stream' : canal === 'libro' ? '/public/stream' : '/market/stream';
    return `${this.ws}${ruta}?streams=${streams.join('/')}`;
  }

  private abrir(canal: Canal): void {
    if (this.detenida) return;
    const url = this.url(canal);
    if (!url) return;
    const x = this.conexiones[canal];
    const sock = this.o.crearSocket ? this.o.crearSocket(url) : (new WebSocket(url) as unknown as SocketMinimo);
    x.sock = sock;
    x.abiertoEn = Date.now();
    x.ultimo = 0;
    x.mensajes = 0;
    sock.onopen = () => {
      x.abiertoEn = Date.now();
      if (canal === 'libro') {
        for (const [s, l] of this.libros) {
          l.listo = false;
          l.pendientes = [];
          l.ultimoU = null;
          l.snapshotId = null;
          void this.pedirSnapshot(s);
        }
      }
    };
    sock.onmessage = (ev) => {
      if (x.sock !== sock) return;
      x.ultimo = Date.now();
      x.mensajes += 1;
      if (x.mensajes === 1) {
        x.backoff.reset();
        this.actualizarEstado();
      }
      this.alMensaje(ev.data);
    };
    sock.onclose = () => {
      if (x.sock === sock) this.reconectar(canal, `Conexión ${canal === 'libro' ? 'del libro' : 'de trades'} cerrada`);
    };
    sock.onerror = () => {
      // onclose llega después y reconecta.
    };
  }

  /** Vigilancia cada 5 s: canales mudos, ruta equivocada, estado combinado. */
  private vigilar(): void {
    const ahora = Date.now();
    for (const c of ['libro', 'trades'] as Canal[]) {
      const x = this.conexiones[c];
      if (!x.sock) continue;
      // Una conexión que no recibió nada en 15 s.
      if (x.mensajes === 0 && ahora - x.abiertoEn > 15_000) {
        if (!this.oficial && !x.probadoLegado) {
          // Endpoint propio sin las rutas nuevas: se prueba una sola vez la ruta antigua.
          x.probadoLegado = true;
          x.legado = true;
          this.reconectar(c, `Sin datos por la ruta nueva; probando ${this.rutas()[c]}`, true);
        } else this.reconectar(c, `Sin datos ${c === 'libro' ? 'del libro' : 'de trades'} por ${this.rutas()[c]}; reintentando`);
        continue;
      }
      // Libro a 100 ms: 20 s sin nada es un corte. Trades: 90 s (activos poco líquidos).
      const limite = c === 'libro' ? 20_000 : 90_000;
      if (x.mensajes > 0 && ahora - x.ultimo > limite) this.reconectar(c, `Sin mensajes ${c === 'libro' ? 'del libro' : 'de trades'} desde hace ${Math.round((ahora - x.ultimo) / 1000)} s`);
    }
    // Un libro que lleva más de 30 s sin sincronizar y sin pedido en curso: se vuelve a pedir el snapshot.
    for (const [s, l] of this.libros) if (!l.listo && !l.pidiendoSnapshot && !l.reintento && this.conexiones.libro.mensajes > 0 && ahora - l.pedidoEn > 30_000) void this.pedirSnapshot(s);
    this.actualizarEstado();
  }

  /** Procesa un frame del stream combinado. Público para pruebas. */
  alMensaje(bruto: unknown): void {
    let env: { stream?: string; data?: AggTradeBinance | DiffBinance | LiquidacionBinance | MarkPriceBinance };
    try {
      env = typeof bruto === 'string' ? JSON.parse(bruto) : (bruto as typeof env);
    } catch {
      return;
    }
    const d = env?.data;
    if (!d || typeof d !== 'object') return;
    if (d.e === 'aggTrade') {
      const t = convertirAggTrade(d);
      if (!t) return;
      this.lotes.get(t.symbol)?.push(t);
    } else if (d.e === 'depthUpdate') {
      this.aplicarDiff(d);
    } else if (d.e === 'markPriceUpdate') {
      // Llega cada segundo; se reenvía solo cuando cambia la tasa (o cada minuto).
      const tasa = Number(d.r);
      const previo = this.funding.get(d.s);
      if (!Number.isFinite(tasa) || !this.libros.has(d.s)) return;
      if (previo && previo.tasa === tasa && d.E - previo.t < 60_000) return;
      this.funding.set(d.s, { tasa, t: d.E });
      this.o.onMensaje(d.s, { tipo: 'funding', tasa, t: d.E });
    } else if (d.e === 'forceOrder') {
      const liq = convertirLiquidacion(d);
      if (liq && this.libros.has(liq.simbolo)) this.o.onMensaje(liq.simbolo, { tipo: 'liquidacion', liq });
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
      // Regla de Binance Futures: el primer diff debe cumplir U ≤ lastUpdateId ≤ u (sin el «+1» del spot).
      if (d.U > l.snapshotId) {
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
    this.anunciar(s, 'reconectando', `Resincronizando libro: ${motivo}`);
    void this.pedirSnapshot(s);
  }

  /** Programa el próximo intento del snapshot de un libro (uno solo a la vez por libro). */
  private reintentarSnapshot(s: string, l: EstadoLibro): void {
    if (this.detenida) return;
    if (l.reintento) clearTimeout(l.reintento);
    l.reintento = setTimeout(() => {
      l.reintento = null;
      void this.pedirSnapshot(s);
    }, l.backoff.next());
  }

  private async pedirSnapshot(s: string): Promise<void> {
    const l = this.libros.get(s);
    if (!l || l.pidiendoSnapshot || this.detenida) return;
    if (l.reintento) clearTimeout(l.reintento);
    l.reintento = null;
    l.pidiendoSnapshot = true;
    l.pedidoEn = Date.now();
    let snap: { lastUpdateId: number; E?: number; T?: number; bids: [string, string][]; asks: [string, string][] };
    try {
      snap = await this.json(`/fapi/v1/depth?symbol=${s}&limit=1000`);
    } catch {
      // El libro queda pendiente pero los trades siguen: no es una caída. Se reintenta con espera creciente.
      l.pidiendoSnapshot = false;
      this.sinRest = true;
      this.reintentarSnapshot(s, l);
      return;
    }
    l.pidiendoSnapshot = false;
    // Otro pedido (reconexión o resincronización) ya dejó el libro vivo: este snapshot viejo no lo pisa.
    if (this.detenida || l.listo) return;
    l.motor.applySnapshot({ lastUpdateId: snap.lastUpdateId, bids: aTuplas(snap.bids), asks: aTuplas(snap.asks), timestamp: snap.T ?? snap.E ?? Date.now() });
    // Diffs guardados: descartar los viejos; el primero válido debe contener lastUpdateId.
    const validos = l.pendientes.filter((x) => x.u >= snap.lastUpdateId);
    l.pendientes = validos;
    if (validos.length && !(validos[0].U <= snap.lastUpdateId && validos[0].u >= snap.lastUpdateId)) {
      // El snapshot llegó antes que los diffs que lo cubren: esperar más diffs y reintentar (con espera creciente:
      // cada snapshot pesa 20 en el límite de Binance).
      this.reintentarSnapshot(s, l);
      return;
    }
    l.pendientes = [];
    l.listo = true;
    l.ultimoU = null;
    l.backoff.reset();
    this.sinRest = false;
    this.backoffInfo.reset();
    for (const x of validos) {
      if (l.ultimoU !== null && x.pu !== l.ultimoU) return this.resincronizar(s, 'Hueco al aplicar los diffs guardados');
      l.motor.applyDiff({ bids: aTuplas(x.b), asks: aTuplas(x.a), finalUpdateId: x.u, timestamp: x.T || x.E });
      l.ultimoU = x.u;
    }
    if (l.ultimoU === null) l.snapshotId = snap.lastUpdateId;
    this.anunciado.delete(s);
    this.actualizarEstado();
  }

  private vaciarLotes(): void {
    for (const [s, lote] of this.lotes) {
      if (!lote.length || this.rellenando.has(s)) continue;
      lote.sort((a, b) => a.aggTradeId - b.aggTradeId);
      // Faltan trades (reconexión: Binance corta cada 24 h): se piden por REST antes de seguir, así el CVD, el
      // delta y las barras no quedan con un hueco. Los ids de Binance son consecutivos.
      const ultimo = this.ultimoId.get(s);
      if (ultimo !== undefined && lote[0].aggTradeId > ultimo + 1 && !this.sinRest) {
        void this.rellenar(s, ultimo + 1, lote[0].aggTradeId - 1);
        continue;
      }
      this.publicarTrades(s, lote.splice(0, lote.length));
    }
  }

  private publicarTrades(s: string, trades: AggTrade[]): void {
    const l = this.libros.get(s);
    if (l && l.grupo === 0) l.grupo = grupoParaPrecio(trades[trades.length - 1].price, inferirTick(s, trades.map((t) => t.price)));
    this.ultimoId.set(s, Math.max(this.ultimoId.get(s) ?? -1, trades[trades.length - 1].aggTradeId));
    this.o.onMensaje(s, { tipo: 'trades', trades });
  }

  /** Recupera los trades [desde, hasta] (hasta 5.000; más que eso, o si falla, el hueco queda marcado como antes). */
  private async rellenar(s: string, desde: number, hasta: number): Promise<void> {
    this.rellenando.add(s);
    const faltan: AggTrade[] = [];
    try {
      for (let id = desde, vueltas = 0; id <= hasta && vueltas < MAX_RELLENO / 1_000; vueltas += 1) {
        const xs = await this.json<Omit<AggTradeBinance, 'e' | 's'>[]>(`/fapi/v1/aggTrades?symbol=${s}&fromId=${id}&limit=1000`);
        const ts = xs.map((x) => convertirAggTrade({ ...x, e: 'aggTrade', s })).filter((t): t is AggTrade => !!t && t.aggTradeId <= hasta);
        if (!ts.length) break;
        faltan.push(...ts);
        id = ts[ts.length - 1].aggTradeId + 1;
      }
    } catch {
      // sin REST: sigue con el hueco marcado
    } finally {
      this.rellenando.delete(s);
      const lote = this.lotes.get(s) ?? [];
      const todos = [...faltan, ...lote.splice(0, lote.length)].sort((a, b) => a.aggTradeId - b.aggTradeId);
      if (!this.detenida && todos.length) this.publicarTrades(s, todos.filter((t, i) => i === 0 || t.aggTradeId !== todos[i - 1].aggTradeId));
    }
  }

  private publicarLibros(): void {
    for (const [s, l] of this.libros) {
      if (!l.listo) continue;
      this.o.onMensaje(s, { tipo: 'libro', vista: l.motor.getView(200, Math.max(1, l.grupo)) });
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

  private reconectar(canal: Canal, motivo: string, inmediato = false): void {
    if (this.detenida) return;
    const x = this.conexiones[canal];
    const viejo = x.sock;
    x.sock = null;
    viejo?.close();
    x.mensajes = 0;
    for (const s of this.libros.keys()) this.anunciar(s, 'reconectando', motivo);
    if (x.reintento) return;
    x.reintento = setTimeout(
      () => {
        x.reintento = null;
        this.abrir(canal);
      },
      inmediato ? 0 : x.backoff.next(),
    );
  }
}

export interface ResultadoPrueba {
  paso: string;
  ok: boolean;
  detalle: string;
}

/**
 * Diagnóstico de la conexión a Binance desde ESTE navegador: REST, libro por /public y trades por /market
 * (y la ruta antigua como referencia). Escucha unos segundos y cuenta mensajes.
 */
export async function diagnosticarBinance(o: { rest?: string; ws?: string; simbolo: string; segundos?: number; crearSocket?: (url: string) => SocketMinimo; fetchImpl?: typeof fetch }): Promise<ResultadoPrueba[]> {
  const rest = (o.rest || BINANCE_REST).replace(/\/+$/, '');
  const ws = (o.ws || BINANCE_WS).replace(/\/+$/, '');
  const s = o.simbolo.toLowerCase();
  const fetchImpl = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const out: ResultadoPrueba[] = [];

  const t0 = Date.now();
  try {
    const r = await fetchImpl(`${rest}/fapi/v1/ticker/24hr?symbol=${o.simbolo.toUpperCase()}`);
    const j = (await r.json().catch(() => ({}))) as { lastPrice?: string; msg?: string };
    out.push(r.ok ? { paso: 'REST (precio 24 h)', ok: true, detalle: `${Date.now() - t0} ms · último precio ${j.lastPrice}` } : { paso: 'REST (precio 24 h)', ok: false, detalle: `HTTP ${r.status} ${j.msg ?? ''}`.trim() });
  } catch (e) {
    out.push({ paso: 'REST (precio 24 h)', ok: false, detalle: `Sin respuesta (${e instanceof Error ? e.message : e}). Puede ser bloqueo de red, VPN o CORS.` });
  }

  const escuchar = (nombre: string, url: string, tipo: string) =>
    new Promise<ResultadoPrueba>((ok) => {
      let n = 0;
      let abierto = false;
      let sock: SocketMinimo;
      try {
        sock = o.crearSocket ? o.crearSocket(url) : (new WebSocket(url) as unknown as SocketMinimo);
      } catch (e) {
        ok({ paso: nombre, ok: false, detalle: `No se pudo abrir: ${e instanceof Error ? e.message : e}` });
        return;
      }
      sock.onopen = () => (abierto = true);
      sock.onmessage = (ev) => {
        if (typeof ev.data === 'string' && ev.data.includes(`"e":"${tipo}"`)) n += 1;
      };
      sock.onerror = () => undefined;
      sock.onclose = () => undefined;
      setTimeout(() => {
        sock.close();
        ok({ paso: nombre, ok: n > 0, detalle: n > 0 ? `${n} mensajes en ${o.segundos ?? 6} s` : abierto ? 'Conectó pero no llegó ningún dato' : 'No conectó' });
      }, (o.segundos ?? 6) * 1000);
    });

  out.push(
    ...(await Promise.all([
      escuchar('Libro · /public', `${ws}/public/stream?streams=${s}@depth@100ms`, 'depthUpdate'),
      escuchar('Trades · /market', `${ws}/market/stream?streams=${s}@aggTrade`, 'aggTrade'),
      escuchar('Trades · ruta antigua /stream (referencia)', `${ws}/stream?streams=${s}@aggTrade`, 'aggTrade'),
    ])),
  );
  return out;
}
