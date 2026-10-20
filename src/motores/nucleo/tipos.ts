// Tipos del núcleo de Order Flow de athenAI.
// Los motores de Urus (src/motores/urus) se usan tal cual; aquí solo se define cómo se alimentan.
import type { AggTrade } from '../urus/market-data/types';
import type { OrderBookView } from '../urus/order-flow/order-book';
import type { OpenInterestSnapshot } from '../urus/open-interest/types';

export type { AggTrade, OrderBookView, OpenInterestSnapshot };

/** Mensajes normalizados que cualquier fuente (DEMO, servidor Urus, Binance directo) entrega al pipeline. */
export type MensajeMercado =
  | { tipo: 'trades'; trades: AggTrade[] }
  | { tipo: 'libro'; vista: OrderBookView }
  | { tipo: 'oi'; snapshot: OpenInterestSnapshot }
  | { tipo: 'liquidacion'; liq: Liquidacion }
  /** Tasa de funding vigente (perpetuos): se cobra o paga cada 8 h. `t` = hora del dato. */
  | { tipo: 'funding'; tasa: number; t: number }
  | { tipo: 'conexion'; estado: EstadoConexion; detalle?: string };

/** Liquidación forzada publicada por el exchange. `lado` es el lado de la ORDEN de liquidación:
 * 'venta' = se liquida un largo (presión vendedora); 'compra' = se liquida un corto. */
export interface Liquidacion {
  simbolo: string;
  t: number;
  precio: number;
  cantidad: number;
  lado: 'compra' | 'venta';
}

export type EstadoConexion = 'conectando' | 'en-vivo' | 'reconectando' | 'sin-datos' | 'error' | 'detenido';

export type IdTemporalidad = '1m' | '5m' | '15m' | 'dollar' | 'volume';

export type Temporalidad =
  | { id: IdTemporalidad; tipo: 'tiempo'; ms: number }
  | { id: IdTemporalidad; tipo: 'dolar'; usd: number }
  | { id: IdTemporalidad; tipo: 'volumen'; base: number };

export const TEMPORALIDADES: Record<IdTemporalidad, Temporalidad> = {
  '1m': { id: '1m', tipo: 'tiempo', ms: 60_000 },
  '5m': { id: '5m', tipo: 'tiempo', ms: 300_000 },
  '15m': { id: '15m', tipo: 'tiempo', ms: 900_000 },
  // ≈ 2.000 barras/día en BTCUSDT perpetuo (volumen típico 15–25 mil M USD/día).
  dollar: { id: 'dollar', tipo: 'dolar', usd: 10_000_000 },
  volume: { id: 'volume', tipo: 'volumen', base: 100 },
};

/** Paso de precio (USD) de las filas del Footprint por temporalidad. Es la rejilla que leen los motores. */
export const AGRUPACION_POR_TEMPORALIDAD: Record<IdTemporalidad, number> = {
  '1m': 5,
  '5m': 10,
  '15m': 20,
  dollar: 5,
  volume: 5,
};

export type TipoEvento = 'absorcion' | 'agotamiento' | 'iceberg' | 'stoprun' | 'bigtrade' | 'pool-barrido' | 'liquidacion';

/**
 * Evento detectado por un motor. `t` es cuándo ocurrió en el mercado; `disponibleEn` es el instante del
 * flujo de datos en que el motor pudo afirmarlo. Las Features solo usan eventos con disponibleEn ≤ cierre de barra.
 */
export interface EventoMotor {
  id: string;
  tipo: TipoEvento;
  t: number;
  disponibleEn: number;
  precio: number;
  /** 'compra' = agresión compradora / lado ask; 'venta' = agresión vendedora / lado bid. */
  lado: 'compra' | 'venta';
  /** Score 0–100 o magnitud propia del motor (USD para big trades). */
  magnitud: number;
  detalle: string;
}
