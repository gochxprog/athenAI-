// Motor 1 · Backtest: convierte las posiciones de una estrategia en retornos, operaciones y curva de capital.
// Es la base que usan todos los demás motores del Juez (Walk-Forward, Monte Carlo, robustez…).
//
// Notación: C_i = cierre de la barra i, p_i ∈ {−1, 0, 1} = posición decidida al CIERRE de la barra i,
//           c = (comisión + deslizamiento) / 10.000 = costo por lado, como fracción del nocional.
//
//   1. Anti-futuro: la posición decidida en i rige durante la barra i+1:
//        r_precio(i+1) = p_i · (C_{i+1} / C_i − 1)
//   2. Costos: cada cambio de posición paga un lado por unidad de cambio, en la barra de la decisión:
//        factor_costo(i) = (1 − c)^|p_i − p_{i−1}|      (abrir o cerrar = 1 lado; girar de 1 a −1 = 2 lados)
//   3. Retorno neto de la barra:  r_i = (1 + r_precio(i)) · factor_costo(i) − 1
//   4. Capital:  E_i = Π_{k ≤ i} (1 + r_k), empieza en 1.
//   5. Operación = tramo con el mismo lado; su retorno = (1 − c) · Π(1 + r_precio) · (1 − c) − 1.
//      Como todo es multiplicativo, el capital final = Π (1 + retorno de cada operación) exactamente.
//   6. Huecos de datos: si la barra i+1 es un hueco (corte de conexión), p_i = 0: nunca se mantiene una
//      posición a través de un corte.
//   7. Cierre forzado: en la última barra del tramo la posición es 0.
//
// Pendiente: el funding de los perpetuos (cada 8 h) aún no se graba, así que no se descuenta.

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

/** Regla 6 aplicada a una serie completa de posiciones (para los motores que la recorren por su cuenta). */
export function aplicarHuecos(posiciones: readonly number[], huecos?: readonly boolean[]): number[] {
  return huecos ? posiciones.map((p, i) => (huecos[i + 1] ? 0 : p)) : [...posiciones];
}

/** Posición efectiva: 0 antes de un hueco y en la última barra del tramo. */
function posicionEn(posiciones: readonly number[], huecos: readonly boolean[] | undefined, i: number, hasta: number): number {
  if (i >= hasta - 1) return 0;
  if (huecos?.[i + 1]) return 0;
  return posiciones[i] ?? 0;
}

export function backtest(cierres: readonly number[], posiciones: readonly number[], costos: Costos = COSTOS_POR_DEFECTO, desde = 0, hasta = cierres.length, huecos?: readonly boolean[]): ResultadoBacktest {
  const n = cierres.length;
  const c = (costos.comisionPb + costos.deslizamientoPb) / 10_000;
  const retornos = new Array(n).fill(0);
  const equity = new Array(n).fill(1);
  const operaciones: Operacion[] = [];
  let abierta: { entrada: number; lado: 1 | -1; factor: number } | null = null;
  let previa = 0;

  for (let i = desde; i < hasta; i += 1) {
    let factor = 1;
    // (1) Retorno de precio de la posición decidida en i−1.
    if (abierta && i > desde && cierres[i - 1] > 0) {
      const rp = previa * (cierres[i] / cierres[i - 1] - 1);
      factor *= 1 + rp;
      abierta.factor *= 1 + rp;
    }
    // (2) Decisión al cierre de i y su costo.
    const p = posicionEn(posiciones, huecos, i, hasta);
    if (abierta && p !== abierta.lado) {
      abierta.factor *= 1 - c;
      operaciones.push({ entrada: abierta.entrada, salida: i, lado: abierta.lado, retorno: abierta.factor - 1, barras: i - abierta.entrada });
      abierta = null;
    }
    if (p !== 0 && !abierta) abierta = { entrada: i, lado: p as 1 | -1, factor: 1 - c };
    factor *= (1 - c) ** Math.abs(p - previa);
    retornos[i] = factor - 1;
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
    // Sin operaciones perdedoras el factor es infinito (se muestra «∞»).
    factorBeneficio: sumaP > 0 ? sumaG / sumaP : ops.length ? Infinity : null,
    operaciones: ops.length,
    retornoMedioOperacion: ops.length ? ops.reduce((a, o) => a + o.retorno, 0) / ops.length : null,
    exposicion: rets.length ? expuestas / rets.length : 0,
    barras: rets.length,
  };
}
