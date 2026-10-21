// Constructor INCREMENTAL de barras con Footprint.
//
// aggregateFootprintTrades reconstruye en cada lote de trades el Map de niveles y el array de velas completo
// (applyAggTradesToFootprint): correcto pero genera mucha basura y pausas del recolector con las horas.
// Aquí cada trade actualiza un único Map mutable de la barra en curso; el objeto FootprintCandle se crea
// UNA vez, al cerrar la barra, con las mismas funciones del footprint (getPriceLevel, selectPoc), por lo que
// los niveles son idénticos a los de aggregateFootprintTrades (ver barras.test.ts).
import { getCandleStart, getPriceLevel, selectPoc, type FootprintCandle, type FootprintLevel } from '../flujo/order-flow/footprint';
import type { AggTrade, Temporalidad } from './tipos';

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BarraCerrada {
  /** Índice correlativo de la barra dentro de su serie. */
  n: number;
  inicio: number;
  /** Instante del último trade (barras de dólar/volumen) o fin del intervalo (barras de tiempo). */
  cierre: number;
  ohlc: Ohlc;
  footprint: FootprintCandle;
  compra: number;
  venta: number;
  delta: number;
  volumen: number;
  nocional: number;
  trades: number;
  vwap: number;
}

interface NivelMutable {
  price: number;
  bidQty: number;
  askQty: number;
  tradeCount: number;
}

export class ConstructorBarras {
  private niveles = new Map<number, NivelMutable>();
  private abierta = false;
  private inicio = 0;
  private ultimoTs = 0;
  private ohlc: Ohlc = { open: 0, high: 0, low: 0, close: 0 };
  private compra = 0;
  private venta = 0;
  private nocional = 0;
  private trades = 0;
  private contador = 0;
  private ultimoId = -1;

  constructor(
    readonly temporalidad: Temporalidad,
    /** Paso de precio de las filas (USD). */
    readonly paso: number,
    readonly tickSize = 0.1,
  ) {
    if (!(paso > 0)) throw new Error('Paso de precio inválido');
  }

  /** Multiplicador sobre el tick que usan las funciones del footprint (paso = tick × multiplicador). */
  get multiplicador(): number {
    return Math.max(1, Math.round(this.paso / this.tickSize));
  }

  get pasoEfectivo(): number {
    return this.tickSize * this.multiplicador;
  }

  /** Añade un trade. Devuelve la barra que se cerró (si alguna). Trades repetidos o desordenados por id se ignoran. */
  agregar(t: AggTrade): BarraCerrada | null {
    if (!Number.isFinite(t.price) || !Number.isFinite(t.quantity) || !(t.quantity > 0) || !Number.isFinite(t.timestamp)) return null;
    if (t.aggTradeId <= this.ultimoId) return null;
    this.ultimoId = t.aggTradeId;

    let cerrada: BarraCerrada | null = null;
    const tf = this.temporalidad;
    if (this.abierta && tf.tipo === 'tiempo' && t.timestamp >= this.inicio + tf.ms) cerrada = this.cerrar(this.inicio + tf.ms);
    if (!this.abierta) this.abrir(tf.tipo === 'tiempo' ? getCandleStart(t.timestamp, tf.ms) : t.timestamp, t.price);

    const precio = getPriceLevel(t.price, this.tickSize, this.multiplicador);
    let nivel = this.niveles.get(precio);
    if (!nivel) {
      nivel = { price: precio, bidQty: 0, askQty: 0, tradeCount: 0 };
      this.niveles.set(precio, nivel);
    }
    if (t.buyerIsMaker) {
      nivel.bidQty += t.quantity;
      this.venta += t.quantity;
    } else {
      nivel.askQty += t.quantity;
      this.compra += t.quantity;
    }
    nivel.tradeCount += 1;
    this.trades += 1;
    this.nocional += t.price * t.quantity;
    this.ultimoTs = t.timestamp;
    const o = this.ohlc;
    if (t.price > o.high) o.high = t.price;
    if (t.price < o.low) o.low = t.price;
    o.close = t.price;

    // Barras de actividad: el trade que cruza el umbral pertenece a la barra que cierra.
    if (tf.tipo === 'dolar' && this.nocional >= tf.usd) return cerrada ?? this.cerrar(t.timestamp);
    if (tf.tipo === 'volumen' && this.compra + this.venta >= tf.base) return cerrada ?? this.cerrar(t.timestamp);
    return cerrada;
  }

  /** Cierra la barra de tiempo en curso si el reloj del flujo ya pasó su fin (para no esperar al próximo trade). */
  cerrarSiVencida(ahora: number): BarraCerrada | null {
    const tf = this.temporalidad;
    if (!this.abierta || tf.tipo !== 'tiempo' || ahora < this.inicio + tf.ms) return null;
    return this.cerrar(this.inicio + tf.ms);
  }

  /** Vista de la barra en curso (para dibujar). Se llama a baja frecuencia: crea objetos. */
  enCurso(): BarraCerrada | null {
    if (!this.abierta) return null;
    return this.construir(this.ultimoTs, false);
  }

  reiniciar(): void {
    this.niveles = new Map();
    this.abierta = false;
    this.ultimoId = -1;
  }

  private abrir(inicio: number, precio: number): void {
    this.abierta = true;
    this.inicio = inicio;
    this.ohlc = { open: precio, high: precio, low: precio, close: precio };
    this.compra = 0;
    this.venta = 0;
    this.nocional = 0;
    this.trades = 0;
    this.niveles = new Map();
  }

  private cerrar(cierre: number): BarraCerrada {
    const barra = this.construir(cierre, true);
    this.contador += 1;
    this.abierta = false;
    return barra;
  }

  private construir(cierre: number, completa: boolean): BarraCerrada {
    const levels: FootprintLevel[] = [];
    for (const n of this.niveles.values()) {
      levels.push({ price: n.price, bidQty: n.bidQty, askQty: n.askQty, tradeCount: n.tradeCount, delta: n.askQty - n.bidQty, volume: n.askQty + n.bidQty });
    }
    levels.sort((a, b) => a.price - b.price);
    const volumen = this.compra + this.venta;
    const tf = this.temporalidad;
    const footprint: FootprintCandle = {
      timestamp: this.inicio,
      timeframeMs: tf.tipo === 'tiempo' ? tf.ms : Math.max(1, cierre - this.inicio),
      levels,
      bidQty: this.venta,
      askQty: this.compra,
      delta: this.compra - this.venta,
      volume: volumen,
      pocPrice: selectPoc(levels, this.ohlc.close)?.price ?? null,
      complete: completa,
    };
    return {
      n: this.contador,
      inicio: this.inicio,
      cierre,
      ohlc: { ...this.ohlc },
      footprint,
      compra: this.compra,
      venta: this.venta,
      delta: this.compra - this.venta,
      volumen,
      nocional: this.nocional,
      trades: this.trades,
      vwap: volumen > 0 ? this.nocional / volumen : this.ohlc.close,
    };
  }
}
