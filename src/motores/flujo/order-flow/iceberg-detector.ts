/**
 * ICEBERGS (probables) — órdenes que se REPONEN en un nivel del libro (lógica pura, sin I/O).
 *
 * Definición propia de athenAI. Sin datos MBO no se ve la orden oculta: se INFIERE comparando, para cada par de columnas
 * REALES consecutivas del historial del libro (≈ 1 por segundo), lo que se ejecutó en un nivel contra lo que el libro
 * muestra:
 *   consumido  = min(fill, visible_antes)             fill = trades agresores que golpearon ese nivel en el intervalo
 *   esperado   = max(0, visible_antes − fill)          lo que debería quedar si nadie repone
 *   repuesto   = max(0, visible_después − esperado)    cantidad que reapareció
 *   recarga    = repuesto ≥ RELOAD_FRAC × consumido    (la punta visible volvió a llenarse)
 *
 * Por nivel (y lado pasivo) se acumula: ejecutado total, repuesto total, pico visible y nº de recargas. Un nivel se
 * PROMUEVE a iceberg cuando:
 *   ejecutado ≥ minMultiple × pico visible   (se negoció mucho más de lo que se llegó a ver)
 *   recargas  ≥ minReloads                   (y se repuso varias veces, no una sola)
 *   ejecutado ≥ minQty
 * Lado: un trade agresor BUY golpea un ASK (iceberg de venta); un agresor SELL golpea un BID (iceberg de compra).
 *
 * Es una inferencia: otro participante puede reponer liquidez en el mismo precio. Por eso todo se marca "probable"
 * (confianza "alta" solo si los números superan con holgura los umbrales). Nada se inventa: los huecos largos se
 * saltan. Con una fuente MBO bastará con alimentar `IcebergEvent` desde ella.
 */

export type IcebergSide = "BID" | "ASK";
export type IcebergConfidence = "probable" | "alta";

/** Estructural: `LiquidityColumn` del cliente lo cumple sin importarlo (shared no depende de client). */
export interface IcebergColumn {
  t: number;
  minIdx: number;
  bestBidIdx: number;
  sizes: ArrayLike<number>;
}

export interface IcebergHistory {
  readonly size: number;
  readonly step: number;
  get(index: number): IcebergColumn | undefined;
}

export interface IcebergTrade {
  ts: number;
  price: number;
  qty: number;
  /** Lado AGRESOR. */
  side: "BUY" | "SELL";
}

export interface IcebergParams {
  /** Ejecutado ÷ pico visible mínimo para promover (≥ 1). */
  minMultiple: number;
  /** Recargas mínimas del nivel. */
  minReloads: number;
  /** Cantidad ejecutada mínima (unidades del activo). 0 = sin filtro. */
  minQty: number;
  /** Sin ejecuciones durante este tiempo → el candidato/evento se da por terminado. */
  idleMs: number;
  /** Niveles alrededor del mejor bid que se vigilan. */
  bandLevels: number;
}

export const ICEBERG_DEFAULTS: IcebergParams = { minMultiple: 3, minReloads: 3, minQty: 0, idleMs: 30_000, bandLevels: 60 };

export const ICE_RELOAD_FRAC = 0.5;
/**
 * Una recarga solo se cuenta si lo consumido es una fracción material de lo visible. Con consumos minúsculos
 * (p. ej. 0.01 de 100) cualquier orden nueva de 1 lote "repone" ≥ 50 % de lo consumido: ruido, no iceberg.
 */
export const ICE_MIN_CONSUMED_FRAC = 0.1;
export const ICE_MAX_GAP_MS = 5_000;
export const ICE_MAX_CANDIDATES = 400;
export const ICE_MAX_EVENTS = 200;
export const ICE_MAX_CATCHUP_COLUMNS = 600;

export interface IcebergEvent {
  /** Estable: lado + nivel + instante de la primera ejecución. */
  id: string;
  side: IcebergSide;
  idx: number;
  price: number;
  firstT: number;
  lastT: number;
  filled: number;
  refilled: number;
  peakVisible: number;
  reloads: number;
  /** filled ÷ peakVisible. */
  ratio: number;
  confidence: IcebergConfidence;
  /** true mientras siga recibiendo ejecuciones (no ha pasado idleMs). */
  active: boolean;
  /** Instante en que cumplió los umbrales y se mostró. */
  promotedT: number;
}

interface Candidate {
  side: IcebergSide;
  idx: number;
  firstT: number;
  lastFillT: number;
  filled: number;
  refilled: number;
  peakVisible: number;
  reloads: number;
  eventId: string | null;
}

/** Liquidez visible de un nivel en una columna (0 si no hay). Compartida con Fill:Kill (antes duplicada). */
export const sizeAt = (col: IcebergColumn, idx: number): number => {
  const rel = idx - col.minIdx;
  if (rel < 0 || rel >= col.sizes.length) return 0;
  const v = col.sizes[rel];
  return Number.isFinite(v) && v > 0 ? v : 0;
};

export const iceKey = (side: IcebergSide, idx: number): string => `${side}:${idx}`;

export function sanitizeIcebergParams(p?: Partial<IcebergParams> | null): IcebergParams {
  const d = ICEBERG_DEFAULTS;
  const n = (v: unknown, fb: number, lo: number, hi: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
  return {
    minMultiple: n(p?.minMultiple, d.minMultiple, 1, 50),
    minReloads: Math.round(n(p?.minReloads, d.minReloads, 1, 20)),
    minQty: n(p?.minQty, d.minQty, 0, 1_000_000),
    idleMs: n(p?.idleMs, d.idleMs, 2_000, 600_000),
    bandLevels: Math.round(n(p?.bandLevels, d.bandLevels, 5, 200)),
  };
}

/** Confianza: "alta" solo si ejecutado y recargas superan con holgura (el doble) los umbrales. */
export function icebergConfidence(ratio: number, reloads: number, p: IcebergParams): IcebergConfidence {
  return ratio >= p.minMultiple * 2 && reloads >= p.minReloads * 2 ? "alta" : "probable";
}

/** Fill por nivel entre dos instantes, separado por lado pasivo. Puro. */
export function fillsByLevel(
  prev: IcebergColumn,
  cur: IcebergColumn,
  trades: readonly IcebergTrade[],
  step: number,
  band: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const lo = cur.bestBidIdx - band;
  const hi = cur.bestBidIdx + band;
  for (let i = trades.length - 1; i >= 0; i -= 1) {
    const tr = trades[i];
    if (tr.ts <= prev.t) break; // la cinta viene ordenada: más antiguo → más reciente
    if (tr.ts > cur.t) continue;
    if (!(tr.qty > 0) || !Number.isFinite(tr.price)) continue;
    // BUY agresor consume ASK; SELL agresor consume BID. El lado debe cuadrar con el libro de ese instante.
    const side: IcebergSide = tr.side === "BUY" ? "ASK" : "BID";
    // Mismo cubo que el libro agrupado: los asks se agrupan hacia ARRIBA y los bids hacia ABAJO (order-book.ts).
    // Con Math.round, un trade a 85.000,3 contra el ask caía en el cubo 85.000 (un bid) y se descartaba o se
    // atribuía al nivel equivocado. Con step = tick (sin agrupar) ceil/floor/round dan lo mismo.
    const q = tr.price / step;
    const idx = side === "ASK" ? Math.ceil(q - 1e-9) : Math.floor(q + 1e-9);
    if (idx < lo || idx > hi) continue;
    if (side === "ASK" && idx <= prev.bestBidIdx) continue;
    if (side === "BID" && idx > prev.bestBidIdx) continue;
    const k = iceKey(side, idx);
    out.set(k, (out.get(k) ?? 0) + tr.qty);
  }
  return out;
}

/**
 * Un paso (par de columnas). Muta `candidates` y devuelve los eventos que cambiaron (nuevos o actualizados).
 * Puro respecto al exterior: no lee reloj ni almacenamiento. Devuelve true si algún evento cambió.
 */
export function stepIcebergs(
  candidates: Map<string, Candidate>,
  prev: IcebergColumn,
  cur: IcebergColumn,
  trades: readonly IcebergTrade[],
  step: number,
  params: IcebergParams,
  events: Map<string, IcebergEvent>,
): boolean {
  let changed = false;
  const fills = fillsByLevel(prev, cur, trades, step, params.bandLevels);
  for (const [key, fill] of fills) {
    const sep = key.indexOf(":");
    const side = key.slice(0, sep) as IcebergSide;
    const idx = Number(key.slice(sep + 1));
    const before = sizeAt(prev, idx);
    // Un iceberg siempre muestra su punta: sin liquidez visible antes no hay nada que comparar.
    if (!(before > 0)) continue;
    const after = sizeAt(cur, idx);
    const consumed = Math.min(fill, before);
    const expected = Math.max(0, before - fill);
    const replenished = Math.max(0, after - expected);
    const isReload = consumed >= ICE_MIN_CONSUMED_FRAC * before && replenished >= ICE_RELOAD_FRAC * consumed && replenished > 0;
    let c = candidates.get(key);
    if (!c) {
      c = { side, idx, firstT: cur.t, lastFillT: cur.t, filled: 0, refilled: 0, peakVisible: 0, reloads: 0, eventId: null };
      candidates.set(key, c);
    }
    c.lastFillT = cur.t;
    c.filled += fill;
    c.refilled += replenished;
    c.peakVisible = Math.max(c.peakVisible, before);
    if (isReload) c.reloads += 1;

    const ratio = c.peakVisible > 0 ? c.filled / c.peakVisible : 0;
    const qualifies = ratio >= params.minMultiple && c.reloads >= params.minReloads && c.filled >= params.minQty;
    if (qualifies || c.eventId) {
      if (!c.eventId) c.eventId = `${side}:${idx}:${c.firstT}`;
      const prevEv = events.get(c.eventId);
      events.set(c.eventId, {
        id: c.eventId,
        side,
        idx,
        price: idx * step,
        firstT: c.firstT,
        lastT: cur.t,
        filled: c.filled,
        refilled: c.refilled,
        peakVisible: c.peakVisible,
        reloads: c.reloads,
        ratio,
        confidence: icebergConfidence(ratio, c.reloads, params),
        active: true,
        promotedT: prevEv?.promotedT ?? cur.t,
      });
      changed = true;
    }
  }
  // Cierre por inactividad.
  for (const [key, c] of candidates) {
    if (cur.t - c.lastFillT <= params.idleMs) continue;
    if (c.eventId) {
      const ev = events.get(c.eventId);
      if (ev && ev.active) {
        events.set(c.eventId, { ...ev, active: false });
        changed = true;
      }
    }
    candidates.delete(key);
  }
  // Tope de candidatos: se descartan los sin evento más viejos.
  if (candidates.size > ICE_MAX_CANDIDATES) {
    const drop = [...candidates.entries()]
      .filter(([, c]) => !c.eventId)
      .sort((a, b) => a[1].lastFillT - b[1].lastFillT)
      .slice(0, candidates.size - ICE_MAX_CANDIDATES);
    for (const [k] of drop) candidates.delete(k);
  }
  return changed;
}

/** Evento comprimido para guardar en disco. */
export type IcebergSnapshotRow = [id: string, side: 0 | 1, idx: number, price: number, firstT: number, lastT: number, filled: number, refilled: number, peak: number, reloads: number, promotedT: number];

export interface IcebergSnapshot {
  v: 1;
  lastT: number | null;
  rows: IcebergSnapshotRow[];
}

/**
 * Seguidor incremental: procesa solo columnas nuevas. Arranca VACÍO (la primera llamada solo ancla el "ahora"),
 * igual que Fill:Kill, para no mezclar el pasado.
 */
export class IcebergTracker {
  private candidates = new Map<string, Candidate>();
  private eventMap = new Map<string, IcebergEvent>();
  private lastT = Number.NEGATIVE_INFINITY;
  params: IcebergParams = { ...ICEBERG_DEFAULTS };
  /** Cambia al añadir/actualizar eventos (para que el dibujo sepa si redibujar). */
  version = 0;

  setParams(p: Partial<IcebergParams> | null | undefined): void {
    this.params = sanitizeIcebergParams(p);
  }

  private sortedCache: IcebergEvent[] = [];
  private sortedVersion = -1;

  /** Eventos, el más reciente primero. Se ordena una vez por versión (antes: copia + sort en CADA lectura). */
  get events(): IcebergEvent[] {
    if (this.sortedVersion !== this.version) {
      this.sortedCache = [...this.eventMap.values()].sort((a, b) => b.lastT - a.lastT);
      this.sortedVersion = this.version;
    }
    return this.sortedCache;
  }

  reset(): void {
    this.candidates.clear();
    this.eventMap.clear();
    this.lastT = Number.NEGATIVE_INFINITY;
    this.version += 1;
  }

  update(history: IcebergHistory, trades: readonly IcebergTrade[]): void {
    const n = history.size;
    const step = history.step;
    if (n < 1 || !(step > 0)) return;
    if (this.lastT === Number.NEGATIVE_INFINITY) {
      const latest = history.get(n - 1);
      if (latest) this.lastT = latest.t;
      return;
    }
    if (n < 2) return;
    let i = n - 1;
    while (i >= 1 && n - 1 - i < ICE_MAX_CATCHUP_COLUMNS) {
      const c = history.get(i);
      if (!c || c.t <= this.lastT) break;
      i -= 1;
    }
    let changed = false;
    for (let j = Math.max(1, i + 1); j < n; j += 1) {
      const prev = history.get(j - 1);
      const cur = history.get(j);
      if (!prev || !cur || cur.t <= this.lastT) continue;
      this.lastT = cur.t;
      const dt = cur.t - prev.t;
      if (!(dt > 0) || dt > ICE_MAX_GAP_MS) continue;
      if (stepIcebergs(this.candidates, prev, cur, trades, step, this.params, this.eventMap)) changed = true;
    }
    if (this.eventMap.size > ICE_MAX_EVENTS) {
      const keep = [...this.eventMap.values()].sort((a, b) => b.lastT - a.lastT).slice(0, ICE_MAX_EVENTS);
      this.eventMap = new Map(keep.map(e => [e.id, e]));
      changed = true;
    }
    if (changed) this.version += 1;
  }

  snapshot(max = 120): IcebergSnapshot {
    const rows = this.events.slice(0, max).map<IcebergSnapshotRow>(e => [
      e.id, e.side === "BID" ? 0 : 1, e.idx, e.price, e.firstT, e.lastT, e.filled, e.refilled, e.peakVisible, e.reloads, e.promotedT,
    ]);
    return { v: 1, lastT: Number.isFinite(this.lastT) ? this.lastT : null, rows };
  }

  static restore(snap: unknown, params?: Partial<IcebergParams> | null): IcebergTracker | null {
    const s = snap as IcebergSnapshot | null;
    if (!s || s.v !== 1 || !Array.isArray(s.rows)) return null;
    const out = new IcebergTracker();
    out.setParams(params);
    for (const r of s.rows) {
      if (!Array.isArray(r) || r.length !== 11 || typeof r[0] !== "string") continue;
      const nums = r.slice(2) as number[];
      if (!nums.every(Number.isFinite) || (r[1] !== 0 && r[1] !== 1)) continue;
      const [idx, price, firstT, lastT, filled, refilled, peak, reloads, promotedT] = nums;
      const ratio = peak > 0 ? filled / peak : 0;
      out.eventMap.set(r[0], {
        id: r[0], side: r[1] === 0 ? "BID" : "ASK", idx, price, firstT, lastT, filled, refilled, peakVisible: peak, reloads, ratio,
        confidence: icebergConfidence(ratio, reloads, out.params), active: false, promotedT,
      });
    }
    // Tras recargar, el pasado no se reprocesa: solo cuentan columnas posteriores al primer update.
    return out;
  }
}
