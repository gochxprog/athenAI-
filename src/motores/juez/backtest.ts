// Backtest de una estrategia sobre las dollar bars guardadas.
//
// Regla anti-futuro: la posición que la estrategia decide al CIERRE de la barra i (con la información de esa
// barra) se mantiene durante la barra i+1. Retorno de la barra i+1 = posición[i] × (close[i+1] / close[i] − 1).
// Costos: comisión + deslizamiento por cada cambio de posición (en puntos básicos del nocional, por lado).

export interface Costos {
  /** Comisión por lado (pb). Binance Futures taker ≈ 4–5 pb. */
  comisionPb: number;
  /** Deslizamiento estimado por lado (pb). */
  deslizamientoPb: number;
}

export const COSTOS_POR_DEFECTO: Costos = { comisionPb: 4, deslizamientoPb: 1 };

export interface Operacion {
  /** Índice de la barra en la que se decidió entrar (la posición rige desde la siguiente). */
  entrada: number;
  /** Índice de la barra en la que se decidió salir. */
  salida: number;
  lado: 1 | -1;
  /** Retorno neto de la operación (con costos), como fracción. */
  retorno: number;
  barras: number;
}

export interface ResultadoBacktest {
  /** Retorno neto por barra (longitud = barras; la 0 siempre es 0). */
  retornos: number[];
  /** Capital acumulado (empieza en 1). */
  equity: number[];
  operaciones: Operacion[];
}

/** Normaliza la salida de la estrategia: solo −1, 0 o 1; cualquier otra cosa cuenta como 0. */
export function normalizarPosiciones(pos: readonly unknown[], n: number): number[] {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n && i < pos.length; i += 1) {
    const v = Number(pos[i]);
    out[i] = v > 0 ? 1 : v < 0 ? -1 : 0;
  }
  return out;
}

export function backtest(cierres: readonly number[], posiciones: readonly number[], costos: Costos = COSTOS_POR_DEFECTO, desde = 0, hasta = cierres.length): ResultadoBacktest {
  const n = cierres.length;
  const coste = (costos.comisionPb + costos.deslizamientoPb) / 10_000;
  const retornos = new Array(n).fill(0);
  const equity = new Array(n).fill(1);
  const operaciones: Operacion[] = [];
  let abierta: { entrada: number; lado: 1 | -1; acumulado: number } | null = null;
  let previa = 0;

  for (let i = desde; i < hasta; i += 1) {
    // Posición decidida al cierre de i (en la última barra del tramo se cierra todo).
    const p = i < hasta - 1 ? posiciones[i] ?? 0 : 0;
    // Coste del cambio de posición, en la barra de la decisión (un giro de 1 a −1 paga dos lados).
    retornos[i] -= Math.abs(p - previa) * coste;
    if (abierta && p !== abierta.lado) {
      abierta.acumulado = (1 + abierta.acumulado) * (1 - coste) - 1;
      operaciones.push({ entrada: abierta.entrada, salida: i, lado: abierta.lado, retorno: abierta.acumulado, barras: i - abierta.entrada });
      abierta = null;
    }
    if (p !== 0 && !abierta) abierta = { entrada: i, lado: p as 1 | -1, acumulado: -coste };
    // La posición decidida en i rige durante la barra i+1.
    if (abierta && i + 1 < hasta && cierres[i] > 0) {
      const rb = p * (cierres[i + 1] / cierres[i] - 1);
      retornos[i + 1] += rb;
      abierta.acumulado = (1 + abierta.acumulado) * (1 + rb) - 1;
    }
    previa = p;
  }
  let e = 1;
  for (let i = 0; i < n; i += 1) {
    e *= 1 + retornos[i];
    equity[i] = e;
  }
  return { retornos, equity, operaciones };
}

export interface Metricas {
  retornoTotal: number;
  /** Sharpe anualizado con el número real de barras por año del activo. */
  sharpe: number | null;
  maxDrawdown: number;
  aciertos: number | null;
  factorBeneficio: number | null;
  operaciones: number;
  retornoMedioOperacion: number | null;
  /** Fracción de barras con posición abierta. */
  exposicion: number;
  barras: number;
}

/** Barras por año según el ritmo real de las dollar bars (se usa para anualizar el Sharpe). */
export function barrasPorAnio(tiempos: readonly number[]): number {
  if (tiempos.length < 2) return 0;
  const dias = Math.max(1 / 24, (tiempos[tiempos.length - 1] - tiempos[0]) / 86_400_000);
  return ((tiempos.length - 1) / dias) * 365;
}

export function maxDrawdown(equity: readonly number[]): number {
  let pico = -Infinity;
  let peor = 0;
  for (const e of equity) {
    if (e > pico) pico = e;
    const dd = e / pico - 1;
    if (dd < peor) peor = dd;
  }
  return -peor;
}

export function sharpeBarras(retornos: readonly number[]): number | null {
  const n = retornos.length;
  if (n < 10) return null;
  const media = retornos.reduce((a, v) => a + v, 0) / n;
  const varianza = retornos.reduce((a, v) => a + (v - media) ** 2, 0) / (n - 1);
  return varianza > 0 ? media / Math.sqrt(varianza) : null;
}

export function metricas(res: ResultadoBacktest, tiempos: readonly number[], desde = 0, hasta = res.retornos.length): Metricas {
  const rets = res.retornos.slice(desde, hasta);
  const ops = res.operaciones.filter((o) => o.entrada >= desde && o.salida < hasta);
  let e = 1;
  const eq = rets.map((r) => (e *= 1 + r));
  const sr = sharpeBarras(rets);
  const anual = barrasPorAnio(tiempos.slice(desde, hasta));
  const ganadas = ops.filter((o) => o.retorno > 0);
  const sumaG = ganadas.reduce((a, o) => a + o.retorno, 0);
  const sumaP = -ops.filter((o) => o.retorno <= 0).reduce((a, o) => a + o.retorno, 0);
  const expuestas = ops.reduce((a, o) => a + o.barras, 0);
  return {
    retornoTotal: e - 1,
    sharpe: sr === null ? null : sr * Math.sqrt(anual),
    maxDrawdown: maxDrawdown([1, ...eq]),
    aciertos: ops.length ? ganadas.length / ops.length : null,
    factorBeneficio: sumaP > 0 ? sumaG / sumaP : ops.length ? null : null,
    operaciones: ops.length,
    retornoMedioOperacion: ops.length ? ops.reduce((a, o) => a + o.retorno, 0) / ops.length : null,
    exposicion: rets.length ? expuestas / rets.length : 0,
    barras: rets.length,
  };
}
