/**
 * STOPRUNS (probables) — barrido de un máximo/mínimo previo con ráfaga agresiva y rechazo (lógica pura, sin I/O).
 *
 * Definición propia de athenAI. Se trabaja sobre barras cortas (barMs, 5 s por defecto) construidas SOLO con trades
 * reales (aggTrades). Para cada barra i:
 *   1. NIVEL: el máximo (o mínimo) más extremo de las barras en [i − lookbackMs, i − gapMs]. Es la referencia que
 *      el mercado "ve" y detrás de la cual hay stops.
 *   2. RUPTURA: la barra i supera la referencia en al menos `minBreakTicks` ticks (y la barra anterior no la había
 *      superado: es la primera ruptura).
 *   3. RÁFAGA: en las barras de la ruptura (de i hasta la barra ANTERIOR al rechazo) el volumen agresor en la dirección del
 *      barrido (BUY en un máximo, SELL en un mínimo) es ≥ `burstMult` × la mediana del volumen por barra del
 *      lookback, y representa ≥ `minShare` del volumen de esas barras.
 *   4. RECHAZO: dentro de `rejectBars` barras el cierre vuelve al otro lado del nivel (cierre < nivel en un máximo).
 * Solo se emiten barridos CONFIRMADOS (con rechazo). Un barrido que sigue de largo es una ruptura real, no un stoprun.
 *
 * Dirección: "HIGH" = se barrieron stops por encima (después el precio cae, sesgo bajista);
 *            "LOW"  = se barrieron stops por debajo (después el precio sube, sesgo alcista).
 *
 * Es una inferencia sobre trades (sin ver las órdenes stop): por eso todo es "probable"; "alta" solo si la ráfaga y el
 * rechazo superan con holgura los umbrales.
 */

export type StopRunDirection = "HIGH" | "LOW";
export type StopRunConfidence = "probable" | "alta";

export interface StopRunTrade {
  id: number;
  ts: number;
  price: number;
  qty: number;
  /** Lado AGRESOR. */
  side: "BUY" | "SELL";
}

export interface StopRunBar {
  /** Índice de barra = floor(ts / barMs). */
  idx: number;
  t: number;
  high: number;
  low: number;
  open: number;
  close: number;
  buyQty: number;
  sellQty: number;
}

export interface StopRunParams {
  barMs: number;
  /** Ventana hacia atrás donde se busca el nivel de referencia (ms). */
  lookbackMs: number;
  /** Las barras más recientes que esto (ms) no cuentan como referencia (evita "barrer" lo recién formado). */
  gapMs: number;
  /** Ruptura mínima sobre el nivel, en ticks. */
  minBreakTicks: number;
  /** Ráfaga: volumen agresor ≥ burstMult × mediana del volumen por barra. */
  burstMult: number;
  /** Fracción mínima del volumen de la ruptura que va en la dirección del barrido (0.5..1). */
  minShare: number;
  /** Barras máximas para el rechazo (cierre de vuelta dentro). */
  rejectBars: number;
  /** Barras con volumen mínimas en el lookback para fiarse de la mediana. */
  minBars: number;
}

export const STOPRUN_DEFAULTS: StopRunParams = {
  barMs: 5_000,
  lookbackMs: 300_000,
  gapMs: 15_000,
  minBreakTicks: 2,
  burstMult: 2,
  minShare: 0.6,
  rejectBars: 6,
  minBars: 12,
};

export const SR_MAX_EVENTS = 200;
/** Historia de barras que se conserva (ms). */
export const SR_MAX_HISTORY_MS = 3_600_000;

export interface StopRunEvent {
  /** Estable: dirección + nivel (en ticks) + barra de la ruptura. */
  id: string;
  direction: StopRunDirection;
  /** Nivel barrido (máximo/mínimo previo). */
  level: number;
  /** Extremo alcanzado durante el barrido. */
  extreme: number;
  /** Instante de la barra de ruptura y de la de rechazo. */
  breakT: number;
  rejectT: number;
  /** Volumen agresor en la dirección del barrido durante la ruptura y su proporción. */
  burstQty: number;
  share: number;
  /** Veces la mediana del volumen por barra. */
  burstMultiple: number;
  /** Distancia entre el extremo y el cierre de rechazo. */
  reversal: number;
  confidence: StopRunConfidence;
}

export function sanitizeStopRunParams(p?: Partial<StopRunParams> | null): StopRunParams {
  const d = STOPRUN_DEFAULTS;
  const n = (v: unknown, fb: number, lo: number, hi: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
  return {
    barMs: Math.round(n(p?.barMs, d.barMs, 1_000, 60_000)),
    lookbackMs: n(p?.lookbackMs, d.lookbackMs, 30_000, 3_600_000),
    gapMs: n(p?.gapMs, d.gapMs, 0, 300_000),
    minBreakTicks: n(p?.minBreakTicks, d.minBreakTicks, 0, 100),
    burstMult: n(p?.burstMult, d.burstMult, 1, 50),
    minShare: n(p?.minShare, d.minShare, 0.5, 1),
    rejectBars: Math.round(n(p?.rejectBars, d.rejectBars, 1, 60)),
    minBars: Math.round(n(p?.minBars, d.minBars, 3, 500)),
  };
}

/** Añade trades a las barras (orden ascendente por id). Devuelve el último id procesado. Muta `bars`. */
export function aggregateTradesIntoBars(bars: StopRunBar[], trades: readonly StopRunTrade[], barMs: number, afterId: number): number {
  let lastId = afterId;
  for (const tr of trades) {
    if (!(tr.id > lastId)) continue;
    if (!Number.isFinite(tr.ts) || !Number.isFinite(tr.price) || !(tr.qty > 0)) continue;
    lastId = tr.id;
    const idx = Math.floor(tr.ts / barMs);
    let bar = bars.length > 0 ? bars[bars.length - 1] : undefined;
    if (!bar || bar.idx < idx) {
      bar = { idx, t: idx * barMs, high: tr.price, low: tr.price, open: tr.price, close: tr.price, buyQty: 0, sellQty: 0 };
      bars.push(bar);
    } else if (bar.idx > idx) {
      // Trade tardío (fuera de orden): se busca su barra; si ya no existe se ignora.
      let found: StopRunBar | undefined;
      for (let k = bars.length - 2; k >= 0 && bars[k].idx >= idx; k -= 1) {
        if (bars[k].idx === idx) {
          found = bars[k];
          break;
        }
      }
      if (!found) continue;
      bar = found;
    }
    if (tr.price > bar.high) bar.high = tr.price;
    if (tr.price < bar.low) bar.low = tr.price;
    bar.close = tr.price;
    if (tr.side === "BUY") bar.buyQty += tr.qty;
    else bar.sellQty += tr.qty;
  }
  return lastId;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Detecta barridos confirmados en las barras. `tick` = tamaño mínimo de precio (step del libro).
 * `fromT`: solo se evalúan rupturas con barra ≥ fromT (para no reprocesar todo en cada llamada).
 */
export function detectStopRuns(bars: readonly StopRunBar[], tick: number, params: StopRunParams, fromT = Number.NEGATIVE_INFINITY): StopRunEvent[] {
  const out: StopRunEvent[] = [];
  if (!(tick > 0) || bars.length < 3) return out;
  const minBreak = params.minBreakTicks * tick;
  let i = 0;
  while (i < bars.length) {
    const bar = bars[i];
    if (bar.t < fromT) {
      i += 1;
      continue;
    }
    const refFrom = bar.t - params.lookbackMs;
    const refTo = bar.t - params.gapMs;
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    const vols: number[] = [];
    for (let k = i - 1; k >= 0; k -= 1) {
      const b = bars[k];
      if (b.t < refFrom) break;
      vols.push(b.buyQty + b.sellQty);
      if (b.t > refTo) continue;
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
    }
    if (vols.length < params.minBars || !Number.isFinite(hi) || !Number.isFinite(lo)) {
      i += 1;
      continue;
    }
    const med = median(vols);
    let ev: StopRunEvent | null = null;
    for (const direction of ["HIGH", "LOW"] as const) {
      const level = direction === "HIGH" ? hi : lo;
      const breaks = (b: StopRunBar): boolean => (direction === "HIGH" ? b.high >= level + minBreak : b.low <= level - minBreak);
      if (!breaks(bar)) continue;
      // Primera ruptura: la barra anterior (contigua en tiempo) no había superado ya el nivel.
      const before = i > 0 ? bars[i - 1] : null;
      if (before && bar.t - before.t <= params.barMs && breaks(before)) continue;
      let extreme = direction === "HIGH" ? bar.high : bar.low;
      let aggr = 0;
      let total = 0;
      let burstBars = 0;
      let rejectAt = -1;
      for (let j = i; j < bars.length && bars[j].idx - bar.idx <= params.rejectBars; j += 1) {
        const b = bars[j];
        extreme = direction === "HIGH" ? Math.max(extreme, b.high) : Math.min(extreme, b.low);
        const back = direction === "HIGH" ? b.close < level : b.close > level;
        // La barra de rechazo (si no es la propia ruptura) NO entra en la ráfaga: su venta/compra contraria
        // es el rechazo, no parte del barrido, y diluiría la proporción.
        if (!(back && j > i)) {
          aggr += direction === "HIGH" ? b.buyQty : b.sellQty;
          total += b.buyQty + b.sellQty;
          burstBars += 1;
        }
        if (back) {
          rejectAt = j;
          break;
        }
      }
      if (rejectAt < 0 || !(med > 0) || !(total > 0)) continue;
      const share = aggr / total;
      // Intensidad POR BARRA: la mediana es de UNA barra, así que el volumen agresor de la ruptura se divide entre las
      // barras que la forman. Antes se sumaban hasta 7 barras contra una sola mediana y una deriva lenta pasaba por ráfaga.
      const mult = aggr / (med * Math.max(1, burstBars));
      if (mult < params.burstMult || share < params.minShare) continue;
      const rej = bars[rejectAt];
      const reversal = direction === "HIGH" ? extreme - rej.close : rej.close - extreme;
      const strong = mult >= params.burstMult * 2 && share >= Math.min(0.95, params.minShare + 0.15) && reversal >= minBreak * 2;
      ev = {
        id: `${direction}:${Math.round(level / tick)}:${bar.t}`,
        direction,
        level,
        extreme,
        breakT: bar.t,
        rejectT: rej.t,
        burstQty: aggr,
        share,
        burstMultiple: mult,
        reversal,
        confidence: strong ? "alta" : "probable",
      };
      break;
    }
    if (ev) {
      out.push(ev);
      // Se salta hasta pasado el rechazo: un mismo barrido no se cuenta dos veces.
      const skipTo = ev.rejectT;
      while (i < bars.length && bars[i].t <= skipTo) i += 1;
      continue;
    }
    i += 1;
  }
  return out;
}

export interface StopRunSnapshot {
  v: 1;
  rows: Array<[string, 0 | 1, number, number, number, number, number, number, number, number]>;
}

/**
 * Serie incremental: acumula barras desde la cinta (independiente del tamaño de la cinta) y guarda los eventos.
 * Arranca vacía; los eventos aparecen en vivo y se conservan aunque la cinta se recorte.
 */
export class StopRunSeries {
  params: StopRunParams = { ...STOPRUN_DEFAULTS };
  private bars: StopRunBar[] = [];
  private lastId = 0;
  private evaluatedT = Number.NEGATIVE_INFINITY;
  private eventMap = new Map<string, StopRunEvent>();
  version = 0;

  setParams(p: Partial<StopRunParams> | null | undefined): void {
    const next = sanitizeStopRunParams(p);
    if (next.barMs !== this.params.barMs) {
      // Otra resolución de barra: las barras viejas ya no sirven.
      this.bars = [];
      this.lastId = 0;
      this.evaluatedT = Number.NEGATIVE_INFINITY;
    }
    this.params = next;
  }

  private sortedCache: StopRunEvent[] = [];
  private sortedVersion = -1;

  /** Más reciente primero; se ordena una vez por versión (antes: copia + sort en cada lectura). */
  get events(): StopRunEvent[] {
    if (this.sortedVersion !== this.version) {
      this.sortedCache = [...this.eventMap.values()].sort((a, b) => b.rejectT - a.rejectT);
      this.sortedVersion = this.version;
    }
    return this.sortedCache;
  }

  get barCount(): number {
    return this.bars.length;
  }

  reset(): void {
    this.bars = [];
    this.lastId = 0;
    this.evaluatedT = Number.NEGATIVE_INFINITY;
    this.eventMap.clear();
    this.version += 1;
  }

  update(trades: readonly StopRunTrade[], tick: number): void {
    if (!(tick > 0)) return;
    if (this.lastId === 0 && trades.length > 0) {
      // Primera vez: se ancla al último id para no reprocesar la cinta vieja como si fuera en vivo,
      // pero sus trades SÍ alimentan las barras (contexto del nivel); no se emiten eventos del pasado.
      this.lastId = aggregateTradesIntoBars(this.bars, trades, this.params.barMs, 0);
      const last = this.bars[this.bars.length - 1];
      this.evaluatedT = last ? last.t : Number.NEGATIVE_INFINITY;
      return;
    }
    const before = this.lastId;
    this.lastId = aggregateTradesIntoBars(this.bars, trades, this.params.barMs, this.lastId);
    if (this.lastId === before) return;
    const newest = this.bars[this.bars.length - 1];
    if (newest) {
      const cutoff = newest.t - SR_MAX_HISTORY_MS;
      let drop = 0;
      while (drop < this.bars.length && this.bars[drop].t < cutoff) drop += 1;
      if (drop > 0) this.bars.splice(0, drop);
    }
    // Se reevalúa desde la barra anterior a la última ya evaluada (un rechazo puede llegar en barras nuevas).
    const from = this.evaluatedT - this.params.barMs * (this.params.rejectBars + 1);
    const found = detectStopRuns(this.bars, tick, this.params, from);
    let changed = false;
    for (const e of found) {
      if (e.rejectT <= this.evaluatedT) continue; // ya cubierto por una evaluación anterior (o es pasado)
      if (!this.eventMap.has(e.id)) {
        this.eventMap.set(e.id, e);
        changed = true;
      }
    }
    // El último rechazo posible se confirma como mínimo una barra después; se avanza con margen de seguridad.
    if (newest) this.evaluatedT = Math.max(this.evaluatedT, newest.t - this.params.barMs);
    if (this.eventMap.size > SR_MAX_EVENTS) {
      const keep = [...this.eventMap.values()].sort((a, b) => b.rejectT - a.rejectT).slice(0, SR_MAX_EVENTS);
      this.eventMap = new Map(keep.map(e => [e.id, e]));
      changed = true;
    }
    if (changed) this.version += 1;
  }

  snapshot(max = 120): StopRunSnapshot {
    return {
      v: 1,
      rows: this.events.slice(0, max).map(e => [e.id, e.direction === "HIGH" ? 0 : 1, e.level, e.extreme, e.breakT, e.rejectT, e.burstQty, e.share, e.burstMultiple, e.reversal]),
    };
  }

  static restore(snap: unknown, params?: Partial<StopRunParams> | null): StopRunSeries | null {
    const s = snap as StopRunSnapshot | null;
    if (!s || s.v !== 1 || !Array.isArray(s.rows)) return null;
    const out = new StopRunSeries();
    out.setParams(params);
    for (const r of s.rows) {
      if (!Array.isArray(r) || r.length !== 10 || typeof r[0] !== "string" || (r[1] !== 0 && r[1] !== 1)) continue;
      const nums = r.slice(2) as number[];
      if (!nums.every(Number.isFinite)) continue;
      const [level, extreme, breakT, rejectT, burstQty, share, mult, reversal] = nums;
      out.eventMap.set(r[0], {
        id: r[0], direction: r[1] === 0 ? "HIGH" : "LOW", level, extreme, breakT, rejectT, burstQty, share, burstMultiple: mult, reversal,
        confidence: mult >= out.params.burstMult * 2 && share >= Math.min(0.95, out.params.minShare + 0.15) ? "alta" : "probable",
      });
    }
    return out;
  }
}
