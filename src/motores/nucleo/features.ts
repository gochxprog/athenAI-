// Catálogo de Features que aprenden los modelos y su cálculo por barra canónica.
// Regla de oro: una fila se construye en el instante del CIERRE de la barra con información disponible hasta
// ese instante. Nada calculado después (p. ej. el agotamiento de esta misma barra) entra en su fila.
import { computeOpenInterest } from '../urus/open-interest/engine';
import type { OpenInterestCandlePoint } from '../urus/open-interest/types';
import { computeObi, computeMicroPrice } from '../urus/order-flow/formulas';
import type { BarraAnalizada } from './serieBarras';
import type { MotorMercado } from './motorMercado';
import type { EventoMotor } from './tipos';

export interface DefinicionFeature {
  clave: string;
  nombre: string;
  grupo: 'Calidad de datos' | 'Contexto' | 'Flujo' | 'Footprint' | 'Absorción / Agotamiento' | 'Big trades' | 'Icebergs / Stop runs' | 'Open Interest' | 'Libro (DOM)' | 'Liquidez (LHM)' | 'Precio';
  motor: string;
  descripcion: string;
}

export const DEFINICIONES_FEATURES: DefinicionFeature[] = [
  { clave: 'retorno', nombre: 'Retorno de la barra', grupo: 'Precio', motor: 'Barras', descripcion: 'close / open − 1' },
  { clave: 'rango_atr', nombre: 'Rango / ATR', grupo: 'Precio', motor: 'Barras', descripcion: '(high − low) / ATR(14) de barras previas' },
  { clave: 'dist_vwap_atr', nombre: 'Distancia al VWAP', grupo: 'Precio', motor: 'Flujo', descripcion: '(close − VWAP de sesión UTC) / ATR(14)' },
  { clave: 'delta', nombre: 'Delta', grupo: 'Flujo', motor: 'Footprint', descripcion: 'Volumen agresor comprador − vendedor (BTC)' },
  { clave: 'delta_ratio', nombre: 'Delta / volumen', grupo: 'Flujo', motor: 'Footprint', descripcion: 'Delta normalizado en [−1, 1]' },
  { clave: 'trades_rel', nombre: 'Trades relativos', grupo: 'Flujo', motor: 'Barras', descripcion: 'Número de trades / media de las 20 barras previas (en dollar bars el volumen es casi constante por construcción)' },
  { clave: 'duracion_s', nombre: 'Duración', grupo: 'Flujo', motor: 'Barras', descripcion: 'Segundos que tardó en completarse la dollar bar (actividad)' },
  { clave: 'cvd_sesion', nombre: 'CVD de sesión', grupo: 'Flujo', motor: 'SessionCVD (Urus)', descripcion: 'Delta acumulado de la sesión automática (SYD/TOK/LON/NY)' },
  { clave: 'cvd_pendiente_5', nombre: 'Pendiente del CVD', grupo: 'Flujo', motor: 'SessionCVD (Urus)', descripcion: 'Cambio del CVD en las últimas 5 barras' },
  { clave: 'imb_compra', nombre: 'Imbalances compradores', grupo: 'Footprint', motor: 'Microstructure (Urus)', descripcion: 'Niveles con imbalance diagonal comprador ≥ 3:1' },
  { clave: 'imb_venta', nombre: 'Imbalances vendedores', grupo: 'Footprint', motor: 'Microstructure (Urus)', descripcion: 'Niveles con imbalance diagonal vendedor ≥ 3:1' },
  { clave: 'stacked_compra', nombre: 'Stacked compradores', grupo: 'Footprint', motor: 'Microstructure (Urus)', descripcion: 'Rachas de ≥ 3 imbalances compradores consecutivos' },
  { clave: 'stacked_venta', nombre: 'Stacked vendedores', grupo: 'Footprint', motor: 'Microstructure (Urus)', descripcion: 'Rachas de ≥ 3 imbalances vendedores consecutivos' },
  { clave: 'poc_pos', nombre: 'Posición del POC', grupo: 'Footprint', motor: 'Footprint (Urus)', descripcion: 'POC dentro del rango de la barra (0 = low, 1 = high)' },
  { clave: 'delta_poc_pos', nombre: 'Posición del delta-POC', grupo: 'Footprint', motor: 'Microstructure (Urus)', descripcion: 'Nivel de mayor |delta| dentro del rango (0–1)' },
  { clave: 'absorcion_ask', nombre: 'Absorción en el ask', grupo: 'Absorción / Agotamiento', motor: 'AbsorptionEngine (Urus)', descripcion: 'Score máximo (0–100) de compradores agresivos absorbidos' },
  { clave: 'absorcion_bid', nombre: 'Absorción en el bid', grupo: 'Absorción / Agotamiento', motor: 'AbsorptionEngine (Urus)', descripcion: 'Score máximo (0–100) de vendedores agresivos absorbidos' },
  { clave: 'agotamiento_prev_alcista', nombre: 'Agotamiento alcista (barra previa)', grupo: 'Absorción / Agotamiento', motor: 'ExhaustionEngine (Urus)', descripcion: 'Score del agotamiento comprador de la barra anterior, confirmado al cierre de esta' },
  { clave: 'agotamiento_prev_bajista', nombre: 'Agotamiento bajista (barra previa)', grupo: 'Absorción / Agotamiento', motor: 'ExhaustionEngine (Urus)', descripcion: 'Score del agotamiento vendedor de la barra anterior, confirmado al cierre de esta' },
  { clave: 'bigtrades_compra_usd', nombre: 'Big trades compradores', grupo: 'Big trades', motor: 'BigTradeDetector (Urus)', descripcion: 'Nocional (USD) de bloques compradores grandes en la barra' },
  { clave: 'bigtrades_venta_usd', nombre: 'Big trades vendedores', grupo: 'Big trades', motor: 'BigTradeDetector (Urus)', descripcion: 'Nocional (USD) de bloques vendedores grandes en la barra' },
  { clave: 'icebergs_bid', nombre: 'Icebergs en el bid', grupo: 'Icebergs / Stop runs', motor: 'IcebergTracker (Urus)', descripcion: 'Icebergs compradores confirmados durante la barra' },
  { clave: 'icebergs_ask', nombre: 'Icebergs en el ask', grupo: 'Icebergs / Stop runs', motor: 'IcebergTracker (Urus)', descripcion: 'Icebergs vendedores confirmados durante la barra' },
  { clave: 'stoprun_alto', nombre: 'Stop run de máximos', grupo: 'Icebergs / Stop runs', motor: 'StopRunSeries (Urus)', descripcion: 'Barridos de máximos confirmados durante la barra' },
  { clave: 'stoprun_bajo', nombre: 'Stop run de mínimos', grupo: 'Icebergs / Stop runs', motor: 'StopRunSeries (Urus)', descripcion: 'Barridos de mínimos confirmados durante la barra' },
  { clave: 'liq_largos_usd', nombre: 'Liquidaciones de largos', grupo: 'Open Interest', motor: 'Binance forceOrder', descripcion: 'Nocional (USD) de largos liquidados durante la barra (presión vendedora forzada)' },
  { clave: 'liq_cortos_usd', nombre: 'Liquidaciones de cortos', grupo: 'Open Interest', motor: 'Binance forceOrder', descripcion: 'Nocional (USD) de cortos liquidados durante la barra (presión compradora forzada)' },
  { clave: 'funding_tasa', nombre: 'Funding', grupo: 'Open Interest', motor: 'Binance markPrice', descripcion: 'Tasa de funding vigente al cierre de la barra (se cobra o paga cada 8 h; positiva = los largos pagan a los cortos)' },
  { clave: 'oi_delta_pct', nombre: 'ΔOI %', grupo: 'Open Interest', motor: 'OpenInterest (Urus)', descripcion: 'Cambio porcentual del interés abierto en la barra' },
  { clave: 'oi_delta_z', nombre: 'ΔOI z robusto', grupo: 'Open Interest', motor: 'OpenInterest (Urus)', descripcion: 'z-score robusto (mediana/MAD) del ΔOI' },
  { clave: 'oi_cuadrante', nombre: 'Cuadrante precio/OI', grupo: 'Open Interest', motor: 'OpenInterest (Urus)', descripcion: '1 longs nuevos · 2 cobertura shorts · 3 shorts nuevos · 4 liquidación longs · 0 neutral' },
  { clave: 'oi_flush', nombre: 'Flush de OI', grupo: 'Open Interest', motor: 'OpenInterest (Urus)', descripcion: '1 si hubo cierre masivo de posiciones con movimiento y volumen' },
  { clave: 'obi_10', nombre: 'OBI (10 niveles)', grupo: 'Libro (DOM)', motor: 'Formulas (Urus)', descripcion: 'Desequilibrio bid/ask de los 10 primeros niveles en [−1, 1]' },
  { clave: 'microprice_ticks', nombre: 'MicroPrice − mid', grupo: 'Libro (DOM)', motor: 'Formulas (Urus)', descripcion: 'Desviación del MicroPrice respecto al mid, en ticks' },
  { clave: 'pool_ask_dist_atr', nombre: 'Pool ask más cercano', grupo: 'Liquidez (LHM)', motor: 'LiquidityPoolEngine (Urus)', descripcion: 'Distancia al pool vendedor más cercano / ATR' },
  { clave: 'pool_bid_dist_atr', nombre: 'Pool bid más cercano', grupo: 'Liquidez (LHM)', motor: 'LiquidityPoolEngine (Urus)', descripcion: 'Distancia al pool comprador más cercano / ATR' },
  { clave: 'pools_barridos', nombre: 'Pools barridos', grupo: 'Liquidez (LHM)', motor: 'LiquidityPoolEngine (Urus)', descripcion: 'Pools de liquidez absorbidos por el precio durante la barra' },
  { clave: 'ventana_evento', nombre: 'Ventana de evento fuerte', grupo: 'Contexto', motor: 'Calendario', descripcion: '1 si la barra cierra dentro de la ventana de un evento de alto impacto (FOMC, CPI…): zona de no operar' },
  { clave: 'hueco', nombre: 'Hueco de datos', grupo: 'Calidad de datos', motor: 'Vigía', descripcion: '1 si durante la barra se cortó la conexión o se resincronizó el libro: no entrenar con esta fila sin revisarla' },
];

export interface FilaFeatures {
  /** Índice de la barra canónica. */
  n: number;
  inicio: number;
  /** Instante en que la fila quedó disponible (= cierre de la barra). */
  cierre: number;
  close: number;
  /** Máximo y mínimo de la barra (para el Etiquetador; no existen en filas grabadas antes de guardarlos). */
  high?: number;
  low?: number;
  valores: Record<string, number | null>;
}

const CUADRANTE: Record<string, number> = { longs_nuevos: 1, cobertura_shorts: 2, shorts_nuevos: 3, liquidacion_longs: 4, neutral: 0 };

function atr(barras: readonly BarraAnalizada[], periodo = 14): number | null {
  if (barras.length < 2) return null;
  const desde = Math.max(1, barras.length - periodo);
  let suma = 0;
  let n = 0;
  for (let i = desde; i < barras.length; i += 1) {
    const b = barras[i].ohlc;
    const prev = barras[i - 1].ohlc.close;
    suma += Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
    n += 1;
  }
  return n > 0 ? suma / n : null;
}

const posicion = (precio: number | null, low: number, high: number) => (precio === null || high <= low ? null : (precio - low) / (high - low));

/**
 * Construye la fila de la barra `b` (recién cerrada). `previas` son las barras canónicas anteriores,
 * `cvdHistorial` el CVD al cierre de cada barra previa (para la pendiente).
 */
export function construirFila(b: BarraAnalizada, previas: readonly BarraAnalizada[], mercado: MotorMercado, cvdHistorial: readonly number[]): { fila: FilaFeatures; oi: OpenInterestCandlePoint | null } {
  const v: Record<string, number | null> = {};
  const a = atr(previas);
  const { open, high, low, close } = b.ohlc;

  v.retorno = open > 0 ? close / open - 1 : null;
  v.rango_atr = a ? (high - low) / a : null;
  v.dist_vwap_atr = a && mercado.vwapSesion !== null ? (close - mercado.vwapSesion) / a : null;
  v.delta = b.delta;
  v.delta_ratio = b.volumen > 0 ? b.delta / b.volumen : null;
  const ult20 = previas.slice(-20);
  const mediaTrades = ult20.length ? ult20.reduce((s, x) => s + x.trades, 0) / ult20.length : 0;
  v.trades_rel = mediaTrades > 0 ? b.trades / mediaTrades : null;
  v.duracion_s = (b.cierre - b.inicio) / 1000;
  v.cvd_sesion = mercado.cvdSesion;
  v.cvd_pendiente_5 = cvdHistorial.length >= 5 ? mercado.cvdSesion - cvdHistorial[cvdHistorial.length - 5] : null;

  const sen = b.senales;
  v.imb_compra = sen.levels.filter((l) => l.buyingImbalance).length;
  v.imb_venta = sen.levels.filter((l) => l.sellingImbalance).length;
  v.stacked_compra = sen.stackedImbalances.filter((s) => s.direction === 'buying').length;
  v.stacked_venta = sen.stackedImbalances.filter((s) => s.direction === 'selling').length;
  v.poc_pos = posicion(b.footprint.pocPrice, low, high);
  v.delta_poc_pos = posicion(sen.deltaPocPrice, low, high);

  const maxScore = (xs: { absorptionScore?: number; exhaustionScore?: number }[]) => (xs.length ? Math.max(...xs.map((x) => x.absorptionScore ?? x.exhaustionScore ?? 0)) : 0);
  v.absorcion_ask = maxScore(b.absorcion.filter((d) => d.side === 'ask'));
  v.absorcion_bid = maxScore(b.absorcion.filter((d) => d.side === 'bid'));
  // Agotamiento de la barra ANTERIOR: se acaba de confirmar con el cierre de ésta.
  const prev = previas[previas.length - 1];
  const ag = prev?.agotamiento ?? [];
  v.agotamiento_prev_alcista = maxScore(ag.filter((d) => d.side === 'bullish'));
  v.agotamiento_prev_bajista = maxScore(ag.filter((d) => d.side === 'bearish'));

  // Eventos de mercado confirmados durante la barra (disponibleEn dentro de (inicio, cierre]).
  const eventos: EventoMotor[] = mercado.eventosDisponibles(b.cierre, b.inicio);
  const sumar = (tipo: EventoMotor['tipo'], lado: EventoMotor['lado'], campo: 'n' | 'magnitud') =>
    eventos.filter((e) => e.tipo === tipo && e.lado === lado).reduce((s, e) => s + (campo === 'n' ? 1 : e.magnitud), 0);
  v.bigtrades_compra_usd = sumar('bigtrade', 'compra', 'magnitud');
  v.bigtrades_venta_usd = sumar('bigtrade', 'venta', 'magnitud');
  v.icebergs_bid = sumar('iceberg', 'venta', 'n');
  v.icebergs_ask = sumar('iceberg', 'compra', 'n');
  v.stoprun_alto = sumar('stoprun', 'compra', 'n');
  v.stoprun_bajo = sumar('stoprun', 'venta', 'n');
  v.pools_barridos = eventos.filter((e) => e.tipo === 'pool-barrido').length;
  v.liq_largos_usd = sumar('liquidacion', 'venta', 'magnitud');
  v.liq_cortos_usd = sumar('liquidacion', 'compra', 'magnitud');
  v.funding_tasa = mercado.fundingTasa;

  // Open Interest: motor de Urus sobre una ventana ACOTADA de barras (Urus recalculaba toda la historia).
  let puntoOi: OpenInterestCandlePoint | null = null;
  if (mercado.oi.tamaño > 0) {
    const velas = [...previas.slice(-119), b].map((x) => ({
      timestamp: x.inicio,
      closeTime: x.cierre,
      open: x.ohlc.open,
      high: x.ohlc.high,
      low: x.ohlc.low,
      close: x.ohlc.close,
      volume: x.volumen,
      delta: x.delta,
    }));
    const desde = velas[0].timestamp - 600_000;
    const snaps = mercado.oi.ultimos(mercado.oi.tamaño).filter((s) => s.time >= desde && s.time <= b.cierre);
    if (snaps.length > 0) {
      const res = computeOpenInterest(velas, snaps, { nowMs: b.cierre, pollIntervalMs: 5_000 });
      puntoOi = res.points[res.points.length - 1] ?? null;
    }
  }
  v.oi_delta_pct = puntoOi?.deltaOiPct ?? null;
  v.oi_delta_z = puntoOi?.deltaOiPctZ ?? null;
  v.oi_cuadrante = puntoOi?.quadrant ? CUADRANTE[puntoOi.quadrant] ?? 0 : null;
  v.oi_flush = puntoOi ? (puntoOi.flush ? 1 : 0) : null;

  const libro = mercado.libro;
  if (libro && libro.bids.length && libro.asks.length) {
    v.obi_10 = computeObi(libro.bids, libro.asks, 10);
    const mp = computeMicroPrice({ bidPrice: libro.bids[0][0], bidQty: libro.bids[0][1], askPrice: libro.asks[0][0], askQty: libro.asks[0][1] });
    v.microprice_ticks = mp !== null && libro.mid !== null ? (mp - libro.mid) / libro.tickSize : null;
  } else {
    v.obi_10 = null;
    v.microprice_ticks = null;
  }

  const pools = mercado.poolsVivos();
  const asks = pools.filter((p) => p.side === 'ask' && p.price > close).map((p) => p.price - close);
  const bids = pools.filter((p) => p.side === 'bid' && p.price < close).map((p) => close - p.price);
  v.pool_ask_dist_atr = a && asks.length ? Math.min(...asks) / a : null;
  v.pool_bid_dist_atr = a && bids.length ? Math.min(...bids) / a : null;

  for (const k of Object.keys(v)) {
    const x = v[k];
    if (x !== null && !Number.isFinite(x)) v[k] = null;
  }
  return { fila: { n: b.n, inicio: b.inicio, cierre: b.cierre, close, high, low, valores: v }, oi: puntoOi };
}

/** Número sin ruido de coma flotante (10 cifras significativas); vacío si no hay dato. */
const limpiar = (x: number | null | undefined) => (x === null || x === undefined ? '' : Number(x.toPrecision(10)));

/** CSV con cabecera estable (orden del catálogo). Listo para entrenar fuera del navegador. */
export function filasACsv(filas: readonly FilaFeatures[]): string {
  const claves = DEFINICIONES_FEATURES.map((d) => d.clave);
  const cab = ['n', 'inicio_utc', 'cierre_utc', 'close', ...claves].join(',');
  const lineas = filas.map((f) =>
    [f.n, new Date(f.inicio).toISOString(), new Date(f.cierre).toISOString(), f.close, ...claves.map((k) => limpiar(f.valores[k]))].join(','),
  );
  return [cab, ...lineas].join('\n');
}
