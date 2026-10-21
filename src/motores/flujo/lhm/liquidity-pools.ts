import { percentile } from "./heatmap-math";
import type { LiquidityColumn, LiquidityHistory } from "./liquidity-history";

/**
 * LHM en modo "Pools de liquidez": bloques de ÓRDENES LÍMITE GRANDES del libro real (no se calculan con velas).
 *
 * Reglas:
 *  1. Exclusión por volumen: un bucket de precio solo es pool si su volumen límite >= umbral. Si cae por debajo
 *     (orden retirada o ejecutada) el pool desaparece; solo se dibujan los que superan el umbral.
 *  2. Persistencia: el bucket debe mantenerse >= umbral durante `minPersistence` fotos consecutivas del libro
 *     antes de confirmarse como pool. Esto filtra el ruido: órdenes que parpadean (flicker) o aparecen y se
 *     retiran en segundos nunca llegan a dibujarse.
 *  3. Swept pools: si el precio (recorrido del libro o mecha/cuerpo de las velas posteriores) atraviesa el nivel,
 *     el pool se borra de inmediato.
 *  4. Se proyectan hacia el futuro: del instante en que aparecen hasta el borde derecho del gráfico.
 *
 * Nota honesta: ningún indicador puede distinguir al 100% una orden real de spoofing (órdenes falsas que se
 * retiran antes de ejecutarse). Lo que este motor mide son órdenes límite GRANDES y PERSISTENTES en el tiempo,
 * que es el mejor proxy disponible de liquidez real: una orden falsa rara vez se mantiene visible durante
 * varias fotos consecutivas del libro.
 *
 * El motor es INCREMENTAL: procesa solo las columnas nuevas del LiquidityHistory; reconstruye desde cero únicamente
 * si cambia el historial (epoch), el step, la agrupación o el umbral.
 */
export interface Pool {
  key: number;
  /** Precio central del bucket. */
  price: number;
  /** ask = por encima del precio (Buy stops / liquidez vendedora); bid = por debajo. */
  side: "ask" | "bid";
  volume: number;
  /** Instante en que apareció (inicio de la proyección). */
  t0: number;
}

/**
 * Huella de absorción: un pool que el precio BARRIÓ (absorbió) deja su marca fantasma.
 * Se dibuja atenuada y distinta de los pools vivos: muestra dónde HABÍA liquidez que el
 * precio se comió. Caduca tras `ghostTtlMs`.
 */
export interface PoolGhost {
  key: number;
  price: number;
  side: "ask" | "bid";
  volume: number;
  /** Instante en que nació el pool (inicio de la proyección fantasma). */
  t0: number;
  /** Instante en que el precio lo barrió. */
  tSwept: number;
}

export interface PoolConfig {
  /** true = umbral automático: percentil `autoPercentile` de los volúmenes por bucket de la ventana reciente. */
  auto: boolean;
  /** Umbral manual (unidades del activo); se usa si auto === false. */
  threshold: number;
  autoPercentile: number;
  /** Niveles del historial agrupados en un bucket (acumulación de órdenes cercanas). */
  group: number;
  maxPools: number;
  /**
   * Fotos consecutivas del libro con volumen >= umbral antes de confirmar un pool.
   * 1 = comportamiento inmediato (sin filtro); 3 = ~6 s con el heat-recorder a 2 s/foto.
   */
  minPersistence: number;
  /**
   * Cuánto vive la huella de un pool barrido antes de desvanecerse del todo (ms).
   * Solo afecta al renderizado de la marca fantasma, no a la detección.
   */
  ghostTtlMs: number;
}

export const DEFAULT_GHOST_TTL_MS = 5 * 60_000;
/** Tope de huellas en memoria: se expulsa la más antigua. */
const MAX_GHOSTS = 300;

export const DEFAULT_POOL_CONFIG: PoolConfig = { auto: true, threshold: 50, autoPercentile: 0.99, group: 5, maxPools: 24, minPersistence: 3, ghostTtlMs: DEFAULT_GHOST_TTL_MS };

const REBUILD_MAX_COLUMNS = 12_000;
const AUTO_SAMPLE_COLUMNS = 120;
const AUTO_REFRESH_MS = 5 * 60_000;
const AUTO_WARMUP_REFRESH_MS = 10_000;

const floorDiv = (a: number, b: number) => Math.floor(a / b);

/** Volumen por bucket de una columna (suma de `group` niveles contiguos). */
export function bucketVolumes(col: LiquidityColumn, group: number): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < col.sizes.length; i += 1) {
    const size = col.sizes[i];
    if (!(size > 0)) continue;
    const key = floorDiv(col.minIdx + i, group);
    out.set(key, (out.get(key) ?? 0) + size);
  }
  return out;
}

/** Precio medio (bid/ask) de una columna en unidades de bucket de precio; null si no hay ask. */
export function columnMid(col: LiquidityColumn, step: number): number | null {
  const start = col.bestBidIdx + 1 - col.minIdx;
  for (let i = Math.max(0, start); i < col.sizes.length; i += 1) {
    if (col.sizes[i] > 0) return ((col.bestBidIdx + (col.minIdx + i)) / 2) * step;
  }
  return null;
}

export interface PoolCandle {
  timestamp: number;
  high: number;
  low: number;
}

/** Igualdad como la de los strings de plantilla: NaN == NaN y 0 == −0 (así no se reconstruye en bucle con NaN). */
function sameNumber(a: number, b: number): boolean {
  return a === b || (a !== a && b !== b);
}

export class LiquidityPoolEngine {
  /** Cambia cuando el conjunto de pools cambia (alta, baja, barrido, volumen): el layer redibuja. */
  version = 0;
  threshold = Number.POSITIVE_INFINITY;
  stats = { created: 0, withdrawn: 0, swept: 0, rebuilds: 0 };

  private readonly byKey = new Map<number, Pool>();
  private cursorT = Number.NEGATIVE_INFINITY;
  private prevMid: number | null = null;
  /**
   * Firma de la última reconstrucción, como campos numéricos. `sync()` corre en CADA frame: antes armaba un string
   * con plantilla anidada por frame solo para compararlo; ahora compara campo a campo (sin asignar nada).
   */
  private readonly sig = { valid: false, epoch: 0, step: 0, group: 0, auto: false, autoPct: 0, threshold: 0, maxPools: 0, persist: 0 };
  private lastRebuildAt = 0;
  /** Última vela evaluada por sweepWithCandles (mismo motivo: sin string por frame). */
  private readonly candlesSeen = { valid: false, length: 0, ts: 0, high: 0, low: 0 };
  /**
   * Racha de fotos consecutivas con volumen >= umbral por bucket (anti-ruido).
   * Solo cuando la racha alcanza `minPersistence` el bucket se confirma como pool.
   */
  private readonly streak = new Map<number, { count: number; t0: number }>();
  /**
   * Huellas de absorción: pools que el precio barrió. El retiro voluntario (volumen que
   * cae bajo el umbral sin que el precio toque el nivel) NO deja huella: solo el barrido.
   */
  private readonly ghosts = new Map<number, PoolGhost>();
  private ghostTtlMs = DEFAULT_GHOST_TTL_MS;

  list(): Pool[] {
    return [...this.byKey.values()];
  }

  get size(): number {
    return this.byKey.size;
  }

  /** Rachas de persistencia vivas (diagnóstico de memoria). */
  get streakSize(): number {
    return this.streak.size;
  }

  /** Huellas vivas (no caducadas) en el instante `now`; purga las vencidas. */
  ghostsAlive(now = Date.now()): PoolGhost[] {
    const ttl = this.ghostTtlMs > 0 ? this.ghostTtlMs : DEFAULT_GHOST_TTL_MS;
    for (const [key, g] of this.ghosts) {
      if (g.tSwept + ttl <= now) this.ghosts.delete(key);
    }
    return [...this.ghosts.values()];
  }

  /** Registra la huella de un pool barrido. Con tope de memoria: expulsa la más antigua. */
  private recordGhost(pool: Pool, tSwept: number): void {
    if (this.ghosts.size >= MAX_GHOSTS) {
      let oldestKey: number | null = null;
      let oldestT = Infinity;
      for (const [k, g] of this.ghosts) {
        if (g.tSwept < oldestT) {
          oldestT = g.tSwept;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) this.ghosts.delete(oldestKey);
    }
    this.ghosts.set(pool.key, {
      key: pool.key,
      price: pool.price,
      side: pool.side,
      volume: pool.volume,
      t0: pool.t0,
      tSwept,
    });
  }

  private resolveThreshold(history: LiquidityHistory, cfg: PoolConfig): number {
    if (!cfg.auto) return cfg.threshold > 0 ? cfg.threshold : Number.POSITIVE_INFINITY;
    const real: LiquidityColumn[] = [];
    for (let i = history.size - 1; i >= 0 && real.length < AUTO_SAMPLE_COLUMNS; i -= 1) {
      const col = history.get(i) as LiquidityColumn;
      real.push(col);
    }
    const vols: number[] = [];
    for (const col of real) for (const v of bucketVolumes(col, cfg.group).values()) vols.push(v);
    const t = percentile(vols, Math.min(0.999, Math.max(0.5, cfg.autoPercentile)));
    return t > 0 ? t : Number.POSITIVE_INFINITY;
  }

  /** Procesa una columna del libro. Devuelve true si cambió algo. */
  private processColumn(col: LiquidityColumn, step: number, cfg: PoolConfig): boolean {
    const mid = columnMid(col, step);
    if (mid === null) return false;
    let changed = false;

    // 1) Swept: el recorrido del precio desde la columna anterior hasta ésta.
    const prev = this.prevMid ?? mid;
    const lo = Math.min(prev, mid);
    const hi = Math.max(prev, mid);
    this.prevMid = mid;
    for (const [key, pool] of this.byKey) {
      if (pool.price >= lo && pool.price <= hi) {
        this.recordGhost(pool, col.t); // la liquidez absorbida deja su huella
        this.byKey.delete(key);
        this.streak.delete(key); // barrido: si el nivel se rellena, debe persistir de nuevo
        this.stats.swept += 1;
        changed = true;
      }
    }

    // 2) Altas / actualizaciones: solo buckets con volumen >= umbral DURANTE minPersistence
    // fotos consecutivas (persistencia anti-ruido: el flicker y el spoofing efímero no llegan a pool).
    const vols = bucketVolumes(col, cfg.group);
    const need = Math.max(1, Math.floor(cfg.minPersistence));
    let keyMin = Infinity;
    let keyMax = -Infinity;
    for (const key of vols.keys()) {
      if (key < keyMin) keyMin = key;
      if (key > keyMax) keyMax = key;
    }
    const half = ((cfg.group - 1) / 2) * step;
    for (const [key, volume] of vols) {
      if (!(volume >= this.threshold)) {
        this.streak.delete(key);
        continue;
      }
      const s = this.streak.get(key);
      if (s) s.count += 1;
      else this.streak.set(key, { count: 1, t0: col.t });
      if ((this.streak.get(key)?.count ?? 0) < need) continue; // aún no confirmado
      const center = key * cfg.group * step + half;
      const lowEdge = key * cfg.group * step - step / 2;
      const highEdge = (key * cfg.group + cfg.group - 1) * step + step / 2;
      if (mid >= lowEdge && mid <= highEdge) continue; // el bucket que se está negociando no es un pool
      const existing = this.byKey.get(key);
      if (existing) {
        if (existing.volume !== volume) {
          existing.volume = volume;
          changed = true;
        }
      } else {
        const t0 = this.streak.get(key)?.t0 ?? col.t;
        this.byKey.set(key, { key, price: center, side: center > mid ? "ask" : "bid", volume, t0 });
        this.stats.created += 1;
        changed = true;
      }
    }

    // 3) Bajas: bajo el umbral o retirado dentro del rango que cubre la foto (fuera del rango solo falta información).
    for (const [key] of this.byKey) {
      const v = vols.get(key);
      const covered = key >= keyMin - 1 && key <= keyMax + 1;
      if (v !== undefined ? v < this.threshold : covered) {
        this.byKey.delete(key);
        this.streak.delete(key);
        this.stats.withdrawn += 1;
        changed = true;
      }
    }

    // athenAI: la racha de un bucket que quedó fuera del rango de la foto (el precio se alejó) nunca se borraba en
    // antes: el Map crecía sin límite con las horas. Fuera de cobertura no hay información para sostener la racha.
    for (const key of this.streak.keys()) {
      if (key < keyMin - 1 || key > keyMax + 1) this.streak.delete(key);
    }

    // 4) Memoria acotada: se conservan los de mayor volumen.
    if (this.byKey.size > cfg.maxPools) {
      const sorted = [...this.byKey.values()].sort((a, b) => b.volume - a.volume);
      for (const pool of sorted.slice(cfg.maxPools)) this.byKey.delete(pool.key);
      changed = true;
    }
    return changed;
  }

  /** Barre con las velas OPCIONALES (solo para detectar mechas): cuenta velas abiertas después de nacer el pool. */
  private sweepWithCandles(candles: readonly PoolCandle[]): boolean {
    if (this.byKey.size === 0 || candles.length === 0) return false;
    const last = candles[candles.length - 1];
    const seen = this.candlesSeen;
    if (seen.valid && seen.length === candles.length && sameNumber(seen.ts, last.timestamp) && sameNumber(seen.high, last.high) && sameNumber(seen.low, last.low)) return false;
    seen.valid = true;
    seen.length = candles.length;
    seen.ts = last.timestamp;
    seen.high = last.high;
    seen.low = last.low;
    let changed = false;
    for (const [k, pool] of this.byKey) {
      for (let i = candles.length - 1; i >= 0; i -= 1) {
        const c = candles[i];
        if (c.timestamp < pool.t0) break; // las velas abiertas antes del pool incluyen precios previos a su existencia
        if (c.low <= pool.price && pool.price <= c.high) {
          this.recordGhost(pool, c.timestamp); // la liquidez absorbida deja su huella
          this.byKey.delete(k);
          this.stats.swept += 1;
          changed = true;
          break;
        }
      }
    }
    return changed;
  }

  /** Sincroniza con el historial. Llamar en cada frame: es barato si no hay columnas nuevas. */
  sync(history: LiquidityHistory, cfg: PoolConfig, candles?: readonly PoolCandle[], now = Date.now()): void {
    const step = history.step;
    if (!(step > 0)) {
      if (this.byKey.size > 0) {
        this.byKey.clear();
        this.version += 1;
      }
      return;
    }
    // Antes, cada AUTO_REFRESH_MS (5 min) el modo automático forzaba una RECONSTRUCCIÓN completa
    // (borrar todo y reprocesar hasta 12.000 columnas de golpe): un congelamiento periódico del hilo y, además,
    // pools que cambiaban retroactivamente. Ahora solo se recalcula el umbral en el sitio; los pools vivos
    // se reevalúan con él en las columnas siguientes.
    // athenAI: con pocas fotos (recién abierta la app) el umbral salía de 1–2 columnas; mientras no haya
    // AUTO_SAMPLE_COLUMNS se recalcula cada 10 s, y después cada 5 min.
    const calentando = history.size < AUTO_SAMPLE_COLUMNS;
    const refreshThreshold = cfg.auto && now - this.lastRebuildAt > (calentando ? AUTO_WARMUP_REFRESH_MS : AUTO_REFRESH_MS);
    let changed = false;
    if (refreshThreshold && this.signatureMatches(history.epoch, step, cfg)) {
      this.lastRebuildAt = now;
      const next = this.resolveThreshold(history, cfg);
      if (next !== this.threshold) {
        this.threshold = next;
        changed = true;
      }
    }

    if (!this.signatureMatches(history.epoch, step, cfg)) {
      this.storeSignature(history.epoch, step, cfg);
      this.lastRebuildAt = now;
      this.byKey.clear();
      this.streak.clear();
      this.ghosts.clear(); // rebuild: las huellas pertenecen al historial anterior
      this.prevMid = null;
      this.cursorT = Number.NEGATIVE_INFINITY;
      this.threshold = this.resolveThreshold(history, cfg);
      this.stats.rebuilds += 1;
      changed = true;
    }
    this.ghostTtlMs = cfg.ghostTtlMs > 0 ? cfg.ghostTtlMs : DEFAULT_GHOST_TTL_MS;

    const from = this.cursorT === Number.NEGATIVE_INFINITY
      ? Math.max(0, history.size - REBUILD_MAX_COLUMNS)
      : history.lowerBound(this.cursorT + 1);
    for (let i = from; i < history.size; i += 1) {
      const col = history.get(i) as LiquidityColumn;
      if (this.processColumn(col, step, cfg)) changed = true;
      this.cursorT = col.t;
    }
    if (candles && this.sweepWithCandles(candles)) changed = true;
    if (changed) this.version += 1;
  }

  private signatureMatches(epoch: number, step: number, cfg: PoolConfig): boolean {
    const g = this.sig;
    return (
      g.valid && sameNumber(g.epoch, epoch) && sameNumber(g.step, step) && sameNumber(g.group, cfg.group) &&
      g.auto === Boolean(cfg.auto) &&
      (cfg.auto ? sameNumber(g.autoPct, cfg.autoPercentile) : sameNumber(g.threshold, cfg.threshold)) &&
      sameNumber(g.maxPools, cfg.maxPools) && sameNumber(g.persist, cfg.minPersistence)
    );
  }

  private storeSignature(epoch: number, step: number, cfg: PoolConfig): void {
    const g = this.sig;
    g.valid = true;
    g.epoch = epoch;
    g.step = step;
    g.group = cfg.group;
    g.auto = Boolean(cfg.auto);
    g.autoPct = cfg.autoPercentile;
    g.threshold = cfg.threshold;
    g.maxPools = cfg.maxPools;
    g.persist = cfg.minPersistence;
  }

  clear(): void {
    this.byKey.clear();
    this.streak.clear();
    this.ghosts.clear();
    this.sig.valid = false;
    this.cursorT = Number.NEGATIVE_INFINITY;
    this.prevMid = null;
    this.candlesSeen.valid = false;
    this.version += 1;
  }
}
