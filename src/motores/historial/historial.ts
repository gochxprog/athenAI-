// Historial del gráfico: velas anteriores a lo que el motor vio en vivo desde que se abrió la página.
//   Velas de tiempo (1m / 5m / 15m) → Binance REST /fapi/v1/klines (historia oficial, con volumen y compras agresivas).
//   Dollar Bars                       → lo grabado (grabadora 24/7 del VPS o este navegador), mismo mercado.
// Solo sirve para DIBUJAR: no alimenta ninguna Feature, ni el Juez, ni los bots. Footprint, absorción, eventos y
// heatmap solo existen en vivo (grabarlos ocuparía muchísimo).
import type { BarraGrafico } from '@/motores/nucleo/pipeline';
import type { FilaFeatures } from '@/motores/nucleo/features';

/** Fila de /fapi/v1/klines: [apertura, o, h, l, c, volumen, cierre, nocional, trades, compraAgresiva, compraAgresivaUsd, _]. */
export type KlineBinance = [number, string, string, string, string, string, number, string, number, string, string, string];

export const INTERVALO_BINANCE = { '1m': '1m', '5m': '5m', '15m': '15m' } as const;
export type TemporalidadTiempo = keyof typeof INTERVALO_BINANCE;
/** Máximo de velas por petición que acepta Binance. */
export const LIMITE_KLINES = 1500;

const vacia = (): Pick<BarraGrafico, 'poc' | 'absorcion' | 'agotamiento' | 'oi'> => ({ poc: null, absorcion: [], agotamiento: null, oi: null });

/**
 * Klines de Binance → velas del gráfico. Delta = compras agresivas − ventas agresivas = 2 × compraAgresiva − volumen.
 * `ahora` marca como incompleta la vela que todavía no cerró.
 */
export function velasDeKlines(ks: readonly KlineBinance[], ahora = Date.now()): BarraGrafico[] {
  const out: BarraGrafico[] = [];
  for (const k of ks) {
    const [t, o, h, l, c, v] = [k[0], Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4]), Number(k[5])];
    const compra = Number(k[9]);
    if (![t, o, h, l, c, v, compra].every(Number.isFinite)) continue;
    out.push({ n: -1, t, fin: k[6] + 1, o, h, l, c, v, d: 2 * compra - v, completa: k[6] < ahora, cvd: 0, ...vacia() });
  }
  return conCvdDiario(out);
}

/**
 * Filas grabadas (dollar bars) → velas. La apertura sale de la fila (desde que se graba), o de `retorno`
 * (close / open − 1), o del cierre anterior. Volumen y delta solo existen en filas grabadas desde que se guardan.
 */
export function velasDeFilas(filas: readonly FilaFeatures[]): BarraGrafico[] {
  const out: BarraGrafico[] = [];
  let previo: number | null = null;
  for (const f of filas) {
    if (!(f.close > 0)) continue;
    const r = f.valores?.retorno;
    const o = f.open ?? (r !== null && r !== undefined && Number.isFinite(r) && r > -1 ? f.close / (1 + r) : (previo ?? f.close));
    const h = Math.max(f.high ?? -Infinity, o, f.close);
    const l = Math.min(f.low ?? Infinity, o, f.close);
    out.push({ n: -1, t: f.inicio, fin: f.cierre, o, h, l, c: f.close, v: f.volumen ?? 0, d: f.delta ?? 0, completa: true, cvd: 0, ...vacia() });
    previo = f.close;
  }
  return conCvdDiario(out);
}

/** CVD como en vivo: suma de deltas desde las 00:00 UTC del día de cada vela. */
export function conCvdDiario(barras: BarraGrafico[]): BarraGrafico[] {
  let dia = -1;
  let acum = 0;
  for (const b of barras) {
    const d = Math.floor(b.t / 86_400_000);
    if (d !== dia) {
      dia = d;
      acum = 0;
    }
    acum += b.d;
    b.cvd = acum;
  }
  return barras;
}

/**
 * Pega el historial delante de lo vivo: solo velas que empiezan antes de la primera vela viva (lo vivo manda).
 * El CVD vivo empieza en 0 al abrir la página; si la primera vela viva es del mismo día que el historial,
 * se desplaza para que la línea siga desde el CVD del historial (las velas vivas no se modifican: se copian).
 */
export function unirConVivo(historial: readonly BarraGrafico[], vivas: readonly BarraGrafico[]): BarraGrafico[] {
  if (!historial.length) return vivas as BarraGrafico[];
  if (!vivas.length) return historial as BarraGrafico[];
  const t0 = vivas[0].t;
  const previas = historial.filter((b) => b.t < t0);
  if (!previas.length) return vivas as BarraGrafico[];
  const ultima = previas[previas.length - 1];
  const dia = Math.floor(ultima.t / 86_400_000);
  const base = vivas[0].cvd - vivas[0].d;
  const ajuste = ultima.cvd - base;
  const ajustadas = vivas.map((b) => (Math.floor(b.t / 86_400_000) === dia ? { ...b, cvd: b.cvd + ajuste } : b));
  return [...previas, ...ajustadas];
}

/** Une dos tandas de historial (una más antigua) sin repetir velas. */
export function anteponer(antiguas: readonly BarraGrafico[], actuales: readonly BarraGrafico[]): BarraGrafico[] {
  if (!actuales.length) return conCvdDiario([...antiguas]);
  const t0 = actuales[0].t;
  return conCvdDiario([...antiguas.filter((b) => b.t < t0), ...actuales].map((b) => ({ ...b })));
}

/** Pide klines a Binance (como mucho 1.500) que cierran antes de `hasta` (o las últimas). */
export async function pedirKlines(rest: string, simbolo: string, temporalidad: TemporalidadTiempo, hasta: number | null, limite = LIMITE_KLINES, fetchImpl: typeof fetch = fetch): Promise<KlineBinance[]> {
  const base = rest.replace(/\/+$/, '');
  const url = `${base}/fapi/v1/klines?symbol=${encodeURIComponent(simbolo)}&interval=${INTERVALO_BINANCE[temporalidad]}&limit=${Math.min(LIMITE_KLINES, Math.max(1, limite))}${hasta !== null ? `&endTime=${hasta}` : ''}`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`Binance respondió ${r.status} al pedir el historial`);
  const x = (await r.json()) as unknown;
  return Array.isArray(x) ? (x as KlineBinance[]) : [];
}
