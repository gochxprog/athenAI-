/**
 * Session CVD: Cumulative Volume Delta con auto-reset por sesión de mercado
 * y por día calendario.
 *
 * Módulo puro (sin React, sin DOM, sin red) para poder usarlo en cliente,
 * servidor y tests. Cada gráfico instancia su PROPIO `SessionCVDEngine`.
 *
 * Modelo: las 4 sesiones corren EN PARALELO, cada una con su ventana UTC real
 * y su propio reset. Las ventanas se solapan (p. ej. Londres y Nueva York entre
 * 12:30 y 15:30 UTC) y eso es correcto: cada CVD solo acumula trades dentro de
 * su ventana. Además hay una ventana DAY (00:00–24:00 UTC) que acumula todo el
 * día calendario y se reinicia a medianoche UTC: es el modo por defecto de la UI.
 * La UI elige cuál mostrar (DAY por defecto; AUTO = la sesión activa más reciente).
 *
 * Signo del delta (Binance aggTrade, `buyerIsMaker`):
 *   buyerIsMaker === false -> comprador agresivo (market buy)  -> +volumen
 *   buyerIsMaker === true  -> vendedor agresivo  (market sell) -> -volumen
 * Es el mismo criterio que usa el footprint (ask = !buyerIsMaker).
 */

export type SessionId = "SYD" | "TOK" | "LON" | "NY" | "DAY";

export interface SessionDefinition {
  id: SessionId;
  /** Nombre para mostrar en el badge. */
  label: string;
  /** Minuto UTC del día en que inicia (0..1439). */
  startMinuteUTC: number;
  /** Minuto UTC del día en que termina, exclusivo (0..1439). Si < start, cruza medianoche. */
  endMinuteUTC: number;
}

const MIN = 60_000;
const DAY_MS = 86_400_000;

/** Ventanas UTC según especificación. Editar aquí para cambiar horarios. */
export const SESSION_DEFINITIONS: readonly SessionDefinition[] = [
  { id: "SYD", label: "SYDNEY", startMinuteUTC: 22 * 60, endMinuteUTC: 7 * 60 },
  { id: "TOK", label: "TOKYO", startMinuteUTC: 0, endMinuteUTC: 9 * 60 },
  { id: "LON", label: "LONDON", startMinuteUTC: 7 * 60, endMinuteUTC: 15 * 60 + 30 },
  { id: "NY", label: "NEW YORK", startMinuteUTC: 12 * 60 + 30, endMinuteUTC: 21 * 60 },
  // DAY: día calendario completo (00:00–24:00 UTC). start == end => ventana de 24 h
  // (ver durationMs): acumula todos los trades del día y se reinicia a medianoche UTC.
  { id: "DAY", label: "DAILY", startMinuteUTC: 0, endMinuteUTC: 0 },
];

export const SESSION_IDS: readonly SessionId[] = SESSION_DEFINITIONS.map(item => item.id);

export function getSessionDefinition(id: SessionId): SessionDefinition {
  const found = SESSION_DEFINITIONS.find(item => item.id === id);
  if (!found) throw new Error(`Unknown session ${id}`);
  return found;
}

export interface SessionInstance {
  id: SessionId;
  /** Identidad única de la instancia: nombre + inicio exacto. Evita resets perdidos entre días. */
  key: string;
  startMs: number;
  endMs: number;
  /** true si `timestamp < endMs` (la sesión sigue abierta en ese instante). */
  active: boolean;
}

function durationMs(def: SessionDefinition): number {
  const minutes = (def.endMinuteUTC - def.startMinuteUTC + 1440) % 1440;
  return (minutes === 0 ? 1440 : minutes) * MIN;
}

/**
 * Instancia más reciente de la sesión cuyo inicio es <= timestamp.
 * `active` indica si el timestamp todavía cae dentro de su ventana.
 */
export function getLatestSessionInstance(def: SessionDefinition, timestamp: number): SessionInstance {
  const dayStart = Math.floor(timestamp / DAY_MS) * DAY_MS;
  const todayStart = dayStart + def.startMinuteUTC * MIN;
  const startMs = todayStart <= timestamp ? todayStart : todayStart - DAY_MS;
  const endMs = startMs + durationMs(def);
  return { id: def.id, key: `${def.id}@${startMs}`, startMs, endMs, active: timestamp < endMs };
}

/** Instancia de la sesión que contiene el timestamp, o null si está fuera de ventana. */
export function getSessionWindow(def: SessionDefinition, timestamp: number): SessionInstance | null {
  const instance = getLatestSessionInstance(def, timestamp);
  return instance.active ? instance : null;
}

/**
 * Sesión que muestra el modo AUTO: la activa que inició más recientemente
 * (a las 13:00 UTC -> NY, no LON). Si ninguna está activa (21:00–22:00 UTC),
 * la que inició más recientemente (queda congelada y marcada como cerrada).
 * DAY no participa: es una ventana diaria explícita, no una sesión de mercado.
 */
export function pickAutoSession(timestamp: number): SessionInstance {
  const latest = SESSION_DEFINITIONS.filter(def => def.id !== "DAY").map(def =>
    getLatestSessionInstance(def, timestamp),
  );
  const active = latest.filter(item => item.active);
  const pool = active.length > 0 ? active : latest;
  return pool.reduce((best, item) => (item.startMs > best.startMs ? item : best));
}

export interface CVDTick {
  timestamp: number;
  price: number;
  volume: number;
  isBuyerMaker: boolean;
  /**
   * Id único del trade (p. ej. aggTradeId de Binance). Si se provee, el engine
   * deduplica internamente (M8): un trade re-entregado no se suma dos veces.
   */
  id?: number;
}

export interface SessionCVDPoint {
  /** Inicio del bucket (múltiplo de bucketMs). */
  t: number;
  /** CVD de la sesión al cierre del bucket. */
  cvd: number;
  /** Clave de la instancia: un cambio de clave entre puntos consecutivos = reset. */
  instanceKey: string;
}

export interface SessionCVDState {
  id: SessionId;
  instance: SessionInstance | null;
  cvd: number;
  buyVolume: number;
  sellVolume: number;
  /** Minutos distintos de la instancia actual en los que se recibió algún dato (para detectar huecos). */
  minutesWithData: number;
  points: SessionCVDPoint[];
}

export interface TickResult {
  /** CVD de la sesión AUTO tras aplicar el tick. */
  cvd: number;
  /** Sesión AUTO. */
  session: SessionId;
  /** true si ESTE tick provocó el reset de la sesión AUTO. */
  isReset: boolean;
  /** Sesiones que se resetearon con este tick (puede ser más de una). */
  resets: SessionId[];
}

export interface SessionCVDEngineOptions {
  symbol: string;
  /** Resolución del historial. Mínimo 60_000 (el backfill llega por minuto). */
  bucketMs?: number;
  /** Tope de puntos guardados por sesión. */
  maxPointsPerSession?: number;
}

interface Accumulator {
  instance: SessionInstance | null;
  cvd: number;
  buyVolume: number;
  sellVolume: number;
  minutesWithData: number;
  /** Minutos (epoch) ya contados en la instancia actual: evita doble conteo con trades tardíos (H-1). */
  seenMinutes: Set<number>;
  points: SessionCVDPoint[];
}

export class SessionCVDEngine {
  readonly symbol: string;
  readonly bucketMs: number;
  private readonly maxPoints: number;
  private readonly accumulators = new Map<SessionId, Accumulator>();
  private lastTimestamp = 0;
  /** M8: dedup interna — ventana acotada de IDs de trades ya procesados. */
  private readonly seenIds = new Set<number>();
  private static readonly MAX_SEEN_IDS = 10_000;
  /**
   * athenAI: anillo de tamaño fijo para expulsar el ID más antiguo en O(1).
   * Antes se usaba `array.shift()` sobre 10.000 elementos por cada trade (O(n) por trade).
   */
  private readonly seenRing = new Float64Array(SessionCVDEngine.MAX_SEEN_IDS);
  private seenHead = 0;
  private seenCount = 0;

  constructor(options: SessionCVDEngineOptions) {
    this.symbol = options.symbol.toUpperCase();
    this.bucketMs = Math.max(MIN, Math.floor(options.bucketMs ?? MIN));
    this.maxPoints = options.maxPointsPerSession ?? 6_000;
    this.reset();
  }

  /** Vacía todo el estado (se usa antes de re-sembrar desde el backfill). */
  reset(): void {
    this.accumulators.clear();
    this.lastTimestamp = 0;
    this.seenIds.clear();
    this.seenHead = 0;
    this.seenCount = 0;
    for (const id of SESSION_IDS) {
      this.accumulators.set(id, { instance: null, cvd: 0, buyVolume: 0, sellVolume: 0, minutesWithData: 0, seenMinutes: new Set(), points: [] });
    }
  }

  /** Procesa un trade individual. */
  processTick(tick: CVDTick): TickResult {
    if (!this.rememberTick(tick.id)) {
      // Duplicado: no se acumula, se devuelve el estado actual.
      return this.buildResult(tick.timestamp, []);
    }
    const buy = tick.isBuyerMaker ? 0 : tick.volume;
    const sell = tick.isBuyerMaker ? tick.volume : 0;
    const resets = this.applyFlow(tick.timestamp, buy, sell);
    return this.buildResult(tick.timestamp, resets);
  }

  /**
   * M8: registra el ID del tick si es nuevo. Ventana acotada (FIFO): un ID
   * expulsado por antigüedad podría re-entrar, igual que en el hook.
   */
  private rememberTick(id: number | undefined): boolean {
    if (id === undefined) return true;
    if (this.seenIds.has(id)) return false;
    this.seenIds.add(id);
    const cap = SessionCVDEngine.MAX_SEEN_IDS;
    if (this.seenCount === cap) {
      // Anillo lleno: el hueco que se sobrescribe es el ID más antiguo.
      this.seenIds.delete(this.seenRing[this.seenHead]);
      this.seenRing[this.seenHead] = id;
      this.seenHead = (this.seenHead + 1) % cap;
    } else {
      this.seenRing[(this.seenHead + this.seenCount) % cap] = id;
      this.seenCount += 1;
    }
    return true;
  }

  /**
   * Aplica volumen ya agregado (backfill por minuto). Los límites de sesión
   * son minutos exactos, así que un agregado por minuto es exacto.
   */
  applyAggregate(timestamp: number, buyVolume: number, sellVolume: number): TickResult {
    const resets = this.applyFlow(timestamp, buyVolume, sellVolume);
    return this.buildResult(timestamp, resets);
  }

  getState(id: SessionId): SessionCVDState {
    const acc = this.accumulators.get(id)!;
    return {
      id,
      instance: acc.instance,
      cvd: acc.cvd,
      buyVolume: acc.buyVolume,
      sellVolume: acc.sellVolume,
      minutesWithData: acc.minutesWithData,
      points: acc.points,
    };
  }

  /** Marca de tiempo del último dato procesado (0 si no hay). */
  getLastTimestamp(): number {
    return this.lastTimestamp;
  }

  private applyFlow(timestamp: number, buy: number, sell: number): SessionId[] {
    const resets: SessionId[] = [];
    if (!Number.isFinite(timestamp) || !(buy >= 0) || !(sell >= 0)) return resets;
    if (timestamp > this.lastTimestamp) this.lastTimestamp = timestamp;

    for (const def of SESSION_DEFINITIONS) {
      const instance = getSessionWindow(def, timestamp);
      if (!instance) continue; // fuera de ventana: esta sesión ignora el trade
      const acc = this.accumulators.get(def.id)!;

      if (acc.instance && instance.startMs < acc.instance.startMs) continue; // trade tardío de una instancia vieja

      if (!acc.instance || acc.instance.key !== instance.key) {
        // Auto-reset: nueva instancia (nombre + fecha de inicio distinta).
        acc.cvd = 0;
        acc.buyVolume = 0;
        acc.sellVolume = 0;
        acc.minutesWithData = 0;
        acc.seenMinutes = new Set();
        acc.instance = instance;
        resets.push(def.id);
      }

      const minute = Math.floor(timestamp / MIN);
      if (!acc.seenMinutes.has(minute)) {
        acc.seenMinutes.add(minute);
        acc.minutesWithData += 1;
      }

      acc.buyVolume += buy;
      acc.sellVolume += sell;
      acc.cvd += buy - sell;
      this.writePoint(acc, timestamp, buy, sell);
    }
    return resets;
  }

  private writePoint(acc: Accumulator, timestamp: number, buy: number, sell: number): void {
    const t = Math.floor(timestamp / this.bucketMs) * this.bucketMs;
    const key = acc.instance!.key;
    const last = acc.points.at(-1);
    if (last && last.t === t && last.instanceKey === key) {
      last.cvd = acc.cvd;
      return;
    }
    if (!last || last.instanceKey !== key || t > last.t) {
      // En orden (o primer punto de la instancia): push normal al final.
      acc.points.push({ t, cvd: acc.cvd, instanceKey: key });
      if (acc.points.length > this.maxPoints) acc.points.splice(0, acc.points.length - this.maxPoints);
      return;
    }
    // Trade tardío (t < last.t) de la misma instancia: NO hacer push — rompería
    // el orden cronológico del array y asignaría el acumulado actual a un punto
    // histórico (H-1). En su lugar se propaga el delta firmado al bucket
    // correspondiente y a todos los posteriores de la instancia; el total
    // acc.cvd ya incluye este trade, así que los puntos futuros quedan bien.
    const delta = buy - sell;
    if (delta !== 0) {
      for (const point of acc.points) {
        if (point.instanceKey === key && point.t >= t) point.cvd += delta;
      }
    }
  }

  private buildResult(timestamp: number, resets: SessionId[]): TickResult {
    const auto = pickAutoSession(timestamp);
    return {
      cvd: this.accumulators.get(auto.id)!.cvd,
      session: auto.id,
      isReset: resets.includes(auto.id),
      resets,
    };
  }
}

/**
 * Rango Y auto-escalado usando SOLO los puntos dentro de la ventana visible.
 * Devuelve null si no hay puntos. Añade un margen y garantiza rango > 0.
 */
export function computeVisibleYRange(
  points: readonly SessionCVDPoint[],
  startMs: number,
  endMs: number,
  paddingRatio = 0.08,
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.t < startMs || point.t > endMs) continue;
    if (point.cvd < min) min = point.cvd;
    if (point.cvd > max) max = point.cvd;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = max - min;
  const pad = span > 0 ? span * paddingRatio : Math.max(Math.abs(max) * 0.05, 1);
  return { min: min - pad, max: max + pad };
}
