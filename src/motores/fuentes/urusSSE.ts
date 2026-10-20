// Fuente EN VIVO: servidor de Urus (protocolo de shared/realtime/protocol.ts).
//
//   GET  {base}/api/realtime/stream          → SSE: `hello` (sessionId), `m` (Envelope {t,e,d}), `bye`
//   POST {base}/api/realtime/subscriptions   → { sessionId, rev, topics } (conjunto COMPLETO, idempotente)
//   GET  {base}/api/oi?symbol=…&from=…       → snapshots de Open Interest
//
// Topics usados: trades:SYM (aggTrades reales) y book:SYM:DEPTH:GROUP (vista del libro ya calculada por el
// OrderBookEngine del servidor, la misma estructura que usa athenAI). El servidor de Urus debe permitir CORS
// para el origen de athenAI si se sirven desde dominios distintos.
import { Backoff } from '../urus/realtime/backoff';
import { bookTopic, tradesTopic, type Envelope, type HelloPayload } from '../urus/realtime/protocol';
import type { AggTrade, MensajeMercado, OpenInterestSnapshot, OrderBookView } from '../nucleo/tipos';

export interface OpcionesFuenteUrus {
  baseUrl: string;
  simbolo: string;
  profundidad?: number;
  grupo?: number;
  onMensaje: (m: MensajeMercado) => void;
}

const SIN_DATOS_MS = 15_000;
const OI_CADA_MS = 10_000;

/** Traduce un frame del servidor de Urus a un mensaje del pipeline (función pura, probada). */
export function interpretarEnvelope(env: Envelope): MensajeMercado | null {
  if (!env || typeof env.t !== 'string' || typeof env.e !== 'string') return null;
  const tipo = env.t.split(':')[0];
  if (tipo === 'trades' && env.e === 'trades' && Array.isArray(env.d)) {
    const trades = (env.d as AggTrade[]).filter(
      (x) => x && Number.isFinite(x.price) && Number.isFinite(x.quantity) && Number.isFinite(x.timestamp) && Number.isFinite(x.aggTradeId) && typeof x.buyerIsMaker === 'boolean',
    );
    return trades.length ? { tipo: 'trades', trades } : null;
  }
  if (tipo === 'book' && env.e === 'book' && env.d && typeof env.d === 'object') {
    const v = env.d as OrderBookView;
    return Array.isArray(v.bids) && Array.isArray(v.asks) ? { tipo: 'libro', vista: v } : null;
  }
  if (env.e === 'status' && env.d && typeof env.d === 'object') {
    const estado = String((env.d as { state?: unknown }).state ?? '');
    if (estado === 'PROVIDER_ERROR' || estado === 'UNAVAILABLE') return { tipo: 'conexion', estado: 'error', detalle: `${tipo}: ${estado}` };
    return null;
  }
  if (env.e === 'detached') return { tipo: 'conexion', estado: 'reconectando', detalle: `El servidor soltó ${env.t}` };
  return null;
}

export class FuenteUrus {
  private es: EventSource | null = null;
  private sesion: string | null = null;
  private rev = 0;
  private detenida = false;
  private ultimoDato = 0;
  private vigilante: ReturnType<typeof setInterval> | null = null;
  private temporizadorOi: ReturnType<typeof setInterval> | null = null;
  private reintento: ReturnType<typeof setTimeout> | null = null;
  private ultimoOi = 0;
  private readonly backoff = new Backoff({ baseMs: 1_000, maxMs: 30_000, jitter: 'equal', floorMs: 500 });

  constructor(private readonly o: OpcionesFuenteUrus) {}

  private get base(): string {
    return this.o.baseUrl.replace(/\/+$/, '');
  }

  iniciar(): void {
    this.detenida = false;
    this.conectar();
    this.vigilante = setInterval(() => {
      if (this.ultimoDato && Date.now() - this.ultimoDato > SIN_DATOS_MS) {
        this.o.onMensaje({ tipo: 'conexion', estado: 'sin-datos', detalle: `Sin datos desde hace ${Math.round((Date.now() - this.ultimoDato) / 1000)} s · reconectando` });
        this.reconectar();
      }
    }, 5_000);
    void this.leerOi();
    this.temporizadorOi = setInterval(() => void this.leerOi(), OI_CADA_MS);
  }

  detener(): void {
    this.detenida = true;
    this.es?.close();
    this.es = null;
    if (this.vigilante) clearInterval(this.vigilante);
    if (this.temporizadorOi) clearInterval(this.temporizadorOi);
    if (this.reintento) clearTimeout(this.reintento);
    this.o.onMensaje({ tipo: 'conexion', estado: 'detenido' });
  }

  private conectar(): void {
    if (this.detenida) return;
    this.o.onMensaje({ tipo: 'conexion', estado: 'conectando', detalle: this.base });
    const es = new EventSource(`${this.base}/api/realtime/stream`);
    this.es = es;
    es.addEventListener('hello', (ev) => {
      try {
        const hola = JSON.parse((ev as MessageEvent).data) as HelloPayload;
        this.sesion = hola.sessionId;
        void this.suscribir();
      } catch {
        this.reconectar();
      }
    });
    es.addEventListener('m', (ev) => {
      let env: Envelope;
      try {
        env = JSON.parse((ev as MessageEvent).data) as Envelope;
      } catch {
        return;
      }
      const m = interpretarEnvelope(env);
      if (!m) return;
      if (m.tipo === 'trades' || m.tipo === 'libro') {
        if (!this.ultimoDato) this.o.onMensaje({ tipo: 'conexion', estado: 'en-vivo', detalle: `${this.o.simbolo} · servidor Urus` });
        this.ultimoDato = Date.now();
        this.backoff.reset();
      }
      this.o.onMensaje(m);
    });
    es.addEventListener('bye', () => this.reconectar());
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) this.reconectar();
      else this.o.onMensaje({ tipo: 'conexion', estado: 'reconectando', detalle: 'Conexión SSE interrumpida' });
    };
  }

  private async suscribir(): Promise<void> {
    if (!this.sesion) return;
    this.rev += 1;
    const topics = [tradesTopic(this.o.simbolo), bookTopic(this.o.simbolo, this.o.profundidad ?? 200, this.o.grupo ?? 10)];
    try {
      const r = await fetch(`${this.base}/api/realtime/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sesion, rev: this.rev, topics }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      this.o.onMensaje({ tipo: 'conexion', estado: 'error', detalle: `No se pudo suscribir: ${e instanceof Error ? e.message : e}` });
      this.reconectar();
    }
  }

  private reconectar(): void {
    if (this.detenida || this.reintento) return;
    this.es?.close();
    this.es = null;
    this.sesion = null;
    this.ultimoDato = 0;
    const espera = this.backoff.next();
    this.o.onMensaje({ tipo: 'conexion', estado: 'reconectando', detalle: `Reintento en ${Math.round(espera / 1000)} s` });
    this.reintento = setTimeout(() => {
      this.reintento = null;
      this.conectar();
    }, espera);
  }

  private async leerOi(): Promise<void> {
    if (this.detenida) return;
    const desde = this.ultimoOi ? this.ultimoOi + 1 : Date.now() - 3 * 3_600_000;
    try {
      const r = await fetch(`${this.base}/api/oi?symbol=${encodeURIComponent(this.o.simbolo)}&from=${desde}&resolutionMs=5000`);
      if (!r.ok) return;
      const cuerpo = (await r.json()) as { snapshots?: OpenInterestSnapshot[] };
      for (const s of (cuerpo.snapshots ?? []).sort((a, b) => a.time - b.time)) {
        if (s.time <= this.ultimoOi) continue;
        this.ultimoOi = s.time;
        this.o.onMensaje({ tipo: 'oi', snapshot: s });
      }
    } catch {
      // El OI es secundario: si falla, el resto del flujo sigue.
    }
  }
}
