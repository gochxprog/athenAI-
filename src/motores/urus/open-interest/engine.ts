import type { NormalizedCandle } from "../market-data/types";
import type {
  OpenInterestCandleInput,
  OpenInterestCandlePoint,
  OpenInterestEngineOptions,
  OpenInterestProfile,
  OpenInterestProfileBucket,
  OpenInterestQuadrant,
  OpenInterestSnapshot,
  OpenInterestEngineResult,
} from "./types";

const DEFAULTS = {
  pollIntervalMs: 5_000,
  staleMultiplier: 2,
  robustWindow: 100,
  percentileWindowDays: 30,
  neutralPriceEpsilon: 0.0005,
  neutralZ: 0.5,
  flowZMin: 2,
  flowZMax: 4,
  flushZ: 2.5,
  flushAtrK: 1,
  accumulationZ: 2.5,
  accumulationAtrK: 0.5,
  atrPeriod: 14,
  divergenceWindow: 20,
  divergenceSlopeThreshold: 0.05,
  profileTopK: 5,
} as const;

function finite(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function median(values: readonly number[]): number | null {
  const xs = values.filter(finite).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}
function mad(values: readonly number[]): number | null {
  const m = median(values);
  if (m == null) return null;
  return median(values.filter(finite).map(v => Math.abs(v - m)));
}
/** Piso para el MAD: por debajo de esto la dispersión es ruido de punto flotante, no señal. */
export const ROBUST_Z_EPS = 1e-6;

/**
 * Z-score robusto = 0.6745 · (value − mediana) / MAD.
 * Devuelve 0 (nunca NaN ni ±Infinity) si el MAD es 0, es <= eps o alguna entrada no es finita.
 */
export function calculateRobustZScore(value: number, medianValue: number, madValue: number, eps: number = ROBUST_Z_EPS): number {
  if (!Number.isFinite(value) || !Number.isFinite(medianValue) || !Number.isFinite(madValue)) return 0;
  if (!(madValue > eps)) return 0;
  const z = 0.6745 * (value - medianValue) / madValue;
  return Number.isFinite(z) ? z : 0;
}

/** Invariante del perfil de OI: Σ deltas == OI_final − OI_inicial (tolerancia relativa de punto flotante). */
export function checkOIInvariant(oiInitial: number, oiFinal: number, deltas: readonly number[], tolerance: number = 1e-9): boolean {
  if (!Number.isFinite(oiInitial) || !Number.isFinite(oiFinal) || !deltas.every(Number.isFinite)) return false;
  const sum = deltas.reduce((acc, d) => acc + d, 0);
  const expected = oiFinal - oiInitial;
  return Math.abs(sum - expected) <= tolerance * Math.max(1, Math.abs(sum), Math.abs(expected));
}

/** true si el salto entre dos lecturas supera el máximo permitido (estrictamente mayor). Entradas inválidas → false. */
export function detectOIGap(lastTimestamp: number, currentTimestamp: number, maxThresholdMs: number): boolean {
  if (!Number.isFinite(lastTimestamp) || !Number.isFinite(currentTimestamp) || !(maxThresholdMs > 0)) return false;
  return currentTimestamp - lastTimestamp > maxThresholdMs;
}

export function robustZ(value: number | null, window: readonly number[]): number | null {
  if (value == null || !finite(value) || window.length === 0) return null;
  const m = median(window);
  const d = mad(window);
  if (m == null || d == null) return null;
  return calculateRobustZScore(value, m, d);
}
export function percentileRank(value: number | null, window: readonly number[]): number | null {
  if (value == null || !window.length) return null;
  const xs = window.filter(finite);
  if (!xs.length) return null;
  let below = 0;
  let equal = 0;
  for (const x of xs) { if (x < value) below++; else if (x === value) equal++; }
  return (below + equal * 0.5) / xs.length;
}
/**
 * M4: promedio SIMPLE de True Ranges (SMA), NO el ATR de Wilder (que usa
 * suavizado exponencial RMA). Se nombra explícitamente para no confundir los
 * umbrales de las señales de Flush/acumulación silenciosa con un ATR estándar:
 * con Wilder, los valores serían distintos.
 */
function smaTrueRange(candles: readonly NormalizedCandle[], index: number, period: number): number | null {
  const start = Math.max(1, index - period + 1);
  const trs: number[] = [];
  for (let i = start; i <= index; i++) {
    const prev = candles[i - 1]?.close;
    const c = candles[i];
    if (!c || !finite(prev)) continue;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
}
function olsSlope(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const dx = i - meanX; num += dx * (values[i] - meanY); den += dx * dx; }
  return den ? num / den : null;
}
function alignSnapshot(candleTime: number, snapshots: readonly OpenInterestSnapshot[]): OpenInterestSnapshot | null {
  // Búsqueda binaria: la serie está ordenada ascendente (O(log n) en vez de O(n) por vela).
  let lo = 0;
  let hi = snapshots.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid].time <= candleTime) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? snapshots[best] : null;
}
function quadrant(priceReturn: number | null, deltaOi: number | null, deltaOiZ: number | null, epsilon: number, neutralZ: number): OpenInterestQuadrant | "neutral" | null {
  if (priceReturn == null || deltaOi == null) return null;
  if (Math.abs(priceReturn) < epsilon && Math.abs(deltaOiZ ?? Infinity) < neutralZ) return "neutral";
  if (priceReturn > 0 && deltaOi > 0) return "longs_nuevos";
  if (priceReturn > 0 && deltaOi < 0) return "cobertura_shorts";
  if (priceReturn < 0 && deltaOi > 0) return "shorts_nuevos";
  if (priceReturn < 0 && deltaOi < 0) return "liquidacion_longs";
  return "neutral";
}
function flowSignal(delta: number | null, deltaOi: number | null) {
  if (delta == null || deltaOi == null) return null;
  if (delta > 0 && deltaOi > 0) return "compradores_abren_longs" as const;
  if (delta > 0 && deltaOi < 0) return "squeeze_cobertura" as const;
  if (delta < 0 && deltaOi > 0) return "vendedores_abren_shorts" as const;
  if (delta < 0 && deltaOi < 0) return "capitulacion_longs" as const;
  return null;
}

export function computeOpenInterest(candles: readonly OpenInterestCandleInput[], snapshots: readonly OpenInterestSnapshot[], options: OpenInterestEngineOptions = {}): OpenInterestEngineResult {
  const o = { ...DEFAULTS, ...options };
  const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  // F3.1: validación de entrada — OI_t > 0 y finito. NaN/null/≤0/no-finito se rechaza.
  const sortedSnapshots = [...snapshots].filter(s => finite(s.time) && finite(s.oiContracts) && s.oiContracts > 0).sort((a, b) => a.time - b.time);
  const points: OpenInterestCandlePoint[] = [];
  const oiValues: number[] = [];
  const deltaValues: number[] = [];
  const deltaPctValues: number[] = [];
  const usdHistory: Array<{ time: number; value: number }> = [];
  let lastSource: "poll" | "hist" | null = null;

  for (let i = 0; i < sortedCandles.length; i++) {
    const c = sortedCandles[i];
    const candleCloseTime = c.closeTime ?? c.timestamp;
    const snap = alignSnapshot(candleCloseTime, sortedSnapshots);
    const previous = points.at(-1);
    if (snap) lastSource = snap.source;
    // F3.5: forward-fill — sin snapshot ≤ cierre de la vela se arrastra el último OI
    // válido (stale=true por antigüedad). Sin OI previo no se imputa: gap sin dato.
    const effOi = snap?.oiContracts ?? previous?.oiContracts ?? null;
    const effSnapTime = snap?.time ?? previous?.snapshotTime ?? null;
    const gap = snap == null;
    const oi = effOi;
    const oiUsd = snap
      ? (finite(snap.oiValue) ? snap.oiValue : oi != null && finite(c.close) ? oi * c.close : null)
      : (previous?.oiUsd ?? null);
    const deltaOi = oi != null && previous?.oiContracts != null ? oi - previous.oiContracts : null;
    // F3.3: %ΔOI × 100; 0 si el OI anterior es 0 (el Z robusto es invariante a la escala).
    const deltaOiPct = deltaOi != null && previous?.oiContracts != null
      ? (previous.oiContracts > 0 ? (deltaOi / previous.oiContracts) * 100 : 0)
      : null;
    const deltaWindow = deltaValues.slice(-o.robustWindow + 1);
    const deltaPctWindow = deltaPctValues.slice(-o.robustWindow + 1);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- línea original de Urus, sin uso
    const oiWindow = oiValues.slice(-o.robustWindow + 1);
    const usdCutoff = candleCloseTime - o.percentileWindowDays * 86_400_000;
    const usdWindow = usdHistory.filter(x => x.time >= usdCutoff).map(x => x.value);
    const zDelta = robustZ(deltaOi, deltaWindow);
    const zDeltaPct = robustZ(deltaOiPct, deltaPctWindow);
    const pct = percentileRank(oiUsd, usdWindow);
    const prevClose = sortedCandles[i - 1]?.close;
    const r = finite(prevClose) && prevClose !== 0 ? c.close / prevClose - 1 : null;
    // Edad contra min(cierre de vela, ahora): una vela abierta no puede "envejecer" hacia el futuro.
    const refTime = Math.min(candleCloseTime, o.nowMs ?? Infinity);
    const ageMs = effSnapTime != null ? Math.max(0, refTime - effSnapTime) : null;
    // El histórico de Binance llega cada 5 min por diseño: su umbral es 2×5 min, no 2×periodo de sondeo.
    const staleLimit = lastSource === "hist" ? 2 * 300_000 : o.pollIntervalMs * o.staleMultiplier;
    const stale = ageMs != null && ageMs > staleLimit;
    const smaTrValue = smaTrueRange(sortedCandles, i, o.atrPeriod);
    const volumeZ = robustZ(c.volume, sortedCandles.slice(Math.max(0, i - o.robustWindow + 1), i + 1).map(x => x.volume));
    // M4-menor: la escala es el precio real; el antiguo Math.max(close, 1)
    // distorsionaba el umbral en símbolos de precio < 1 USDT. Sin precio
    // válido no hay señal (NaN propaga a false en las comparaciones).
    const priceScale = finite(c.close) && c.close > 0 ? c.close : NaN;
    const flush = zDeltaPct != null && zDeltaPct <= -o.flushZ && smaTrValue != null && Math.abs(r ?? 0) >= o.flushAtrK * smaTrValue / priceScale && (volumeZ ?? -Infinity) >= 2;
    const silentAccumulation = zDelta != null && zDelta >= o.accumulationZ && smaTrValue != null && Math.abs(r ?? 0) < o.accumulationAtrK * smaTrValue / priceScale;
    const q = quadrant(r, deltaOi, zDelta, o.neutralPriceEpsilon, o.neutralZ);
    const rawSignal = flowSignal(c.delta ?? null, deltaOi);
    const signal = rawSignal && zDelta != null && Math.abs(zDelta) >= o.flowZMin ? rawSignal : null;
    const confidence = signal && zDelta != null ? Math.min(1, Math.abs(zDelta) / o.flowZMax) : null;
    // F3.4: spike guard — |z(ΔOI)| > 5 marca la lectura como anómala en vez de
    // propagar un salto corrupto (el Z robusto ya resiste outliers en la ventana).
    const anomaly = zDelta != null && Math.abs(zDelta) > 5;

    points.push({ candleTime: c.timestamp, close: c.close, oiContracts: oi, oiUsd, snapshotTime: effSnapTime, ageMs, stale, gap, anomaly, deltaOi, deltaOiPct, turnover: oi && oi !== 0 ? c.volume / oi : null, deltaOiZ: zDelta, deltaOiPctZ: zDeltaPct, oiUsdPercentile: pct, quadrant: q, aggressiveDelta: c.delta ?? null, flowSignal: signal, flowConfidence: confidence, flush, silentAccumulation, divergence: null });
    if (oi != null) oiValues.push(oi);
    if (deltaOi != null) deltaValues.push(deltaOi);
    if (deltaOiPct != null) deltaPctValues.push(deltaOiPct);
    if (oiUsd != null) usdHistory.push({ time: candleCloseTime, value: oiUsd });
  }

  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - o.divergenceWindow + 1);
    const window = points.slice(start, i + 1).filter(p => p.oiUsd != null);
    if (window.length < o.divergenceWindow) continue;
    const prices = window.map(p => p.close);
    const oi = window.map(p => p.oiUsd as number);
    const pz = robustNormalize(prices);
    const oz = robustNormalize(oi);
    const ps = olsSlope(pz);
    const os = olsSlope(oz);
    if (ps == null || os == null) continue;
    const maxPrice = Math.max(...prices), minPrice = Math.min(...prices), lastPrice = prices.at(-1)!;
    if (lastPrice === maxPrice && os < -o.divergenceSlopeThreshold) points[i].divergence = "bearish";
    else if (lastPrice === minPrice && os > o.divergenceSlopeThreshold) points[i].divergence = "bullish";
  }

  return { symbol: sortedSnapshots[0]?.symbol ?? "", points, profile: buildProfile(sortedCandles, points, o.profileTopK) };
}
function robustNormalize(values: readonly number[]): number[] {
  const m = median(values) ?? 0;
  const d = mad(values) ?? 0;
  return d === 0 ? values.map(() => 0) : values.map(v => 0.6745 * (v - m) / d);
}
function niceBinSize(range: number): number {
  if (!(range > 0)) return 1;
  const raw = range / 100;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function buildProfile(candles: readonly OpenInterestCandleInput[], points: readonly OpenInterestCandlePoint[], topK: number): OpenInterestProfile | null {
  if (!candles.length || !points.some(p => p.deltaOi != null)) return null;
  const prices = candles.flatMap(c => [c.low, c.high]).filter(finite);
  if (!prices.length) return null;
  const bin = niceBinSize(Math.max(...prices) - Math.min(...prices));
  const buckets = new Map<number, OpenInterestProfileBucket>();
  const longShare = (c: OpenInterestCandleInput) => {
    if (finite(c.buyVolume) && finite(c.volume) && c.volume > 0) return Math.min(1, Math.max(0, c.buyVolume / c.volume));
    if (c.delta != null && finite(c.volume) && c.volume > 0) return Math.min(1, Math.max(0, 0.5 + c.delta / (2 * c.volume)));
    return 0.5;
  };
  const get = (price: number) => {
    const key = Math.round(price / bin) * bin;
    const b = buckets.get(key) ?? { price: key, longOpen: 0, shortOpen: 0, net: 0 };
    buckets.set(key, b); return b;
  };
  let oiStart: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]; const c = candles[i];
    if (p.oiContracts != null && oiStart == null) oiStart = p.oiContracts;
    if (p.deltaOi == null || !c) continue;
    const amount = p.deltaOi;
    if (amount > 0) {
      const b = get((c.high + c.low + c.close) / 3);
      const share = longShare(c);
      b.longOpen += amount * share;
      b.shortOpen += amount * (1 - share);
    } else if (amount < 0) {
      // x_b = |ΔOI|·w_b / Σw con el objetivo FIJO antes del reparto (no se muta durante el bucle).
      const target = Math.abs(amount);
      const current = [...buckets.values()].filter(b => b.longOpen + b.shortOpen > 0);
      const total = current.reduce((s, b) => s + b.longOpen + b.shortOpen, 0);
      if (total > 0) for (const b of current) {
        const w = b.longOpen + b.shortOpen;
        const close = Math.min(w, target * w / total);
        const longClose = close * (b.longOpen / Math.max(1e-12, w));
        b.longOpen -= longClose; b.shortOpen -= close - longClose;
      }
    }
  }
  for (const b of buckets.values()) b.net = b.longOpen - b.shortOpen;
  const arr = [...buckets.values()].filter(b => b.longOpen > 0 || b.shortOpen > 0).sort((a, b) => a.price - b.price);
  if (!arr.length) return { buckets: [], longsTrapped: 0, shortsTrapped: 0, topClusters: [], inferred: true };
  const currentPrice = candles.at(-1)?.close ?? 0;
  const longsTrapped = arr.filter(b => b.price > currentPrice).reduce((s, b) => s + b.longOpen, 0);
  const shortsTrapped = arr.filter(b => b.price < currentPrice).reduce((s, b) => s + b.shortOpen, 0);
  const topClusters = [...arr].sort((a, b) => (b.longOpen + b.shortOpen) - (a.longOpen + a.shortOpen)).slice(0, topK);
  return { buckets: arr, longsTrapped, shortsTrapped, topClusters, inferred: true };
}
