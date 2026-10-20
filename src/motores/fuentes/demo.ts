// Fuente DEMO: genera un flujo con la MISMA forma que el de Binance USD-M / servidor Urus
// (aggTrades con id correlativo, vistas del libro calculadas con el OrderBookEngine de Urus y snapshots de OI).
// Incluye episodios reales de microestructura para que cada motor tenga algo que detectar:
// icebergs, absorción, bloques grandes, stop runs y pools de liquidez que se retiran o se barren.
// Determinista: misma semilla → misma cinta. Memoria acotada: solo se guarda el libro cercano al precio.
import { OrderBookEngine } from '../urus/order-flow/order-book';
import { crearAleatorio, normal } from '@/lib/random';
import type { AggTrade, MensajeMercado } from '../nucleo/tipos';

const PASO_MS = 100;
const RANGO_LIBRO = 220; // niveles de 1 USD a cada lado (la vista usa 200)
const GRUPO_VISTA = 10; // vista del libro agrupada a 1 USD (tick 0,1 × 10)

interface Pool {
  precio: number;
  tamaño: number;
  hasta: number;
}

type Episodio =
  | { tipo: 'iceberg'; lado: 'bid' | 'ask'; precio: number; hasta: number; visible: number }
  | { tipo: 'stoprun'; dir: 1 | -1; nivel: number; fase: 'barrido' | 'rechazo'; hasta: number }
  | { tipo: 'tendencia'; dir: 1 | -1; hasta: number };

export class GeneradorDemo {
  readonly simbolo = 'BTCUSDT';
  readonly tickSize = 0.1;
  t: number;
  private r: () => number;
  private mid: number;
  private ancla: number;
  /** Liquidez base (con inercia), SIN pools: los pools se suman encima en cada foto. */
  private readonly baseBids = new Map<number, number>();
  private readonly baseAsks = new Map<number, number>();
  private idTrade = 4_200_000_000;
  private updateId = 1;
  private readonly libro: OrderBookEngine;
  private readonly bids = new Map<number, number>(); // precio entero → tamaño
  private readonly asks = new Map<number, number>();
  private pools: Pool[] = [];
  private episodio: Episodio | null = null;
  private oi = 81_240;
  private proximoOi: number;
  private proximaVista: number;
  private proximoLibro: number;
  private maximos: { t: number; h: number; l: number }[] = [];
  private iniciado = false;

  constructor(semilla = 20261020, inicio = Date.UTC(2026, 9, 20, 6, 0, 0), precio = 84_712) {
    this.r = crearAleatorio(semilla);
    this.t = inicio;
    this.mid = precio;
    this.ancla = precio;
    this.proximoOi = inicio;
    this.proximaVista = inicio;
    this.proximoLibro = inicio;
    this.libro = new OrderBookEngine({ symbol: this.simbolo, tickSize: this.tickSize, maxLevelsPerSide: 1_000, sampleIntervalMs: 500 });
  }

  /** Avanza `ms` de tiempo de mercado y devuelve los mensajes producidos, en orden. */
  avanzar(ms: number, rapido = false): MensajeMercado[] {
    const cadaVista = rapido ? 1_000 : 250;
    const cadaLibro = rapido ? 1_000 : 500;
    const out: MensajeMercado[] = [];
    if (!this.iniciado) {
      this.iniciado = true;
      out.push({ tipo: 'conexion', estado: 'en-vivo', detalle: 'DEMO · flujo sintético con la forma de Binance USD-M' });
      this.reconstruirLibro();
      this.libro.applySnapshot({ bids: this.tuplas(this.bids, -1), asks: this.tuplas(this.asks, 1), lastUpdateId: this.updateId, timestamp: this.t });
    }
    const fin = this.t + ms;
    while (this.t < fin) {
      this.t += PASO_MS;
      const trades = this.paso();
      if (trades.length) out.push({ tipo: 'trades', trades });
      if (this.t >= this.proximaVista) {
        this.proximaVista = this.t + cadaVista;
        // El libro completo se rehace cada 500 ms; la vista (lo que emite el servidor) sale cada 250 ms.
        if (this.t >= this.proximoLibro) {
          this.proximoLibro = this.t + cadaLibro;
          this.actualizarLibro();
        }
        out.push({ tipo: 'libro', vista: this.libro.getView(200, GRUPO_VISTA) });
      }
      if (this.t >= this.proximoOi) {
        this.proximoOi = this.t + 5_000;
        out.push({ tipo: 'oi', snapshot: { symbol: this.simbolo, time: this.t, oiContracts: Math.round(this.oi * 1000) / 1000, oiValue: this.oi * this.mid, markPrice: this.mid, source: 'poll' } });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------

  private paso(): AggTrade[] {
    const r = this.r;
    this.gestionarEpisodios();
    const ep = this.episodio;

    // Movimiento del precio: ruido + deriva del episodio.
    let deriva = 0;
    let ruido = 2.0;
    if (ep?.tipo === 'tendencia') deriva = ep.dir * 0.04;
    // Reversión suave hacia un ancla que deriva despacio: rangos realistas (ATR 1m ≈ 50–80 USD).
    this.ancla += normal(r) * 0.15;
    deriva += (this.ancla - this.mid) * 0.0008;
    if (ep?.tipo === 'stoprun') {
      deriva = ep.fase === 'barrido' ? ep.dir * 3.2 : -ep.dir * 2.6;
      ruido = 1.2;
    }
    let nuevo = this.mid + deriva + normal(r) * ruido;
    if (ep?.tipo === 'iceberg') {
      // El iceberg frena el precio: no lo atraviesa mientras está activo.
      nuevo = ep.lado === 'bid' ? Math.max(nuevo, ep.precio + 0.5) : Math.min(nuevo, ep.precio - 0.5);
    }
    const anterior = this.mid;
    this.mid = Math.round(nuevo * 10) / 10;

    // Pools: el precio que los atraviesa los barre; algunos se retiran.
    const lo = Math.min(anterior, this.mid);
    const hi = Math.max(anterior, this.mid);
    this.pools = this.pools.filter((p) => !(p.precio >= lo - 0.5 && p.precio <= hi + 0.5) && p.hasta > this.t);
    if (this.pools.length < 6 && r() < 0.01) {
      const lado = r() < 0.5 ? 1 : -1;
      const precio = Math.round(this.mid + lado * (40 + r() * 180));
      this.pools.push({ precio, tamaño: 25 + r() * 45, hasta: this.t + 60_000 + r() * 600_000 });
    }

    // Trades: Poisson ~45/s, más en episodios.
    const intensidad = ep?.tipo === 'stoprun' ? 14 : ep?.tipo === 'iceberg' ? 7 : 4.5;
    const n = this.poisson(intensidad);
    const sesgoCompra = 0.5 + Math.max(-0.3, Math.min(0.3, (this.mid - anterior) * 0.08)) + (ep?.tipo === 'stoprun' ? (ep.fase === 'barrido' ? ep.dir : -ep.dir) * 0.25 : 0);
    const trades: AggTrade[] = [];
    for (let i = 0; i < n; i += 1) {
      let compra = r() < sesgoCompra;
      let precio = compra ? this.mid + 0.05 : this.mid - 0.05;
      let cantidad = Math.max(0.001, Math.round(Math.exp(normal(r) * 1.05 - 3.1) * 1000) / 1000);
      if (ep?.tipo === 'iceberg' && r() < 0.35) {
        // Agresión repetida contra el nivel del iceberg (vendedores contra el bid / compradores contra el ask).
        compra = ep.lado === 'ask';
        precio = ep.precio;
        cantidad = Math.round((0.05 + r() * 0.25) * 1000) / 1000;
      }
      trades.push(this.trade(Math.round(precio * 10) / 10, cantidad, !compra, this.t - PASO_MS + Math.floor((i / Math.max(1, n)) * PASO_MS)));
    }
    // Bloque grande ocasional (≥ 250 k USD en < 50 ms) → BigTradeDetector.
    if (r() < 0.0009) {
      const compra = r() < 0.5;
      const piezas = 6 + Math.floor(r() * 10);
      const total = 3 + r() * 6;
      for (let k = 0; k < piezas; k += 1) {
        trades.push(this.trade(Math.round((this.mid + (compra ? 0.05 + k * 0.1 : -0.05 - k * 0.1)) * 10) / 10, Math.round((total / piezas) * 1000) / 1000, !compra, this.t - 40 + k * 3));
      }
    }
    trades.sort((a, b) => a.timestamp - b.timestamp || a.aggTradeId - b.aggTradeId);

    // OI: abre con flujo direccional, cae en barridos (cierres forzados).
    const delta = trades.reduce((s, x) => s + (x.buyerIsMaker ? -x.quantity : x.quantity), 0);
    this.oi += Math.abs(delta) * 0.08 * (r() < 0.55 ? 1 : -1) + normal(r) * 0.4 - (ep?.tipo === 'stoprun' && ep.fase === 'rechazo' ? 0.9 : 0);

    // Registro de máximos/mínimos por 5 s para planificar stop runs.
    const s5 = Math.floor(this.t / 5_000);
    const ult = this.maximos[this.maximos.length - 1];
    if (!ult || ult.t !== s5) this.maximos.push({ t: s5, h: this.mid, l: this.mid });
    else {
      ult.h = Math.max(ult.h, this.mid);
      ult.l = Math.min(ult.l, this.mid);
    }
    if (this.maximos.length > 120) this.maximos.splice(0, this.maximos.length - 120);
    return trades;
  }

  private gestionarEpisodios(): void {
    const r = this.r;
    const ep = this.episodio;
    if (ep && this.t >= ep.hasta) {
      if (ep.tipo === 'stoprun' && ep.fase === 'barrido') {
        this.episodio = { ...ep, fase: 'rechazo', hasta: this.t + 9_000 + r() * 6_000 };
        return;
      }
      this.episodio = null;
    }
    if (this.episodio) return;
    const x = r();
    if (x < 0.0009) {
      const lado = r() < 0.5 ? 'bid' : 'ask';
      this.episodio = { tipo: 'iceberg', lado, precio: Math.round(this.mid + (lado === 'bid' ? -1 : 1)) + (lado === 'bid' ? 0 : 0), hasta: this.t + 25_000 + r() * 30_000, visible: 1.2 + r() * 1.5 };
    } else if (x < 0.0014 && this.maximos.length > 60) {
      const ventana = this.maximos.slice(-60, -4);
      const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
      const nivel = dir === 1 ? Math.max(...ventana.map((m) => m.h)) : Math.min(...ventana.map((m) => m.l));
      if (Math.abs(nivel - this.mid) < 120) this.episodio = { tipo: 'stoprun', dir, nivel, fase: 'barrido', hasta: this.t + Math.max(4_000, (Math.abs(nivel - this.mid) / 3.2) * PASO_MS + 3_000) };
    } else if (x < 0.004) {
      this.episodio = { tipo: 'tendencia', dir: r() < 0.5 ? 1 : -1, hasta: this.t + 60_000 + r() * 240_000 };
    }
  }

  private trade(precio: number, cantidad: number, buyerIsMaker: boolean, ts: number): AggTrade {
    this.idTrade += 1;
    return { symbol: this.simbolo, price: precio, quantity: cantidad, timestamp: ts, aggTradeId: this.idTrade, buyerIsMaker };
  }

  private poisson(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= this.r();
    } while (p > L);
    return k - 1;
  }

  /** Libro sintético a 1 USD: liquidez base que decae con la distancia + pools grandes + iceberg visible. */
  private reconstruirLibro(): void {
    const r = this.r;
    const centro = Math.round(this.mid);
    const nuevoBid = new Map<number, number>();
    const nuevoAsk = new Map<number, number>();
    for (let d = 1; d <= RANGO_LIBRO; d += 1) {
      const base = (0.4 + 2.2 * Math.exp(-d / 90)) * Math.exp(normal(r) * 0.45);
      const pb = centro - d;
      const pa = centro + d;
      const prevB = this.baseBids.get(pb);
      const prevA = this.baseAsks.get(pa);
      // Inercia: el libro cambia de forma gradual (habilita stacking/pulling del motor de Urus).
      nuevoBid.set(pb, Math.round((prevB !== undefined ? prevB * 0.85 + base * 0.15 : base) * 1000) / 1000);
      nuevoAsk.set(pa, Math.round((prevA !== undefined ? prevA * 0.85 + base * 0.15 : base) * 1000) / 1000);
    }
    // Se guarda la base SIN pools (si no, la inercia acumularía el pool en cada foto).
    this.baseBids.clear();
    this.baseAsks.clear();
    for (const [k, v] of nuevoBid) this.baseBids.set(k, v);
    for (const [k, v] of nuevoAsk) this.baseAsks.set(k, v);
    for (const p of this.pools) {
      if (p.precio < this.mid) nuevoBid.set(p.precio, (nuevoBid.get(p.precio) ?? 0) + p.tamaño);
      else nuevoAsk.set(p.precio, (nuevoAsk.get(p.precio) ?? 0) + p.tamaño);
    }
    const ep = this.episodio;
    if (ep?.tipo === 'iceberg') {
      // Solo se ve una fracción pequeña; se recarga tras cada ejecución (eso detecta IcebergTracker).
      const mapa = ep.lado === 'bid' ? nuevoBid : nuevoAsk;
      mapa.set(ep.precio, ep.visible * (0.7 + r() * 0.3));
    }
    this.bids.clear();
    this.asks.clear();
    for (const [k, v] of nuevoBid) this.bids.set(k, v);
    for (const [k, v] of nuevoAsk) this.asks.set(k, v);
  }

  private actualizarLibro(): void {
    const prevB = new Map(this.bids);
    const prevA = new Map(this.asks);
    this.reconstruirLibro();
    const diff = (antes: Map<number, number>, ahora: Map<number, number>) => {
      const out: [number, number][] = [];
      for (const [p, v] of ahora) if (antes.get(p) !== v) out.push([p, v]);
      for (const p of antes.keys()) if (!ahora.has(p)) out.push([p, 0]);
      return out;
    };
    const mejorBid = Math.round((this.mid - 0.05) * 10) / 10;
    const mejorAsk = Math.round((this.mid + 0.05) * 10) / 10;
    // Los niveles entre el mejor bid/ask y el entero más cercano se limpian para que el libro no quede cruzado.
    const limpiar: [number, number][] = [];
    for (let k = -12; k <= 12; k += 1) {
      const p = Math.round((this.mid + k * 0.1) * 10) / 10;
      if (!Number.isInteger(p) && p !== mejorBid && p !== mejorAsk) limpiar.push([p, 0]);
    }
    const bidsDiff = [...diff(prevB, this.bids).filter(([p]) => p <= mejorBid), ...diff(prevA, this.asks).filter(([p]) => p <= mejorBid).map(([p]) => [p, 0] as [number, number]), ...limpiar.filter(([p]) => p < mejorBid)];
    const asksDiff = [...diff(prevA, this.asks).filter(([p]) => p >= mejorAsk), ...diff(prevB, this.bids).filter(([p]) => p >= mejorAsk).map(([p]) => [p, 0] as [number, number]), ...limpiar.filter(([p]) => p > mejorAsk)];
    // Mejor bid/ask con tamaño fino (top of book) y retirada de lo que quedó al otro lado del precio.
    bidsDiff.push([mejorBid, Math.round((0.3 + this.r() * 3) * 1000) / 1000]);
    asksDiff.push([mejorAsk, Math.round((0.3 + this.r() * 3) * 1000) / 1000]);
    for (let p = Math.floor(mejorBid) + 1; p <= Math.ceil(mejorAsk) + 1; p += 1) if (p > mejorBid) bidsDiff.push([p, 0]);
    for (let p = Math.floor(mejorBid) - 1; p <= Math.ceil(mejorAsk) - 1; p += 1) if (p < mejorAsk) asksDiff.push([p, 0]);
    this.updateId += 1;
    this.libro.applyDiff({ bids: bidsDiff, asks: asksDiff, finalUpdateId: this.updateId, timestamp: this.t });
    if (this.libro.isCrossed()) {
      this.libro.applySnapshot({ bids: this.tuplas(this.bids, -1, mejorBid), asks: this.tuplas(this.asks, 1, mejorAsk), lastUpdateId: this.updateId, timestamp: this.t });
    }
  }

  private tuplas(m: Map<number, number>, lado: 1 | -1, limite?: number): [number, number][] {
    const out: [number, number][] = [];
    for (const [p, v] of m) if (limite === undefined || (lado === -1 ? p <= limite : p >= limite)) out.push([p, v]);
    return out;
  }
}
