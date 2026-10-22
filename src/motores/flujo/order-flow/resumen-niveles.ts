// Utilidades compartidas por los motores de absorción y agotamiento: filas del footprint por paso de precio y el
// resumen estadístico de cada vela (calculado una sola vez por vela).
import type { FootprintLevel } from "./footprint";

export type LevelInput = Pick<FootprintLevel, "price" | "bidQty" | "askQty">;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const toIndex = (price: number, step: number) => Math.round(price / step);

export interface Row {
  idx: number;
  price: number;
  bid: number;
  ask: number;
}

export function buildRows(levels: readonly LevelInput[], step: number): Row[] {
  const byIdx = new Map<number, Row>();
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !(level.bidQty >= 0) || !(level.askQty >= 0)) continue;
    const idx = toIndex(level.price, step);
    const row = byIdx.get(idx);
    if (row) {
      row.bid += level.bidQty;
      row.ask += level.askQty;
    } else {
      byIdx.set(idx, { idx, price: level.price, bid: level.bidQty, ask: level.askQty });
    }
  }
  return [...byIdx.values()].sort((a, b) => a.idx - b.idx);
}

export interface CandleSummary {
  step: number;
  askN: number; askSum: number; askSumSq: number;
  bidN: number; bidSum: number; bidSumSq: number;
  /** Filas más baja y más alta operadas (minIdx = maxIdx con una sola fila). */
  minIdx: number;
  maxIdx: number;
  empty: boolean;
}

// Cada vela se resume una sola vez (clave: su array de niveles) => la base histórica cuesta O(velas), no O(niveles).
const summaryCache = new WeakMap<object, CandleSummary>();

export function summaryOf(candle: { levels: readonly LevelInput[] }, step: number): CandleSummary {
  const cached = summaryCache.get(candle.levels);
  if (cached && cached.step === step) return cached;
  const rows = buildRows(candle.levels, step);
  const s: CandleSummary = {
    step, askN: 0, askSum: 0, askSumSq: 0, bidN: 0, bidSum: 0, bidSumSq: 0,
    minIdx: rows.length > 0 ? rows[0].idx : 0,
    maxIdx: rows.length > 0 ? rows[rows.length - 1].idx : 0,
    empty: rows.length === 0,
  };
  for (const r of rows) {
    if (r.ask > 0) { s.askN += 1; s.askSum += r.ask; s.askSumSq += r.ask * r.ask; }
    if (r.bid > 0) { s.bidN += 1; s.bidSum += r.bid; s.bidSumSq += r.bid * r.bid; }
  }
  summaryCache.set(candle.levels, s);
  return s;
}
