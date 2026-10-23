// Catálogo de Features que aprenden los modelos y su cálculo por barra canónica.
// Regla de oro: una fila se construye en el instante del CIERRE de la barra con información disponible hasta
// ese instante. Nada calculado después (p. ej. el agotamiento de esta misma barra) entra en su fila.
import { computeOpenInterest, robustZ } from '../flujo/open-interest/engine';
import type { OpenInterestCandlePoint } from '../flujo/open-interest/types';
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
  { clave: 'dist_vwap_atr', nombre: 'Distancia al VWAP', grupo: 'Precio', motor: 'Flujo', descripcion: '(close − VWAP del día UTC) / ATR(14). Vacío si no se grabó el día desde las 00:00 UTC o faltó algún trade (resincronizar el libro no lo borra y un reinicio de menos de 1 min sigue con lo ya grabado)' },
  { clave: 'delta_z', nombre: 'Delta (z)', grupo: 'Flujo', motor: 'Footprint', descripcion: 'z robusto del delta de la barra frente a las 120 barras previas: 0,6745 × (delta − mediana) / MAD, recortado a ±10' },
  { clave: 'delta_ratio', nombre: 'Delta / volumen', grupo: 'Flujo', motor: 'Footprint', descripcion: 'Delta normalizado en [−1, 1]' },
  { clave: 'trades_rel', nombre: 'Trades relativos', grupo: 'Flujo', motor: 'Barras', descripcion: 'Número de trades / media de las 20 barras previas' },
  { clave: 'duracion_z', nombre: 'Duración (z)', grupo: 'Flujo', motor: 'Barras', descripcion: 'z robusto de log(segundos que tardó la barra) frente a las 120 previas: < 0 = más rápido de lo normal' },
  { clave: 'cvd_sesion_ratio', nombre: 'CVD de sesión / volumen', grupo: 'Flujo', motor: 'CVD de sesión', descripcion: 'CVD de la sesión / volumen negociado en la sesión, en [−1, 1]. Vacío si no se vio la sesión desde su inicio o faltó algún trade (las reconexiones recuperan los perdidos, resincronizar el libro no lo afecta y un reinicio de menos de 1 min sigue con lo ya grabado)' },
  { clave: 'flujo_5_ratio', nombre: 'Flujo de 5 barras', grupo: 'Flujo', motor: 'CVD de sesión', descripcion: 'Σ delta / Σ volumen de las 5 últimas barras, en [−1, 1]' },
  { clave: 'imb_compra_frac', nombre: 'Imbalances compradores', grupo: 'Footprint', motor: 'Microestructura', descripcion: 'Niveles con imbalance diagonal comprador ≥ 3:1 / niveles de la barra (0–1)' },
  { clave: 'imb_venta_frac', nombre: 'Imbalances vendedores', grupo: 'Footprint', motor: 'Microestructura', descripcion: 'Niveles con imbalance diagonal vendedor ≥ 3:1 / niveles de la barra (0–1)' },
  { clave: 'stacked_compra', nombre: 'Stacked compradores', grupo: 'Footprint', motor: 'Microestructura', descripcion: 'Rachas de ≥ 3 imbalances compradores consecutivos' },
  { clave: 'stacked_venta', nombre: 'Stacked vendedores', grupo: 'Footprint', motor: 'Microestructura', descripcion: 'Rachas de ≥ 3 imbalances vendedores consecutivos' },
  { clave: 'poc_pos', nombre: 'Posición del POC', grupo: 'Footprint', motor: 'Footprint', descripcion: 'POC dentro del rango de la barra (0 = low, 1 = high)' },
  { clave: 'delta_poc_pos', nombre: 'Posición del delta-POC', grupo: 'Footprint', motor: 'Microestructura', descripcion: 'Nivel de mayor |delta| dentro del rango (0–1)' },
  { clave: 'absorcion_ask', nombre: 'Absorción en el ask', grupo: 'Absorción / Agotamiento', motor: 'Absorción', descripcion: 'Score máximo (0–100) de compradores agresivos absorbidos' },
  { clave: 'absorcion_bid', nombre: 'Absorción en el bid', grupo: 'Absorción / Agotamiento', motor: 'Absorción', descripcion: 'Score máximo (0–100) de vendedores agresivos absorbidos' },
  { clave: 'agotamiento_prev_alcista', nombre: 'Agotamiento alcista (barra previa)', grupo: 'Absorción / Agotamiento', motor: 'Agotamiento', descripcion: 'Score del agotamiento comprador de la barra anterior, confirmado al cierre de esta' },
  { clave: 'agotamiento_prev_bajista', nombre: 'Agotamiento bajista (barra previa)', grupo: 'Absorción / Agotamiento', motor: 'Agotamiento', descripcion: 'Score del agotamiento vendedor de la barra anterior, confirmado al cierre de esta' },
  { clave: 'bigtrades_compra_frac', nombre: 'Big trades compradores', grupo: 'Big trades', motor: 'Big trades', descripcion: 'Nocional de bloques compradores grandes / nocional de la barra' },
  { clave: 'bigtrades_venta_frac', nombre: 'Big trades vendedores', grupo: 'Big trades', motor: 'Big trades', descripcion: 'Nocional de bloques vendedores grandes / nocional de la barra' },
  { clave: 'icebergs_bid', nombre: 'Icebergs en el bid', grupo: 'Icebergs / Stop runs', motor: 'Icebergs', descripcion: 'Icebergs compradores confirmados durante la barra' },
  { clave: 'icebergs_ask', nombre: 'Icebergs en el ask', grupo: 'Icebergs / Stop runs', motor: 'Icebergs', descripcion: 'Icebergs vendedores confirmados durante la barra' },
  { clave: 'stoprun_alto', nombre: 'Stop run de máximos', grupo: 'Icebergs / Stop runs', motor: 'Stop runs', descripcion: 'Barridos de máximos confirmados durante la barra' },
  { clave: 'stoprun_bajo', nombre: 'Stop run de mínimos', grupo: 'Icebergs / Stop runs', motor: 'Stop runs', descripcion: 'Barridos de mínimos confirmados durante la barra' },
  { clave: 'liq_largos_frac', nombre: 'Liquidaciones de largos', grupo: 'Open Interest', motor: 'Binance forceOrder', descripcion: 'Nocional de largos liquidados durante la barra / nocional de la barra (presión vendedora forzada)' },
  { clave: 'liq_cortos_frac', nombre: 'Liquidaciones de cortos', grupo: 'Open Interest', motor: 'Binance forceOrder', descripcion: 'Nocional de cortos liquidados durante la barra / nocional de la barra (presión compradora forzada)' },
  { clave: 'funding_tasa', nombre: 'Funding', grupo: 'Open Interest', motor: 'Binance markPrice', descripcion: 'Tasa de funding vigente al cierre de la barra (se cobra o paga cada 8 h; positiva = los largos pagan a los cortos)' },
  { clave: 'oi_delta_pct', nombre: 'ΔOI %', grupo: 'Open Interest', motor: 'Open Interest', descripcion: 'Cambio porcentual del interés abierto en la barra' },
  { clave: 'oi_delta_z', nombre: 'ΔOI z robusto', grupo: 'Open Interest', motor: 'Open Interest', descripcion: 'z-score robusto (mediana/MAD) del ΔOI' },
  { clave: 'oi_cuadrante', nombre: 'Cuadrante precio/OI', grupo: 'Open Interest', motor: 'Open Interest', descripcion: '1 longs nuevos · 2 cobertura shorts · 3 shorts nuevos · 4 liquidación longs · 0 neutral' },
  { clave: 'oi_flush', nombre: 'Flush de OI', grupo: 'Open Interest', motor: 'Open Interest', descripcion: '1 si hubo cierre masivo de posiciones con movimiento y volumen' },
  { clave: 'obi_10', nombre: 'OBI (10 niveles)', grupo: 'Libro (DOM)', motor: 'Libro', descripcion: '(Σ bid − Σ ask) / (Σ bid + Σ ask) de los 10 primeros niveles del libro (agrupado, ≈ 1 USD en BTC), en [−1, 1]' },
  { clave: 'microprice_spread', nombre: 'MicroPrice / spread', grupo: 'Libro (DOM)', motor: 'Libro', descripcion: '(MicroPrice − precio medio) / (spread / 2), en [−1, 1]: > 0 = presión compradora en el primer nivel' },
  { clave: 'pool_ask_dist_atr', nombre: 'Pool ask más cercano', grupo: 'Liquidez (LHM)', motor: 'Pools de liquidez', descripcion: 'Distancia al pool vendedor más cercano / ATR' },
  { clave: 'pool_bid_dist_atr', nombre: 'Pool bid más cercano', grupo: 'Liquidez (LHM)', motor: 'Pools de liquidez', descripcion: 'Distancia al pool comprador más cercano / ATR' },
  { clave: 'pools_barridos', nombre: 'Pools barridos', grupo: 'Liquidez (LHM)', motor: 'Pools de liquidez', descripcion: 'Pools de liquidez absorbidos por el precio durante la barra' },
  { clave: 'ventana_evento', nombre: 'Ventana de evento fuerte', grupo: 'Contexto', motor: 'Calendario', descripcion: '1 si la barra cierra dentro de la ventana de un evento de alto impacto (FOMC, CPI…): zona de no operar' },
  { clave: 'hueco', nombre: 'Hueco de datos', grupo: 'Calidad de datos', motor: 'Vigía', descripcion: '1 si durante la barra se cortó la conexión, se resincronizó el libro o faltaron trades: no entrenar con esta fila sin revisarla' },
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
  /**
   * Apertura, volumen y delta (en la unidad del activo) de la barra: SOLO para dibujar la vela grabada en el gráfico.
   * No son Features (tienen escala) y no existen en filas grabadas antes de guardarlos.
   */
  open?: number;
  volumen?: number;
  delta?: number;
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
/** Posición en [0, 1] del CENTRO de un nivel del footprint (el precio del nivel es el borde de abajo de su cubeta). */
function posicionNivel(precio: number | null, b: BarraAnalizada, low: number, high: number): number | null {
  const ps = b.footprint.levels.map((l) => l.price).sort((x, y) => x - y);
  const paso = ps.slice(1).reduce((m, p, i) => Math.min(m, p - ps[i]), Infinity);
  const x = posicion(precio === null ? null : precio + (Number.isFinite(paso) ? paso / 2 : 0), low, high);
  return x === null ? null : Math.min(1, Math.max(0, x));
}

/** División segura: null si el divisor es ~0 o algo no es finito (nunca NaN ni ±∞). */
export function div(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < 1e-12) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

/** Barras previas que forman la ventana de los z robustos, y mínimo para que el z tenga sentido. */
export const VENTANA_Z = 120;
export const MIN_Z = 30;
const TOPE_Z = 10;

/**
 * z robusto de `x` frente a la ventana de valores PREVIOS (nunca incluye la barra actual ni el futuro):
 * z = 0,6745 × (x − mediana) / MAD, recortado a ±10. null con menos de MIN_Z valores.
 */
export function zMovil(x: number | null, previos: readonly number[]): number | null {
  if (x === null || !Number.isFinite(x)) return null;
  const v = previos.filter(Number.isFinite).slice(-VENTANA_Z);
  if (v.length < MIN_Z) return null;
  const z = robustZ(x, v);
  return z === null ? null : Math.max(-TOPE_Z, Math.min(TOPE_Z, z));
}

const logDuracion = (x: { inicio: number; cierre: number }) => Math.log(Math.max(0.001, (x.cierre - x.inicio) / 1000));

/**
 * Construye la fila de la barra `b` (recién cerrada). `previas` son las barras canónicas anteriores.
 */
export function construirFila(b: BarraAnalizada, previas: readonly BarraAnalizada[], mercado: MotorMercado): { fila: FilaFeatures; oi: OpenInterestCandlePoint | null } {
  const v: Record<string, number | null> = {};
  const a = atr(previas);
  const { open, high, low, close } = b.ohlc;

  // Todas las Features son independientes de la escala (precio, tamaño de barra, hora): ratios, fracciones o
  // z robustos con barras previas. Así el modelo no aprende «BTC a 85.000» ni «barras de 10 M».
  const proporcion = open > 0 ? div(close, open) : null;
  v.retorno = proporcion === null ? null : proporcion - 1;
  v.rango_atr = div(high - low, a);
  v.dist_vwap_atr = mercado.vwapSesion !== null && mercado.vwapCompleto ? div(close - mercado.vwapSesion, a) : null;
  const ventana = previas.slice(-VENTANA_Z);
  v.delta_z = zMovil(b.delta, ventana.map((x) => x.delta));
  v.delta_ratio = div(b.delta, b.volumen);
  const ult20 = previas.slice(-20);
  v.trades_rel = ult20.length ? div(b.trades, ult20.reduce((s, x) => s + x.trades, 0) / ult20.length) : null;
  v.duracion_z = zMovil(logDuracion(b), ventana.map(logDuracion));
  v.cvd_sesion_ratio = mercado.cvdCompleto && mercado.cvdActivo ? div(mercado.cvdSesion, mercado.cvdVolumenSesion) : null;
  // Flujo de 5 barras = Σ delta / Σ volumen (esta y las 4 anteriores).
  const cinco = previas.length >= 4 ? [...previas.slice(-4), b] : null;
  v.flujo_5_ratio = cinco ? div(cinco.reduce((s, x) => s + x.delta, 0), cinco.reduce((s, x) => s + x.volumen, 0)) : null;

  const sen = b.senales;
  const niveles = sen.levels.length;
  v.imb_compra_frac = div(sen.levels.filter((l) => l.buyingImbalance).length, niveles);
  v.imb_venta_frac = div(sen.levels.filter((l) => l.sellingImbalance).length, niveles);
  v.stacked_compra = sen.stackedImbalances.filter((s) => s.direction === 'buying').length;
  v.stacked_venta = sen.stackedImbalances.filter((s) => s.direction === 'selling').length;
  v.poc_pos = posicionNivel(b.footprint.pocPrice, b, low, high);
  v.delta_poc_pos = posicionNivel(sen.deltaPocPrice, b, low, high);

  const maxScore = (xs: { absorptionScore?: number; exhaustionScore?: number }[]) => (xs.length ? Math.max(...xs.map((x) => x.absorptionScore ?? x.exhaustionScore ?? 0)) : 0);
  v.absorcion_ask = maxScore(b.absorcion.filter((d) => d.side === 'ask'));
  v.absorcion_bid = maxScore(b.absorcion.filter((d) => d.side === 'bid'));
  // Agotamiento de la barra ANTERIOR: se acaba de confirmar con el cierre de ésta.
  const prev = previas[previas.length - 1];
  const ag = prev?.agotamiento ?? [];
  v.agotamiento_prev_alcista = maxScore(ag.filter((d) => d.side === 'bullish'));
  v.agotamiento_prev_bajista = maxScore(ag.filter((d) => d.side === 'bearish'));

  // Eventos de mercado conocidos desde el cierre de la barra anterior hasta el de ésta: (cierre previo, cierre].
  const eventos: EventoMotor[] = mercado.eventosDisponibles(b.cierre, prev?.cierre ?? b.inicio - 1);
  const sumar = (tipo: EventoMotor['tipo'], lado: EventoMotor['lado'], campo: 'n' | 'magnitud') =>
    eventos.filter((e) => e.tipo === tipo && e.lado === lado).reduce((s, e) => s + (campo === 'n' ? 1 : e.magnitud), 0);
  // Montos en USD → fracción del nocional de la barra (una barra de 10 M con 2 M de big trades = 0,2).
  v.bigtrades_compra_frac = div(sumar('bigtrade', 'compra', 'magnitud'), b.nocional);
  v.bigtrades_venta_frac = div(sumar('bigtrade', 'venta', 'magnitud'), b.nocional);
  v.icebergs_bid = sumar('iceberg', 'venta', 'n');
  v.icebergs_ask = sumar('iceberg', 'compra', 'n');
  v.stoprun_alto = sumar('stoprun', 'compra', 'n');
  v.stoprun_bajo = sumar('stoprun', 'venta', 'n');
  v.pools_barridos = eventos.filter((e) => e.tipo === 'pool-barrido').length;
  v.liq_largos_frac = div(sumar('liquidacion', 'venta', 'magnitud'), b.nocional);
  v.liq_cortos_frac = div(sumar('liquidacion', 'compra', 'magnitud'), b.nocional);
  v.funding_tasa = mercado.fundingEn(b.cierre);

  // Open Interest sobre una ventana ACOTADA de barras (no se recalcula toda la historia).
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
  // OI viejo (el sondeo se cortó) o justo después de un hueco: sin dato, en vez de un ΔOI falso de 0 o de golpe.
  if (puntoOi?.stale || puntoOi?.gap) puntoOi = null;
  v.oi_delta_pct = puntoOi?.deltaOiPct ?? null;
  v.oi_delta_z = puntoOi?.deltaOiPctZ ?? null;
  v.oi_cuadrante = puntoOi?.quadrant ? CUADRANTE[puntoOi.quadrant] ?? 0 : null;
  v.oi_flush = puntoOi ? (puntoOi.flush ? 1 : 0) : null;

  // El libro y los pools vigentes al cierre de la barra (nunca una foto posterior ni una de hace más de 2 s).
  const foto = mercado.libroEn(b.cierre);
  const libro = foto?.vista;
  if (libro && libro.bids.length && libro.asks.length) {
    // Los calcula el motor del libro (un solo cálculo): OBI sobre los niveles de la vista, MicroPrice con el
    // mejor bid y ask reales (no con los niveles agrupados, que lo desplazaban hasta un grupo entero).
    v.obi_10 = libro.obi?.n10 ?? null;
    // (MicroPrice − mid) / (spread / 2): −1 = toda la presión en el bid, +1 = en el ask. Sin depender del tick.
    v.microprice_spread = libro.microPrice != null && libro.mid !== null && libro.spread !== null ? div(libro.microPrice - libro.mid, libro.spread / 2) : null;
  } else {
    v.obi_10 = null;
    v.microprice_spread = null;
  }

  const pools = foto?.pools ?? [];
  const asks = pools.filter((p) => p.side === 'ask' && p.price > close).map((p) => p.price - close);
  const bids = pools.filter((p) => p.side === 'bid' && p.price < close).map((p) => close - p.price);
  v.pool_ask_dist_atr = foto && asks.length ? div(Math.min(...asks), a) : null;
  v.pool_bid_dist_atr = foto && bids.length ? div(Math.min(...bids), a) : null;

  for (const k of Object.keys(v)) {
    const x = v[k];
    if (x !== null && !Number.isFinite(x)) v[k] = null;
  }
  return { fila: { n: b.n, inicio: b.inicio, cierre: b.cierre, close, high, low, open: b.ohlc.open, volumen: b.volumen, delta: b.delta, valores: v }, oi: puntoOi };
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
