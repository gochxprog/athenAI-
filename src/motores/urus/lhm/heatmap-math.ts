/**
 * Matemática pura del Heatmap (sin DOM ni canvas): testeable y reutilizable.
 *
 *   Bloque grande = L(p, t) >= Media_Liquidez × Factor_Umbral
 * La intensidad/color del mapa de profundidad vive en depth-engine.ts (log + percentil + bloom).
 */

/** Acotación canónica: antes vivía copiada idéntica en 4 archivos del módulo (panel-viewport, panel-renderer, HeatmapPanel, liquidation-engine). Una sola implementación. */
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type Rgba = readonly [r: number, g: number, b: number, a: number];
/** Escala de 4 colores hex: baja → media → alta → máxima liquidez. */
export type HeatStops = readonly [string, string, string, string];
export const HEAT_LEVEL_LABELS = ["Baja", "Media", "Alta", "Máxima"] as const;

/**
 * Escala térmica por defecto (estilo Bookmap): azul profundo → cian → amarillo → rojo en el pico. Misma rampa para
 * Asks y Bids: la intensidad se lee igual a ambos lados del precio y el lado lo da la posición (y las líneas de
 * mejor bid/ask). Los colores de cada lado siguen siendo editables por separado en los ajustes del Heatmap.
 */
export const THERMAL_STOPS: HeatStops = ["#0a2a9e", "#00c9d6", "#ffd60a", "#ff3b1f"];
export const DEFAULT_ASK_STOPS: HeatStops = THERMAL_STOPS;
export const DEFAULT_BID_STOPS: HeatStops = THERMAL_STOPS;
/** Versión de la paleta por defecto: al subirla, los colores guardados de una versión anterior se sustituyen una vez. */
export const HEAT_PALETTE_VERSION = 2;

/** Percentil `p` (0..1) por interpolación lineal. Ignora valores no finitos. Devuelve 0 si no hay datos. */
export function percentile(values: ArrayLike<number>, p: number, scratch?: number[]): number {
  // `scratch` (opcional): array reutilizable del llamador → sin asignar una copia por llamada en bucles de render.
  const clean: number[] = scratch ?? [];
  clean.length = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (Number.isFinite(v) && v >= 0) clean.push(v);
  }
  if (clean.length === 0) return 0;
  clean.sort((a, b) => a - b);
  const q = Math.min(1, Math.max(0, p));
  const pos = q * (clean.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return clean[lo] + (clean[hi] - clean[lo]) * (pos - lo);
}

/** Intensidad normalizada 0..1. Con L_max <= 0 no hay intensidad (nunca NaN). */
export function intensity(volume: number, maxVolume: number): number {
  if (!(maxVolume > 0) || !(volume > 0)) return 0;
  return Math.min(1, volume / maxVolume);
}

/** Interpolación lineal de dos colores RGBA con factor 0..1. */
export function interpolateColor(from: Rgba, to: Rgba, factor: number): Rgba {
  const f = Math.min(1, Math.max(0, Number.isFinite(factor) ? factor : 0));
  return [
    from[0] + (to[0] - from[0]) * f,
    from[1] + (to[1] - from[1]) * f,
    from[2] + (to[2] - from[2]) * f,
    from[3] + (to[3] - from[3]) * f,
  ];
}

export const COLOR_STEPS = 64;

/** Media de los tamaños > 0 (ignora niveles vacíos). 0 si no hay ninguno. */
export function meanPositive(values: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (Number.isFinite(v) && v > 0) {
      sum += v;
      n += 1;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Umbral absoluto de bloque grande = Media × Factor. */
export function largeBlockThreshold(meanLiquidity: number, factor: number): number {
  if (!(meanLiquidity > 0) || !(factor > 0)) return Number.POSITIVE_INFINITY;
  return meanLiquidity * factor;
}

export function isLargeBlock(size: number, threshold: number): boolean {
  return Number.isFinite(threshold) && size >= threshold;
}

/**
 * "Sensibilidad" del libro pasivo (0..100) → intensidad mínima que se dibuja.
 * Más sensibilidad = se ven también niveles de poca liquidez. 75 ≈ 0.0175 (equivale al 0.02 histórico).
 */
export function sensitivityToMinIntensity(sensitivity: number): number {
  const s = Math.min(100, Math.max(0, Number.isFinite(sensitivity) ? sensitivity : 75));
  return 0.005 + 0.2 * (1 - s / 100) ** 2;
}

/** Suavizado exponencial de L_max entre redibujados (evita parpadeo al cambiar el percentil). */
export function smoothValue(previous: number, target: number, alpha: number): number {
  if (!(previous > 0)) return target;
  const a = Math.min(1, Math.max(0, alpha));
  return previous + (target - previous) * a;
}

/** "#rrggbb" → [r,g,b]; un valor inválido cae a blanco (nunca lanza). */
export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Contraste (gamma): k' = k^gamma. gamma < 1 hace visible la liquidez baja; > 1 deja solo los picos. */
export function applyGamma(k: number, gamma: number): number {
  if (!(k > 0)) return 0;
  const g = Number.isFinite(gamma) && gamma > 0 ? gamma : 1;
  return Math.min(1, k) ** g;
}
