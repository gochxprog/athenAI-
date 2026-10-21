// Motor Etiquetador: triple barrera + filtro CUSUM + meta-etiquetado (López de Prado, AFML cap. 2–3).
// Convierte la historia grabada en ejemplos de entrenamiento: «en este momento pasó algo; ¿qué pasó después?».
//
// Notación por barra t: C_t cierre, H_t máximo, L_t mínimo, r_t = C_t / C_{t−1} − 1.
//
// σ_t (volatilidad local): desviación estándar EXPONENCIAL de r con lapso `span` (EWMA), solo con r_1 … r_t.
//
// A. Filtro CUSUM simétrico (eventos): E[r] = media exponencial de r hasta t−1 (solo pasado).
//    S⁺_t = máx(0, S⁺_{t−1} + r_t − E[r])      S⁻_t = mín(0, S⁻_{t−1} + r_t − E[r])
//    Umbral h_t = cusumMult · σ_t. Si S⁺_t > h_t → evento con lado +1; si S⁻_t < −h_t → evento con lado −1.
//    En cada evento se reinician S⁺ y S⁻ a 0. (Así se muestrea más cuando el mercado se mueve y menos cuando
//    está plano.)
// B. Barreras desde el evento t₀ (precio inicial P₀ = C_{t₀}, σ₀ = σ_{t₀}):
//    superior = P₀ · (1 + pt · σ₀)     inferior = P₀ · (1 − sl · σ₀)     vertical = t₀ + tMax barras
// C. Etiqueta: se recorren las barras t₀+1 … t₀+tMax y gana la PRIMERA barrera tocada:
//    H_t ≥ superior → toca arriba;  L_t ≤ inferior → toca abajo;  llega a la vertical → tiempo.
//    Si en la misma barra se tocan las dos, se cuenta la inferior (no se puede saber cuál fue primero:
//    se elige el caso pesimista). Sin H/L (filas grabadas antes de guardarlos) se usa el cierre.
//    Etiqueta según el lado del evento: arriba = +1 si largo / −1 si corto; abajo = −1 si largo / +1 si corto;
//    tiempo = 0.
// D. Meta-etiqueta: y_meta = 1 si la etiqueta es +1 (la señal acertó: operar); 0 si es −1 o 0 (no operar).
// Un evento cuyo recorrido cruza un hueco de datos se descarta (no se aprende de datos rotos).
import type { MercadoId } from '@/motores/mercado/mercadoId';
import type { FilaFeatures } from '../nucleo/features';

export interface ConfigEtiquetador {
  /** Multiplicador de σ para la barrera superior (take profit). */
  pt?: number;
  /** Multiplicador de σ para la barrera inferior (stop loss). */
  sl?: number;
  /** Barrera vertical en barras. */
  tMax?: number;
  /** Umbral CUSUM en múltiplos de σ. */
  cusumMult?: number;
  /** Lapso de la media y la desviación exponenciales (barras). */
  span?: number;
}

export const ETIQUETADOR_POR_DEFECTO = { pt: 2, sl: 2, tMax: 50, cusumMult: 1, span: 100 };

export type Barrera = 'superior' | 'inferior' | 'tiempo';

export interface Etiqueta {
  /** Índice de la barra del evento (t₀) y de salida (t₁). */
  t0: number;
  t1: number;
  /** Cierre (ms) de esas barras. */
  inicio: number;
  fin: number;
  lado: 1 | -1;
  precio: number;
  sigma: number;
  superior: number;
  inferior: number;
  barrera: Barrera;
  etiqueta: -1 | 0 | 1;
  meta: 0 | 1;
  /** Retorno en la dirección del lado entre t₀ y t₁. */
  retorno: number;
  barras: number;
}

export interface ResultadoEtiquetador {
  config: typeof ETIQUETADOR_POR_DEFECTO;
  etiquetas: Etiqueta[];
  barras: number;
  /** Eventos descartados por cruzar un hueco o por no tener tMax barras por delante. */
  descartadosHueco: number;
  sinFuturo: number;
  /** Las filas tienen máximo y mínimo (si no, se usó el cierre). */
  conHighLow: boolean;
  resumen: { positivas: number; negativas: number; neutras: number; largos: number; cortos: number; duracionMedia: number };
}

type Fila = Pick<FilaFeatures, 'cierre' | 'close' | 'high' | 'low'> & { valores?: Record<string, number | null> };

/** σ_t exponencial de los retornos (solo pasado e incluida la barra t). Devuelve también E[r] hasta t−1. */
export function volatilidadEwm(cierres: readonly number[], span: number): { sigma: number[]; mediaPrevia: number[] } {
  const a = 2 / (span + 1);
  const sigma = new Array(cierres.length).fill(NaN);
  const mediaPrevia = new Array(cierres.length).fill(0);
  let media = 0;
  let varianza = 0;
  let n = 0;
  for (let t = 1; t < cierres.length; t += 1) {
    const r = cierres[t - 1] > 0 ? cierres[t] / cierres[t - 1] - 1 : 0;
    mediaPrevia[t] = media;
    if (n === 0) {
      media = r;
      varianza = 0;
    } else {
      const d = r - media;
      media += a * d;
      varianza = (1 - a) * (varianza + a * d * d);
    }
    n += 1;
    sigma[t] = n >= Math.min(20, span) ? Math.sqrt(varianza) : NaN;
  }
  return { sigma, mediaPrevia };
}

/** Filtro CUSUM simétrico: índices de evento y su lado. `huecos[t]` reinicia la suma (no se suma a través de cortes). */
export function filtroCusum(cierres: readonly number[], sigma: readonly number[], mediaPrevia: readonly number[], mult: number, huecos?: readonly boolean[]): { t: number; lado: 1 | -1 }[] {
  const eventos: { t: number; lado: 1 | -1 }[] = [];
  let sPos = 0;
  let sNeg = 0;
  for (let t = 1; t < cierres.length; t += 1) {
    if (huecos?.[t]) {
      sPos = 0;
      sNeg = 0;
      continue;
    }
    if (!Number.isFinite(sigma[t]) || sigma[t] <= 0) continue;
    const r = cierres[t - 1] > 0 ? cierres[t] / cierres[t - 1] - 1 : 0;
    sPos = Math.max(0, sPos + r - mediaPrevia[t]);
    sNeg = Math.min(0, sNeg + r - mediaPrevia[t]);
    const h = mult * sigma[t];
    if (sPos > h) {
      eventos.push({ t, lado: 1 });
      sPos = 0;
      sNeg = 0;
    } else if (sNeg < -h) {
      eventos.push({ t, lado: -1 });
      sPos = 0;
      sNeg = 0;
    }
  }
  return eventos;
}

/** Triple barrera de un evento. Null si cruza un hueco o no hay barras por delante. */
export function tripleBarrera(filas: readonly Fila[], t0: number, lado: 1 | -1, sigma: number, c: { pt: number; sl: number; tMax: number }, huecos?: readonly boolean[]): Etiqueta | 'hueco' | null {
  const p0 = filas[t0].close;
  const superior = p0 * (1 + c.pt * sigma);
  const inferior = p0 * (1 - c.sl * sigma);
  const fin = Math.min(filas.length - 1, t0 + c.tMax);
  if (fin <= t0) return null;
  let barrera: Barrera = 'tiempo';
  let t1 = fin;
  for (let t = t0 + 1; t <= fin; t += 1) {
    if (huecos?.[t]) return 'hueco';
    const f = filas[t];
    const alto = f.high ?? f.close;
    const bajo = f.low ?? f.close;
    const tocaAbajo = bajo <= inferior;
    const tocaArriba = alto >= superior;
    if (tocaAbajo || tocaArriba) {
      barrera = tocaAbajo ? 'inferior' : 'superior';
      t1 = t;
      break;
    }
  }
  if (barrera === 'tiempo' && t0 + c.tMax > filas.length - 1) return null;
  const etiqueta: -1 | 0 | 1 = barrera === 'tiempo' ? 0 : (barrera === 'superior') === (lado === 1) ? 1 : -1;
  const salida = barrera === 'superior' ? superior : barrera === 'inferior' ? inferior : filas[t1].close;
  return {
    t0,
    t1,
    inicio: filas[t0].cierre,
    fin: filas[t1].cierre,
    lado,
    precio: p0,
    sigma,
    superior,
    inferior,
    barrera,
    etiqueta,
    meta: etiqueta === 1 ? 1 : 0,
    retorno: lado * (salida / p0 - 1),
    barras: t1 - t0,
  };
}

export function etiquetar(filas: readonly Fila[], config: ConfigEtiquetador = {}, huecos?: readonly boolean[]): ResultadoEtiquetador {
  const c = { ...ETIQUETADOR_POR_DEFECTO, ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined && v !== 0)) } as typeof ETIQUETADOR_POR_DEFECTO;
  const cierres = filas.map((f) => f.close);
  const { sigma, mediaPrevia } = volatilidadEwm(cierres, c.span);
  const eventos = filtroCusum(cierres, sigma, mediaPrevia, c.cusumMult, huecos);
  const etiquetas: Etiqueta[] = [];
  let descartadosHueco = 0;
  let sinFuturo = 0;
  for (const e of eventos) {
    const x = tripleBarrera(filas, e.t, e.lado, sigma[e.t], c, huecos);
    if (x === 'hueco') descartadosHueco += 1;
    else if (x === null) sinFuturo += 1;
    else etiquetas.push(x);
  }
  const cuenta = (f: (x: Etiqueta) => boolean) => etiquetas.filter(f).length;
  return {
    config: c,
    etiquetas,
    barras: filas.length,
    descartadosHueco,
    sinFuturo,
    conHighLow: filas.length > 0 && filas.every((f) => f.high !== undefined && f.low !== undefined),
    resumen: {
      positivas: cuenta((x) => x.etiqueta === 1),
      negativas: cuenta((x) => x.etiqueta === -1),
      neutras: cuenta((x) => x.etiqueta === 0),
      largos: cuenta((x) => x.lado === 1),
      cortos: cuenta((x) => x.lado === -1),
      duracionMedia: etiquetas.length ? etiquetas.reduce((a, x) => a + x.barras, 0) / etiquetas.length : 0,
    },
  };
}

/** Dataset de entrenamiento: Features de la barra t₀ + etiqueta + meta-etiqueta (CSV). */
/** `mercado` (market_id) va en cada fila: el dataset de un mercado nunca se mezcla con el de otro. */
export function datasetCsv(filas: readonly Fila[], r: ResultadoEtiquetador, mercado: MercadoId): string {
  const claves = [...new Set(r.etiquetas.flatMap((e) => Object.keys(filas[e.t0].valores ?? {})))];
  // Las columnas del evento llevan prefijo para no chocar con Features del mismo nombre (p. ej. «retorno»).
  const cab = ['market_id', 'evento_inicio', 'evento_fin', 'evento_lado', 'evento_precio', 'evento_sigma', 'evento_barrera', 'etiqueta', 'meta', 'evento_retorno', 'evento_barras', ...claves];
  const filasCsv = r.etiquetas.map((e) => [mercado, new Date(e.inicio).toISOString(), new Date(e.fin).toISOString(), e.lado, e.precio, e.sigma, e.barrera, e.etiqueta, e.meta, e.retorno, e.barras, ...claves.map((k) => filas[e.t0].valores?.[k] ?? '')].join(','));
  return [cab.join(','), ...filasCsv].join('\n');
}
