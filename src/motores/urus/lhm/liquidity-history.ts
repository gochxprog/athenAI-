import type { OrderBookView } from "../order-flow/order-book";
import { CircularBuffer } from "./circular-buffer";
import { buildSeedColumns, type SeedCandle } from "./liquidity-seed";

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
  /** true = estimada con volumen negociado (backfill REST), no es libro real. */
  synthetic?: boolean;
  /** Cuánto dura la columna (ms). Solo las sintéticas lo traen; las vivas usan el hold del renderer. */
  spanMs?: number;
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
   * Se incrementa SOLO en cambios estructurales (reset, siembra, hidratación, fusión con el servidor, cambio de step),
   * no en cada muestra nueva. Los motores incrementales (p. ej. los pools del LHM) reconstruyen cuando cambia.
   */
  epoch = 0;
  private lastSampleAt = 0;
  /** Velas de siembra vigentes (backfill del timeframe actual). Sobreviven al cambio de step. */
  private seedSource: SeedCandle[] | null = null;

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
    this.seedSource = null;
    this.resetBuffer();
  }

  private resetBuffer(): void {
    this.buffer.clear();
    this.step = 0;
    this.lastSampleAt = 0;
    this.version += 1;
    this.epoch += 1;
  }

  /**
   * Siembra (o limpia con `null`/[]) el fondo histórico del timeframe actual SIN tocar lo grabado en vivo.
   * `fallbackStep` solo se usa si todavía no hay columnas reales (si las hay, manda su step).
   * Idempotente: se puede llamar de nuevo al cambiar de símbolo/timeframe.
   */
  setSeed(seed: readonly SeedCandle[] | null, fallbackStep: number): void {
    this.seedSource = seed && seed.length > 0 ? [...seed] : null;
    const real: LiquidityColumn[] = [];
    for (let i = 0; i < this.buffer.size; i += 1) {
      const col = this.buffer.get(i) as LiquidityColumn;
      if (!col.synthetic) real.push(col);
    }
    const step = real.length > 0 ? this.step : fallbackStep;
    const sampleAt = this.lastSampleAt;
    this.buffer.clear();
    this.step = real.length > 0 || (this.seedSource !== null && step > 0) ? step : 0;
    this.lastSampleAt = sampleAt;
    this.pushSeedColumns(real.length > 0 ? real[0].t : Number.POSITIVE_INFINITY);
    for (const col of real) this.buffer.push(col);
    this.version += 1;
    this.epoch += 1;
  }

  /**
   * Restaura columnas reales de IndexedDB antes de que empiece la grabación viva.
   * No reemplaza ninguna columna real que ya exista; conserva la semilla que no se solapa
   * y la reconstruye si el step actual difiere del que se usó para crearla.
   */
  hydrate(columns: readonly LiquidityColumn[], step: number): boolean {
    if (!(step > 0) || !Number.isFinite(step)) return false;
    for (let i = 0; i < this.buffer.size; i += 1) {
      if (!(this.buffer.get(i) as LiquidityColumn).synthetic) return false;
    }

    const byTime = new Map<number, LiquidityColumn>();
    for (const column of columns) {
      if (
        column.synthetic || !Number.isFinite(column.t) ||
        !(column.sizes instanceof Float32Array) || column.sizes.length === 0
      ) continue;
      byTime.set(column.t, {
        t: column.t,
        minIdx: column.minIdx,
        bestBidIdx: column.bestBidIdx,
        sizes: column.sizes,
      });
    }
    const restored = [...byTime.values()].sort((a, b) => a.t - b.t);
    if (restored.length === 0) return false;

    const sameScale = this.step === 0 || sameStep(this.step, step);
    const synthetic = this.seedSource
      ? buildSeedColumns(this.seedSource, step)
      : sameScale
        ? Array.from({ length: this.buffer.size }, (_, i) => this.buffer.get(i) as LiquidityColumn).filter(column => column.synthetic)
        : [];
    const overlapsRestored = (seed: LiquidityColumn): boolean => {
      const seedEnd = seed.t + Math.max(1, seed.spanMs ?? this.sampleMs);
      let lo = 0;
      let hi = restored.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (restored[mid].t + this.sampleMs <= seed.t) lo = mid + 1;
        else hi = mid;
      }
      return lo < restored.length && restored[lo].t < seedEnd;
    };

    const merged = new Map<number, LiquidityColumn>();
    for (const column of synthetic) {
      if (!overlapsRestored(column)) merged.set(column.t, column);
    }
    for (const column of restored) merged.set(column.t, column);

    this.buffer.clear();
    this.step = step;
    for (const column of [...merged.values()].sort((a, b) => a.t - b.t)) this.buffer.push(column);
    this.version += 1;
    this.epoch += 1;
    return true;
  }

  /** true si alguna columna sintética (siembra) se solapa con la ventana [tStart, tEnd]. No asigna memoria. */
  hasSyntheticIn(tStart: number, tEnd: number): boolean {
    for (let i = this.buffer.size - 1; i >= 0; i -= 1) {
      const col = this.buffer.get(i) as LiquidityColumn;
      if (!col.synthetic) continue;
      if (col.t <= tEnd && col.t + Math.max(1, col.spanMs ?? this.sampleMs) >= tStart) return true;
    }
    return false;
  }

  /** Marca de tiempo de la última columna REAL (no sintética); 0 si no hay. */
  lastRealTimestamp(): number {
    for (let i = this.buffer.size - 1; i >= 0; i -= 1) {
      const col = this.buffer.get(i) as LiquidityColumn;
      if (!col.synthetic) return col.t;
    }
    return 0;
  }

  /**
   * Camino rápido para el sondeo incremental del servidor: añade al FINAL las columnas estrictamente más nuevas que la
   * última real. No reconstruye ni cambia `epoch` (los motores incrementales siguen sin recalcular todo). Si el step
   * no coincide con el del buffer real, se ignora. Devuelve cuántas se añadieron.
   */
  appendColumns(columns: readonly LiquidityColumn[], step: number): number {
    if (!(step > 0) || !Number.isFinite(step) || columns.length === 0) return 0;
    const lastReal = this.lastRealTimestamp();
    if (lastReal > 0 && !sameStep(this.step, step)) return 0;
    let added = 0;
    let lastT = lastReal;
    for (const c of columns) {
      if (c.synthetic || !(c.sizes instanceof Float32Array) || c.sizes.length === 0 || !(c.t > lastT)) continue;
      this.buffer.push({ t: c.t, minIdx: c.minIdx, bestBidIdx: c.bestBidIdx, sizes: c.sizes, ...(c.spanMs ? { spanMs: c.spanMs } : {}) });
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
   * Incorpora columnas REALES grabadas por el servidor (historial continuo, también de cuando la app
   * estaba cerrada). Rellena SOLO los huecos: una columna entrante se descarta si ya hay una real a menos
   * de `toleranceMs`. Las sintéticas que solape un tramo real se retiran. Devuelve cuántas se añadieron.
   * Si el step difiere del del buffer real actual, se ignora (no se mezclan escalas).
   */
  mergeColumns(columns: readonly LiquidityColumn[], step: number, toleranceMs = 1_500): number {
    if (!(step > 0) || !Number.isFinite(step) || columns.length === 0) return 0;
    const existing: LiquidityColumn[] = [];
    const synthetic: LiquidityColumn[] = [];
    for (let i = 0; i < this.buffer.size; i += 1) {
      const col = this.buffer.get(i) as LiquidityColumn;
      (col.synthetic ? synthetic : existing).push(col);
    }
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
      if (c.synthetic || !(c.sizes instanceof Float32Array) || c.sizes.length === 0 || near(c.t)) continue;
      added.push({ t: c.t, minIdx: c.minIdx, bestBidIdx: c.bestBidIdx, sizes: c.sizes, ...(c.spanMs ? { spanMs: c.spanMs } : {}) });
    }
    if (added.length === 0) return 0;

    const real = [...existing, ...added].sort((a, b) => a.t - b.t);
    const seeds = this.seedSource ? buildSeedColumns(this.seedSource, step) : sameStep(this.step || step, step) ? synthetic : [];
    const covered = (seed: LiquidityColumn): boolean => {
      const seedEnd = seed.t + Math.max(1, seed.spanMs ?? this.sampleMs);
      let lo = 0;
      let hi = real.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (real[mid].t + this.sampleMs <= seed.t) lo = mid + 1;
        else hi = mid;
      }
      return lo < real.length && real[lo].t < seedEnd;
    };
    const all = [...seeds.filter(s => !covered(s)), ...real].sort((a, b) => a.t - b.t);
    this.buffer.clear();
    this.step = step;
    for (const c of all) this.buffer.push(c);
    this.version += 1;
    this.epoch += 1;
    return added.length;
  }

  /** Empuja las columnas sintéticas más antiguas que `beforeT` (no se pisan con lo grabado en vivo). */
  private pushSeedColumns(beforeT: number): void {
    if (!this.seedSource || !(this.step > 0)) return;
    for (const col of buildSeedColumns(this.seedSource, this.step)) {
      if (col.t >= beforeT) continue;
      this.buffer.push(col);
    }
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
    let reseed = false;
    if (this.step !== 0 && !sameStep(step, this.step)) {
      this.resetBuffer();
      reseed = true;
    }
    this.step = step;
    // Tras un cambio de step las sintéticas se reconstruyen con el step nuevo (no se pierde el fondo).
    if (reseed || this.buffer.size === 0) this.pushSeedColumns(now);

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

/* ------------------------------------------------------------------ */
/* Registro por símbolo: el historial sobrevive al cambio                */
/* FinancialChart <-> FootprintChart (se desmonta uno, se monta otro).   */
/* Acotado a MAX_SYMBOLS (LRU) para no acumular memoria.                 */
/* ------------------------------------------------------------------ */

const MAX_SYMBOLS = 4;
const registry = new Map<string, LiquidityHistory>();

export function getLiquidityHistory(symbol: string): LiquidityHistory {
  const key = symbol.toUpperCase();
  let history = registry.get(key);
  if (history) {
    registry.delete(key); // refresca el orden LRU
  } else {
    history = new LiquidityHistory();
    while (registry.size >= MAX_SYMBOLS) {
      const oldest = registry.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      registry.delete(oldest);
    }
  }
  registry.set(key, history);
  return history;
}
