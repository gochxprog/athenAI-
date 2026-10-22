// Velas completas para el Laboratorio: las filas grabadas (una por dollar bar) se juntan en velas de tiempo
// (1m, 5m, 15m, 1h, 4h) o se dejan como dollar bars. Cada vela trae apertura, máximo, mínimo, cierre, volumen y
// delta, y las Features de su ÚLTIMA fila (lo que se sabía al cerrar la vela: sin mirar al futuro).
import type { FilaFeatures } from '../nucleo/features';

export type Serie = 'dollar' | '1m' | '5m' | '15m' | '1h' | '4h';
export const SERIES: readonly Serie[] = ['dollar', '1m', '5m', '15m', '1h', '4h'];
/** Vela armada: una fila con apertura, máximo, mínimo, volumen y delta siempre presentes. */
export type VelaLab = FilaFeatures & Required<Pick<FilaFeatures, 'open' | 'high' | 'low' | 'volumen' | 'delta'>>;
const MS: Record<Exclude<Serie, 'dollar'>, number> = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };

/** Una fila como vela completa (las filas viejas sin apertura/máximo/mínimo usan el cierre). */
const comoVela = (f: FilaFeatures, n: number): VelaLab => ({
  ...f,
  n,
  open: f.open ?? f.close,
  high: f.high ?? f.close,
  low: f.low ?? f.close,
  volumen: f.volumen ?? 0,
  delta: f.delta ?? 0,
});

/**
 * Junta las filas (en orden de cierre) en velas de la serie pedida. Una fila va a la vela del instante en que quedó
 * disponible (su cierre). La vela cierra con su última fila: hora de cierre y Features de esa fila; `hueco` = 1 si
 * alguna de sus filas lo tuvo.
 */
export function armarVelas(filas: readonly FilaFeatures[], serie: Serie): VelaLab[] {
  if (serie === 'dollar') return filas.map(comoVela);
  const ms = MS[serie];
  const out: VelaLab[] = [];
  let actual: VelaLab | null = null;
  let balde = -1;
  for (const f of filas) {
    const b = Math.floor(f.cierre / ms);
    const v = comoVela(f, out.length);
    if (!actual || b !== balde) {
      if (actual) out.push(actual);
      actual = { ...v, n: out.length, inicio: b * ms };
      balde = b;
      continue;
    }
    actual = {
      ...v,
      n: actual.n,
      inicio: actual.inicio,
      open: actual.open,
      high: Math.max(actual.high, v.high),
      low: Math.min(actual.low, v.low),
      volumen: actual.volumen + v.volumen,
      delta: actual.delta + v.delta,
      valores: { ...v.valores, hueco: actual.valores.hueco || v.valores.hueco ? 1 : 0 },
    };
  }
  if (actual) out.push(actual);
  return out;
}
