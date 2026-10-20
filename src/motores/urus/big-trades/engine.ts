/**
 * Big Trades engine (Detección → Agregación → Filtrado) — lógica pura y sin dependencias.
 *
 * Se usa en el servidor (flujo aggTrade de Binance) y es 100 % testeable: no toca red,
 * ni disco, ni timers. El servidor decide CUÁNDO llamar a `flushIfIdle`.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ MODELO MATEMÁTICO                                                          │
 * │                                                                            │
 * │ Ejecución e_i = (p_i, v_i, t_i, s_i)                                       │
 * │   p_i precio · v_i volumen base · t_i timestamp ms · s_i lado agresor      │
 * │                                                                            │
 * │ Bloque B_k: ejecuciones consecutivas con                                   │
 * │       Δt = t_i − t_{i−1} ≤ τ   y   s_i = s_{i−1}                           │
 * │                                                                            │
 * │ V_B = Σ v_i        N_B = Σ (v_i · p_i)        P_B = N_B / V_B  (VWAP)      │
 * │                                                                            │
 * │ Filtro 1 (USD):      N_B ≥ Umbral_USD                                      │
 * │ Filtro 2 (Z-Score):  Z_B = (N_B − μ) / σ ≥ Z_corte                         │
 * │   μ, σ sobre la ventana deslizante de los últimos M bloques cerrados.      │
 * │ Pasa si cumple TODOS los filtros activos (AND); un filtro desactivado se   │
 * │ ignora y el otro decide solo (ver `closeBlock`).                           │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

// ───────────────────────────── Tipos públicos ─────────────────────────────

export type BigTradeSide = "BUY" | "SELL";

/** Ejecución individual (compatible estructuralmente con `AggTrade` de Binance). */
export interface BigTradeInput {
  price: number;
  quantity: number;
  timestamp: number;
  aggTradeId: number;
  /** true ⇒ el comprador era maker ⇒ el agresor fue VENDEDOR. */
  buyerIsMaker: boolean;
}

export interface BigTradeConfig {
  /** τ: umbral de acumulación entre ejecuciones consecutivas (ms). Default 50. */
  tauMs: number;
  /** M: tamaño de la ventana deslizante para μ y σ. Default 1000. */
  windowSize: number;
  /** Z_corte. Default 2.5. */
  zCut: number;
  /** Umbral nocional mínimo en USD. */
  minNotionalUsd: number;
  useUsdFilter: boolean;
  useZFilter: boolean;
  /** Muestras mínimas en la ventana antes de que el filtro Z sea fiable. Default 50. */
  minZSamples: number;
  /**
   * Seguridad: duración máxima de un bloque (ms). Evita que un barrido sostenido de un solo
   * lado nunca se cierre (y por tanto nunca se muestre). 0 = sin límite (fórmula pura).
   */
  maxBlockDurationMs: number;
  /** Margen extra sobre τ antes de cerrar un bloque por inactividad (ms). */
  idleFlushGraceMs: number;
}

/**
 * Evento emitido — ESQUEMA ESTRICTO pedido en el prompt maestro.
 * `timestamp` = instante de la PRIMERA ejecución del bloque.
 */
export interface BigTradeEvent {
  event: "BIG_TRADE";
  symbol: string;
  timestamp: number;
  price: number;
  volume_base: number;
  notional_usd: number;
  side: BigTradeSide;
  z_score: number;
  duration_ms: number;
}

/** Evento + metadatos de transporte/persistencia (no forman parte del esquema estricto). */
export type BigTradeRecord = BigTradeEvent & { id: number };

// ───────────────────────────── Defaults ─────────────────────────────

/** Umbrales nocionales por defecto (USD) según el instrumento del catálogo. */
export const DEFAULT_MIN_NOTIONAL_USD: Readonly<Record<string, number>> = {
  BTCUSDT: 250_000,
  ETHUSDT: 150_000,
  SOLUSDT: 50_000,
  XAUUSDT: 100_000,
};
export const FALLBACK_MIN_NOTIONAL_USD = 100_000;

export function defaultMinNotionalUsd(symbol: string): number {
  return DEFAULT_MIN_NOTIONAL_USD[symbol.toUpperCase()] ?? FALLBACK_MIN_NOTIONAL_USD;
}

export function defaultBigTradeConfig(symbol: string): BigTradeConfig {
  return {
    tauMs: 50,
    windowSize: 1000,
    zCut: 2.5,
    minNotionalUsd: defaultMinNotionalUsd(symbol),
    useUsdFilter: true,
    useZFilter: true,
    minZSamples: 50,
    maxBlockDurationMs: 1000,
    idleFlushGraceMs: 25,
  };
}

/**
 * Sanitizadores canónicos compartidos por `normalizeBigTradeConfig` y
 * `normalizeBigTradesSettings` (settings.ts). Antes cada normalize definía su
 * propia copia idéntica de `num`/`bool`; ahora hay una sola implementación.
 */
export function clampFiniteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}
export function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Sanea cualquier entrada externa (HTTP/JSON/localStorage) y garantiza invariantes. */
export function normalizeBigTradeConfig(
  input: Partial<BigTradeConfig> | null | undefined,
  symbol: string
): BigTradeConfig {
  const d = defaultBigTradeConfig(symbol);
  const num = clampFiniteNumber;
  const bool = coerceBoolean;
  let useUsdFilter = bool(input?.useUsdFilter, d.useUsdFilter);
  const useZFilter = bool(input?.useZFilter, d.useZFilter);
  // Invariante: al menos un filtro activo, si no el módulo no emitiría nunca.
  if (!useUsdFilter && !useZFilter) useUsdFilter = true;
  return {
    tauMs: num(input?.tauMs, d.tauMs, 1, 5_000),
    windowSize: Math.round(num(input?.windowSize, d.windowSize, 50, 20_000)),
    zCut: num(input?.zCut, d.zCut, 0.5, 20),
    minNotionalUsd: num(input?.minNotionalUsd, d.minNotionalUsd, 1, 1_000_000_000),
    useUsdFilter,
    useZFilter,
    minZSamples: Math.round(num(input?.minZSamples, d.minZSamples, 10, 5_000)),
    maxBlockDurationMs: num(input?.maxBlockDurationMs, d.maxBlockDurationMs, 0, 60_000),
    idleFlushGraceMs: num(input?.idleFlushGraceMs, d.idleFlushGraceMs, 0, 1_000),
  };
}

// ───────────────────── Ventana deslizante O(1) (μ, σ) ─────────────────────

/**
 * Estadísticos de ventana deslizante con memoria FIJA: un `Float64Array(M)` circular.
 *
 * Media y varianza se actualizan en O(1) por muestra con la forma deslizante de Welford
 * (numéricamente estable; evita la cancelación catastrófica de Σx² − (Σx)²/n):
 *
 *   ventana llena, se reemplaza x_old por x_new:
 *     μ'  = μ + (x_new − x_old) / n
 *     M2' = M2 + (x_new − x_old) · (x_new − μ' + x_old − μ)      con σ² = M2 / n
 *
 * σ es la desviación estándar POBLACIONAL (divide por n = M), tal como define el prompt:
 *     σ = √( (1/M) · Σ (N_j − μ)² )
 *
 * Cada `10·M` inserciones se recalcula exacto desde el buffer para acotar la deriva de
 * coma flotante acumulada.
 */
export class RollingStats {
  private readonly buffer: Float64Array;
  private head = 0;
  private count = 0;
  private mean = 0;
  private m2 = 0;
  private sinceRecompute = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new RangeError("RollingStats capacity must be an integer ≥ 2");
    }
    this.buffer = new Float64Array(capacity);
  }

  get size(): number {
    return this.count;
  }
  get mu(): number {
    return this.mean;
  }
  /** σ poblacional. */
  get sigma(): number {
    return this.count > 0 ? Math.sqrt(Math.max(0, this.m2 / this.count)) : 0;
  }

  push(value: number): void {
    if (!Number.isFinite(value)) return;
    if (this.count < this.capacity) {
      // Fase de llenado: Welford clásico (agregar).
      this.buffer[this.head] = value;
      this.head = (this.head + 1) % this.capacity;
      this.count += 1;
      const delta = value - this.mean;
      this.mean += delta / this.count;
      this.m2 += delta * (value - this.mean);
    } else {
      // Ventana llena: reemplazo del más antiguo (O(1), sin realocar).
      const old = this.buffer[this.head]!;
      this.buffer[this.head] = value;
      this.head = (this.head + 1) % this.capacity;
      const previousMean = this.mean;
      this.mean = previousMean + (value - old) / this.count;
      this.m2 += (value - old) * (value - this.mean + old - previousMean);
      if (this.m2 < 0) this.m2 = 0;
    }
    this.sinceRecompute += 1;
    if (this.sinceRecompute >= this.capacity * 10) this.recompute();
  }

  /** Z = (x − μ) / σ contra la ventana ACTUAL (sin incluir x). 0 si σ ≈ 0. */
  zScore(value: number): number {
    const sigma = this.sigma;
    return sigma > 1e-12 ? (value - this.mean) / sigma : 0;
  }

  /** Recalcula μ y M2 exactos desde el buffer (anti-deriva). */
  private recompute(): void {
    let sum = 0;
    for (let i = 0; i < this.count; i += 1) sum += this.buffer[i]!;
    const mean = this.count > 0 ? sum / this.count : 0;
    let m2 = 0;
    for (let i = 0; i < this.count; i += 1) {
      const d = this.buffer[i]! - mean;
      m2 += d * d;
    }
    this.mean = mean;
    this.m2 = m2;
    this.sinceRecompute = 0;
  }
}

// ───────────────────────────── Detector ─────────────────────────────

interface ActiveBlock {
  side: BigTradeSide;
  firstTimestamp: number;
  lastTimestamp: number;
  firstAggTradeId: number;
  lastAggTradeId: number;
  /** V_B = Σ v_i */
  volume: number;
  /** N_B = Σ v_i · p_i */
  notional: number;
  tradeCount: number;
}

/** Información de auditoría del último bloque cerrado (útil para persistencia/tests). */
export interface ClosedBlockInfo {
  event: BigTradeEvent;
  firstAggTradeId: number;
  lastAggTradeId: number;
  tradeCount: number;
}

export class BigTradeDetector {
  private config: BigTradeConfig;
  private stats: RollingStats;
  private block: ActiveBlock | null = null;
  private lastAggTradeId = -1;
  private lastIngestWallMs = 0;
  /** Cuando es true los bloques cerrados sólo alimentan μ/σ (precalentamiento). */
  private priming = false;

  constructor(readonly symbol: string, config?: Partial<BigTradeConfig>) {
    this.config = normalizeBigTradeConfig(config, symbol);
    this.stats = new RollingStats(this.config.windowSize);
  }

  getConfig(): BigTradeConfig {
    return { ...this.config };
  }

  getLastAggTradeId(): number {
    return this.lastAggTradeId;
  }

  getWindowStats(): { samples: number; mu: number; sigma: number } {
    return { samples: this.stats.size, mu: this.stats.mu, sigma: this.stats.sigma };
  }

  hasActiveBlock(): boolean {
    return this.block !== null;
  }

  /** Cambia la configuración. Si cambia M se reinicia la ventana (el resto aplica en caliente). */
  setConfig(config: Partial<BigTradeConfig>): void {
    const next = normalizeBigTradeConfig({ ...this.config, ...config }, this.symbol);
    if (next.windowSize !== this.config.windowSize) {
      this.stats = new RollingStats(next.windowSize);
    }
    this.config = next;
  }

  /**
   * Precalienta μ y σ con ejecuciones históricas SIN emitir eventos.
   * Debe llamarse antes de `ingest` en vivo.
   */
  prime(trades: readonly BigTradeInput[]): void {
    this.priming = true;
    try {
      for (const trade of trades) this.ingest(trade);
      this.closeBlock();
    } finally {
      this.priming = false;
    }
  }

  /**
   * Procesa UNA ejecución. Devuelve los bloques que se cerraron (0 o 1) y pasaron el filtro.
   * Ejecuciones duplicadas o fuera de orden (aggTradeId ≤ último) se ignoran.
   */
  ingest(trade: BigTradeInput, wallNowMs: number = Date.now()): BigTradeEvent[] {
    if (
      !Number.isFinite(trade.price) ||
      !Number.isFinite(trade.quantity) ||
      !Number.isFinite(trade.timestamp) ||
      trade.price <= 0 ||
      trade.quantity <= 0
    ) {
      return [];
    }
    if (trade.aggTradeId <= this.lastAggTradeId) return [];
    this.lastAggTradeId = trade.aggTradeId;
    this.lastIngestWallMs = wallNowMs;

    // s_i: comprador maker ⇒ agresor vendedor.
    const side: BigTradeSide = trade.buyerIsMaker ? "SELL" : "BUY";
    const emitted: BigTradeEvent[] = [];
    const current = this.block;

    if (current) {
      const dt = trade.timestamp - current.lastTimestamp; // Δt = t_i − t_{i−1}
      const exceedsMaxDuration =
        this.config.maxBlockDurationMs > 0 &&
        trade.timestamp - current.firstTimestamp > this.config.maxBlockDurationMs;
      // Condición de agrupación: Δt ≤ τ  y  s_i = s_{i−1}.
      if (dt <= this.config.tauMs && side === current.side && !exceedsMaxDuration) {
        current.volume += trade.quantity; // V_B += v_i
        current.notional += trade.quantity * trade.price; // N_B += v_i · p_i
        current.lastTimestamp = Math.max(current.lastTimestamp, trade.timestamp);
        current.lastAggTradeId = trade.aggTradeId;
        current.tradeCount += 1;
        return emitted;
      }
      const closed = this.closeBlock();
      if (closed) emitted.push(closed.event);
    }

    this.block = {
      side,
      firstTimestamp: trade.timestamp,
      lastTimestamp: trade.timestamp,
      firstAggTradeId: trade.aggTradeId,
      lastAggTradeId: trade.aggTradeId,
      volume: trade.quantity,
      notional: trade.quantity * trade.price,
      tradeCount: 1,
    };
    return emitted;
  }

  /** Cierra el bloque activo si lleva más de τ + gracia sin recibir ejecuciones (reloj local). */
  flushIfIdle(wallNowMs: number = Date.now()): BigTradeEvent[] {
    if (!this.block) return [];
    if (wallNowMs - this.lastIngestWallMs < this.config.tauMs + this.config.idleFlushGraceMs) {
      return [];
    }
    const closed = this.closeBlock();
    return closed ? [closed.event] : [];
  }

  /** Cierra incondicionalmente el bloque activo (apagado/reconexión). */
  flush(): BigTradeEvent[] {
    const closed = this.closeBlock();
    return closed ? [closed.event] : [];
  }

  /** Igual que `flush`/`ingest` pero devolviendo metadatos de auditoría (ids). */
  ingestDetailed(trade: BigTradeInput, wallNowMs: number = Date.now()): ClosedBlockInfo[] {
    return this.collectDetailed(() => this.ingest(trade, wallNowMs));
  }

  /**
   * Procesa un lote ya ordenado por aggTradeId. El detector conserva su barrera de
   * monotonía para ignorar duplicados, mientras el servicio puede mezclar REST + WS
   * sin arriesgar que un trade vivo adelantado bloquee el catch-up histórico.
   */
  ingestOrderedDetailed(trades: readonly BigTradeInput[], wallNowMs: number = Date.now()): ClosedBlockInfo[] {
    const ordered = [...trades].sort((a, b) => a.aggTradeId - b.aggTradeId);
    const closed: ClosedBlockInfo[] = [];
    for (const trade of ordered) closed.push(...this.ingestDetailed(trade, wallNowMs));
    return closed;
  }
  flushIfIdleDetailed(wallNowMs: number = Date.now()): ClosedBlockInfo[] {
    return this.collectDetailed(() => this.flushIfIdle(wallNowMs));
  }
  flushDetailed(): ClosedBlockInfo[] {
    return this.collectDetailed(() => this.flush());
  }

  // ── internos ──

  private detailedSink: ClosedBlockInfo[] | null = null;
  private collectDetailed(run: () => BigTradeEvent[]): ClosedBlockInfo[] {
    const sink: ClosedBlockInfo[] = [];
    this.detailedSink = sink;
    try {
      run();
    } finally {
      this.detailedSink = null;
    }
    return sink;
  }

  /**
   * Cierra el bloque activo, evalúa filtros y actualiza la ventana.
   *
   * Orden crítico: el Z-score se calcula contra la ventana PREVIA y sólo después el bloque
   * entra en ella. Si entrara antes, un bloque enorme inflaría σ y se auto-atenuaría.
   */
  private closeBlock(): ClosedBlockInfo | null {
    const block = this.block;
    this.block = null;
    if (!block) return null;

    const N = block.notional; // N_B
    const V = block.volume; // V_B
    const P = N / V; // P_B = N_B / V_B (VWAP del bloque)

    const enoughSamples = this.stats.size >= this.config.minZSamples;
    // F4: el Z-score se calcula sobre VOLUMEN puro (V_B), no sobre notional.
    // Con notional, un salto de precio con volumen normal generaba z gigantes
    // falsos (p. ej. 1.2e+13) porque el Z medía el salto de precio, no la
    // excepcionalidad del volumen.
    const z = this.stats.zScore(V); // Z_B = (V_B − μ_V) / σ_V
    const passUsd = this.config.useUsdFilter && N >= this.config.minNotionalUsd;
    const passZ = this.config.useZFilter && enoughSamples && z >= this.config.zCut;

    this.stats.push(V); // el bloque entra DESPUÉS de evaluarse

    // F4: AND estricto cuando ambos filtros están habilitados; si solo uno está
    // activo se respeta ese único filtro (el invariante garantiza ≥1 activo).
    const bothFilters = this.config.useUsdFilter && this.config.useZFilter;
    const passes = bothFilters ? passUsd && passZ : passUsd || passZ;
    if (this.priming || !passes) return null;

    const info: ClosedBlockInfo = {
      event: {
        event: "BIG_TRADE",
        symbol: this.symbol,
        timestamp: block.firstTimestamp,
        price: round(P, 8),
        volume_base: round(V, 8),
        notional_usd: round(N, 2),
        side: block.side,
        z_score: round(enoughSamples ? z : 0, 2),
        duration_ms: Math.max(0, block.lastTimestamp - block.firstTimestamp),
      },
      firstAggTradeId: block.firstAggTradeId,
      lastAggTradeId: block.lastAggTradeId,
      tradeCount: block.tradeCount,
    };
    this.detailedSink?.push(info);
    return info;
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
