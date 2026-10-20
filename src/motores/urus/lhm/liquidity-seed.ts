import type { LiquidityColumn } from "./liquidity-history";

/**
 * Vela de "siembra" del Heatmap. Binance NO publica el libro de órdenes histórico por REST,
 * así que el fondo inicial se estima con el VOLUMEN NEGOCIADO por nivel de precio de cada vela
 * (los nodos donde hubo más actividad). Esas columnas son sintéticas (`synthetic: true`):
 * el renderer las normaliza aparte y las atenúa; en cuanto el libro en vivo graba, lo real las reemplaza.
 */
export interface SeedCandle {
  /** Apertura de la vela (ms). */
  t: number;
  /** Duración de la vela (ms): cuánto tiempo se pinta la columna. */
  spanMs: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Volumen real negociado por precio [precio, volumen]; si falta se reparte uniforme entre Low y High. */
  levels?: ReadonlyArray<readonly [price: number, volume: number]> | null;
}

const MAX_SPAN_LEVELS = 4_000;

/** Convierte velas de siembra en columnas del LiquidityHistory con el `step` de precio dado. */
export function buildSeedColumns(seed: readonly SeedCandle[], step: number): LiquidityColumn[] {
  const out: LiquidityColumn[] = [];
  if (!(step > 0)) return out;
  for (const c of seed) {
    if (!(c.volume > 0) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || c.high < c.low) continue;
    const lo = Math.round(c.low / step);
    const hi = Math.max(lo, Math.round(c.high / step));
    const span = hi - lo + 1;
    if (span < 1 || span > MAX_SPAN_LEVELS) continue;
    const sizes = new Float32Array(span);
    if (c.levels && c.levels.length > 0) {
      for (const [price, vol] of c.levels) {
        if (!(vol > 0)) continue;
        const idx = Math.min(hi, Math.max(lo, Math.round(price / step)));
        sizes[idx - lo] += vol;
      }
    } else {
      sizes.fill(c.volume / span);
    }
    out.push({
      t: c.t,
      minIdx: lo,
      bestBidIdx: Math.min(hi, Math.max(lo, Math.round(c.close / step))),
      sizes,
      synthetic: true,
      spanMs: c.spanMs,
    });
  }
  return out;
}
