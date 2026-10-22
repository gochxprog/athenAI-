import type { OrderBookView } from "../order-flow/order-book";
import { CircularBuffer } from "./circular-buffer";

/**
 * Historial de liquidez pasiva para el Heatmap.
 *
 * Cada muestra ("columna") guarda los tamaños de TODOS los niveles del libro en un
 * Float32Array denso indexado por bucket de precio (idx = round(precio / step)).
 * El lado (bid/ask) se deduce de `bestBidIdx`: idx <= bestBidIdx es bid.
 *
 * Memoria acotada: CircularBuffer de capacidad fija (≈ 200 niveles × 4 B × 21 600
 * columnas ≈ 17 MB por símbolo para 6 h a 1 muestra/s).
 */
export interface LiquidityColumn {
  t: number;
  minIdx: number;
  bestBidIdx: number;
  /** sizes[i] = liquidez del bucket (minIdx + i); 0 = sin orden. */
  sizes: Float32Array;
}

export const DEFAULT_HISTORY_CAPACITY = 21_600;
export const DEFAULT_SAMPLE_MS = 1_000;
const MAX_SPAN_LEVELS = 4_000;

function sameStep(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && Math.abs(a - b) <= Math.max(a, b) * 1e-9;
}

export class LiquidityHistory {
  private buffer: CircularBuffer<LiquidityColumn>;
  /** Tamaño de bucket en precio (tickSize × group). 0 = aún sin datos. */
  step = 0;
  /** Se incrementa con cada muestra nueva o reset (el renderer lo usa para saber si redibujar). */
  version = 0;
  /**
   * Se incrementa SOLO en cambios estructurales (reset, hidratación, fusión con el servidor, cambio de step),
   * no en cada muestra nueva. Los motores incrementales (p. ej. los pools del LHM) reconstruyen cuando cambia.
   */
  epoch = 0;
  private lastSampleAt = 0;

  constructor(
    readonly capacity = DEFAULT_HISTORY_CAPACITY,
    private readonly sampleMs = DEFAULT_SAMPLE_MS,
  ) {
    this.buffer = new CircularBuffer<LiquidityColumn>(capacity);
  }

  get size(): number {
    return this.buffer.size;
  }

  get(index: number): LiquidityColumn | undefined {
    return this.buffer.get(index);
  }

  last(): LiquidityColumn | undefined {
    return this.buffer.last();
  }

  reset(): void {
    this.buffer.clear();
    this.step = 0;
    this.lastSampleAt = 0;
    this.version += 1;
    this.epoch += 1;
  }

  /**
   * Restaura columnas reales de IndexedDB antes de que empiece la grabación viva.
   * Solo actúa si el buffer está vacío (no reemplaza lo grabado en vivo).
   */
  hydrate(columns: readonly LiquidityColumn[], step: number): boolean {
    if (!(step > 0) || !Number.isFinite(step) || this.buffer.size > 0) return false;
    const byTime = new Map<number, LiquidityColumn>();
    for (const column of columns) {
      if (!Number.isFinite(column.t) || !(column.sizes instanceof Float32Array) || column.sizes.length === 0) continue;
      byTime.set(column.t, { t: column.t, minIdx: column.minIdx, bestBidIdx: column.bestBidIdx, sizes: column.sizes });
    }
    const restored = [...byTime.values()].sort((a, b) => a.t - b.t);
    if (restored.length === 0) return false;
    this.buffer.clear();
    this.step = step;
    for (const column of restored) this.buffer.push(column);
    this.version += 1;
    this.epoch += 1;
    return true;
  }

  /** Marca de tiempo de la última columna; 0 si no hay. */
  lastTimestamp(): number {
    return this.buffer.last()?.t ?? 0;
  }

  /**
   * Camino rápido para el sondeo incremental del servidor: añade al FINAL las columnas estrictamente más nuevas que la
   * última. No reconstruye ni cambia `epoch` (los motores incrementales siguen sin recalcular todo). Si el step
   * no coincide con el del buffer, se ignora. Devuelve cuántas se añadieron.
   */
  appendColumns(columns: readonly LiquidityColumn[], step: number): number {
    if (!(step > 0) || !Number.isFinite(step) || columns.length === 0) return 0;
    const lastT0 = this.lastTimestamp();
    if (lastT0 > 0 && !sameStep(this.step, step)) return 0;
    let added = 0;
    let lastT = lastT0;
    for (const c of columns) {
      if (!(c.sizes instanceof Float32Array) || c.sizes.length === 0 || !(c.t > lastT)) continue;
      this.buffer.push({ t: c.t, minIdx: c.minIdx, bestBidIdx: c.bestBidIdx, sizes: c.sizes });
      lastT = c.t;
      added += 1;
    }
    if (added > 0) {
      this.step = step;
      this.version += 1;
    }
    return added;
  }

  /**
   * Incorpora columnas grabadas por el servidor (historial continuo, también de cuando la app estaba cerrada).
   * Rellena SOLO los huecos: una columna entrante se descarta si ya hay una a menos de `toleranceMs`.
   * Si el step difiere del del buffer actual, se ignora (no se mezclan escalas). Devuelve cuántas se añadieron.
   */
  mergeColumns(columns: readonly LiquidityColumn[], step: number, toleranceMs = 1_500): number {
    if (!(step > 0) || !Number.isFinite(step) || columns.length === 0) return 0;
    const existing: LiquidityColumn[] = [];
    for (let i = 0; i < this.buffer.size; i += 1) existing.push(this.buffer.get(i) as LiquidityColumn);
    if (existing.length > 0 && !sameStep(this.step, step)) return 0;

    const near = (t: number): boolean => {
      let lo = 0;
      let hi = existing.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (existing[mid].t < t - toleranceMs) lo = mid + 1;
        else hi = mid;
      }
      return lo < existing.length && existing[lo].t <= t + toleranceMs;
    };
    const added: LiquidityColumn[] = [];
    for (const c of [...columns].sort((a, b) => a.t - b.t)) {
      if (!(c.sizes instanceof Float32Array) || c.sizes.length === 0 || near(c.t)) continue;
      added.push({ t: c.t, minIdx: c.minIdx, bestBidIdx: c.bestBidIdx, sizes: c.sizes });
    }
    if (added.length === 0) return 0;

    const all = [...existing, ...added].sort((a, b) => a.t - b.t);
    this.buffer.clear();
    this.step = step;
    for (const c of all) this.buffer.push(c);
    this.version += 1;
    this.epoch += 1;
    return added.length;
  }

  /** Primer índice cuya marca de tiempo es >= t (búsqueda binaria). size si ninguno. */
  lowerBound(t: number): number {
    let lo = 0;
    let hi = this.buffer.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.buffer.get(mid) as LiquidityColumn).t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Registra una vista del libro (descarta la muestra si no pasó `sampleMs`). Devuelve true si se guardó. */
  record(view: OrderBookView, now: number): boolean {
    if (view.bids.length === 0 || view.asks.length === 0) return false;
    if (now - this.lastSampleAt < this.sampleMs) return false;
    const step = view.tickSize * view.group;
    if (!(step > 0)) return false;
    // Cambió la agrupación o el tick: los índices antiguos ya no son comparables.
    if (this.step !== 0 && !sameStep(step, this.step)) this.reset();
    this.step = step;

    let minIdx = Number.POSITIVE_INFINITY;
    let maxIdx = Number.NEGATIVE_INFINITY;
    for (const level of view.bids) {
      const idx = Math.round(level[0] / step);
      if (idx < minIdx) minIdx = idx;
      if (idx > maxIdx) maxIdx = idx;
    }
    for (const level of view.asks) {
      const idx = Math.round(level[0] / step);
      if (idx < minIdx) minIdx = idx;
      if (idx > maxIdx) maxIdx = idx;
    }
    const span = maxIdx - minIdx + 1;
    if (!Number.isFinite(span) || span < 1 || span > MAX_SPAN_LEVELS) return false;

    const sizes = new Float32Array(span);
    for (const level of view.bids) sizes[Math.round(level[0] / step) - minIdx] = level[1];
    for (const level of view.asks) sizes[Math.round(level[0] / step) - minIdx] = level[1];

    this.buffer.push({
      t: now,
      minIdx,
      bestBidIdx: Math.round(view.bids[0][0] / step),
      sizes,
    });
    this.lastSampleAt = now;
    this.version += 1;
    return true;
  }
}
