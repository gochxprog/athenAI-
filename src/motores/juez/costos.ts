// Costos de operar: el ÚNICO sitio donde se calculan (Backtest, Luck test y, más adelante, Paper los usan).
//
//   Costo por lado c = (comisión + deslizamiento) / 10.000          (fracción del nocional)
//   Funding (perpetuos): cada 8 h (00:00, 08:00 y 16:00 UTC) quien está abierto paga o cobra la tasa vigente:
//     factor = (1 − posición × tasa)^cobros     → con tasa > 0 los largos pagan y los cortos cobran.
//   La tasa que se usa es la conocida al cierre de la barra anterior (nunca un dato del futuro).

export interface Costos {
  /** Comisión por lado (pb). Binance Futures, taker estándar = 5 pb (0,05 %). */
  comisionPb: number;
  /** Deslizamiento estimado por lado (pb). */
  deslizamientoPb: number;
}

/** Automáticos para Binance USD-M: comisión taker estándar + 1 pb de deslizamiento. */
export const COSTOS_POR_DEFECTO: Costos = { comisionPb: 5, deslizamientoPb: 1 };

export const INTERVALO_FUNDING_MS = 8 * 3_600_000;

export function costoPorLado(c: Costos): number {
  return (c.comisionPb + c.deslizamientoPb) / 10_000;
}

/** Cobros de funding (00:00, 08:00, 16:00 UTC) que caen en el intervalo (t0, t1]. */
export function cobrosFunding(t0: number, t1: number): number {
  if (!(t1 > t0)) return 0;
  return Math.floor(t1 / INTERVALO_FUNDING_MS) - Math.floor(t0 / INTERVALO_FUNDING_MS);
}

export function factorFunding(posicion: number, tasa: number, cobros: number): number {
  return cobros > 0 && posicion !== 0 ? (1 - posicion * tasa) ** cobros : 1;
}

// Deslizamiento dinámico para la ejecución en vivo (Paper), fracción del precio:
//   desliz = base + 0,1 · (ATR / precio) + (orden / liquidez de 10 niveles de ese lado) · (distancia del 10.º nivel)
//   base: el deslizamiento fijo de los costos · volatilidad: 10 % del rango típico de una barra ·
//   impacto: si la orden se come una fracción de los 10 primeros niveles, recorre esa fracción del libro.
//   Se limita a 50 pb (una orden que se coma todo el libro no se simula: el Guardián limita el tamaño).
export const DESLIZ_MAXIMO = 0.005;

export function deslizamientoDinamico(c: Costos, e: { precio: number; atr: number | null; nocionalOrden: number; liquidezLado: number | null; distanciaLado: number | null }): number {
  const base = c.deslizamientoPb / 10_000;
  const vol = e.atr && e.precio > 0 ? 0.1 * (e.atr / e.precio) : 0;
  const impacto = e.liquidezLado && e.liquidezLado > 0 && e.distanciaLado !== null ? Math.min(1, e.nocionalOrden / e.liquidezLado) * e.distanciaLado : 0;
  return Math.min(DESLIZ_MAXIMO, base + vol + impacto);
}

/** Comisión en USD de una orden a mercado (taker). */
export function comisionUsd(c: Costos, nocional: number): number {
  return Math.abs(nocional) * (c.comisionPb / 10_000);
}
