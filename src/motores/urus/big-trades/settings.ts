import { clampFiniteNumber, coerceBoolean, defaultBigTradeConfig } from "./engine";

/** Topes estrictos del radio de las burbujas (px). Ninguna orden puede salirse de este rango. */
export const BIG_TRADE_MIN_RADIUS_PX = 4;
export const BIG_TRADE_MAX_RADIUS_PX = 22;
/** Tope duro de burbujas simultáneas en pantalla (protege los 60 FPS). */
export const BIG_TRADE_MAX_VISIBLE_HARD = 400;

/** Unidad en la que se filtra y se rotulan las burbujas (sólo visual; la detección sigue en USD). */
export type BigTradesUnitMode = "USD" | "BASE";

/** Umbral por defecto en moneda base / contratos (sólo visual). */
const DEFAULT_MIN_BASE_VOLUME: Record<string, number> = {
  BTCUSDT: 3,
  ETHUSDT: 80,
  SOLUSDT: 1_000,
  XAUUSDT: 30,
};
export function defaultMinBaseVolume(symbol: string): number {
  return DEFAULT_MIN_BASE_VOLUME[symbol.toUpperCase()] ?? 1;
}

/** Etiqueta de la moneda base / contrato: BTCUSDT → BTC, XAUUSDT → XAU, NQ → NQ. */
export function baseUnitLabel(symbol: string): string {
  const base = symbol.toUpperCase().replace(/(USDT|USDC|BUSD|USD)$/, "");
  return base.length > 0 ? base : symbol.toUpperCase();
}
/**
 * Ajustes de Big Trades por instancia de gráfico (se guardan con el estado del chart).
 * Los campos de detección (tauMs, windowSize, zCut, minNotionalUsd, use*Filter) se envían
 * al servidor; el resto sólo afecta al dibujo.
 */
export interface BigTradesSettings {
  enabled: boolean;
  // detección / filtrado
  minNotionalUsd: number;
  useUsdFilter: boolean;
  zCut: number;
  useZFilter: boolean;
  tauMs: number;
  windowSize: number;
  // visual
  buyColor: string;
  sellColor: string;
  minRadius: number;
  maxRadius: number;
  opacity: number;
  showLabels: boolean;
  snapToCandle: boolean;
  // filtrado visual (sólo dibujo; no se envía al servidor)
  /** Unidad del filtro mínimo, de las etiquetas y del auto-filtro: USD ($) o moneda base / contratos. */
  unitMode: BigTradesUnitMode;
  /** Umbral mínimo cuando unitMode === "BASE" (mismo interruptor "useUsdFilter" que el de USD). */
  minBaseVolume: number;
  /** Auto-Filter: sólo se dibuja lo que supere media + k·σ del volumen reciente. */
  autoFilter: boolean;
  autoFilterSigma: number;
  /** Máximo de burbujas visibles a la vez (se conservan las de mayor tamaño). */
  maxVisible: number;
  /** Si es false, al desactivar el botón el servidor deja de grabar este símbolo. */
  keepRecording: boolean;
}

export function defaultBigTradesSettings(symbol: string): BigTradesSettings {
  // Campos de detección: única fuente = defaultBigTradeConfig del motor.
  // Antes estos 6 literales estaban duplicados aquí (50, 1000, 2.5, true, true + umbral).
  const detection = defaultBigTradeConfig(symbol);
  return {
    enabled: false,
    minNotionalUsd: detection.minNotionalUsd,
    useUsdFilter: detection.useUsdFilter,
    zCut: detection.zCut,
    useZFilter: detection.useZFilter,
    tauMs: detection.tauMs,
    windowSize: detection.windowSize,
    buyColor: "#64e4b0",
    sellColor: "#ff6f9d",
    minRadius: BIG_TRADE_MIN_RADIUS_PX,
    maxRadius: BIG_TRADE_MAX_RADIUS_PX,
    opacity: 0.42,
    showLabels: true,
    snapToCandle: true,
    unitMode: "USD",
    minBaseVolume: defaultMinBaseVolume(symbol),
    autoFilter: true,
    autoFilterSigma: 1,
    maxVisible: 80,
    keepRecording: true,
  };
}

export function normalizeBigTradesSettings(
  value: Partial<BigTradesSettings> | null | undefined,
  symbol: string
): BigTradesSettings {
  const d = defaultBigTradesSettings(symbol);
  // Sanitizadores: los canónicos de engine.ts (antes había copias idénticas aquí).
  const num = clampFiniteNumber;
  const bool = coerceBoolean;
  const color = (v: unknown, fallback: string) =>
    typeof v === "string" && /^#[\da-f]{6}$/i.test(v) ? v : fallback;
  const minRadius = num(value?.minRadius, d.minRadius, BIG_TRADE_MIN_RADIUS_PX, BIG_TRADE_MAX_RADIUS_PX - 2);
  let useUsdFilter = bool(value?.useUsdFilter, d.useUsdFilter);
  const useZFilter = bool(value?.useZFilter, d.useZFilter);
  if (!useUsdFilter && !useZFilter) useUsdFilter = true;
  return {
    enabled: bool(value?.enabled, d.enabled),
    minNotionalUsd: num(value?.minNotionalUsd, d.minNotionalUsd, 1, 1_000_000_000),
    useUsdFilter,
    zCut: num(value?.zCut, d.zCut, 0.5, 20),
    useZFilter,
    tauMs: num(value?.tauMs, d.tauMs, 1, 5_000),
    windowSize: Math.round(num(value?.windowSize, d.windowSize, 50, 20_000)),
    buyColor: color(value?.buyColor, d.buyColor),
    sellColor: color(value?.sellColor, d.sellColor),
    minRadius,
    maxRadius: Math.min(
      BIG_TRADE_MAX_RADIUS_PX,
      Math.max(minRadius + 2, num(value?.maxRadius, d.maxRadius, BIG_TRADE_MIN_RADIUS_PX, BIG_TRADE_MAX_RADIUS_PX))
    ),
    opacity: num(value?.opacity, d.opacity, 0.05, 1),
    showLabels: bool(value?.showLabels, d.showLabels),
    snapToCandle: bool(value?.snapToCandle, d.snapToCandle),
    unitMode: value?.unitMode === "BASE" || value?.unitMode === "USD" ? value.unitMode : d.unitMode,
    minBaseVolume: num(value?.minBaseVolume, d.minBaseVolume, 0.000001, 1_000_000_000),
    autoFilter: bool(value?.autoFilter, d.autoFilter),
    autoFilterSigma: num(value?.autoFilterSigma, d.autoFilterSigma, 0, 6),
    maxVisible: Math.round(num(value?.maxVisible, d.maxVisible, 10, BIG_TRADE_MAX_VISIBLE_HARD)),
    keepRecording: bool(value?.keepRecording, d.keepRecording),
  };
}
