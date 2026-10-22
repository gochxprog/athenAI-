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
//   8. Funding (perpetuos): si la posición sigue abierta al pasar una hora de cobro (cada 8 h), la barra se
//      multiplica por (1 − p · tasa). Fórmulas en costos.ts.

import { cobrosFunding, costoPorLado, COSTOS_POR_DEFECTO, factorFunding, type Costos } from './costos';
import { backtestConSalidas, type ReglasSalida, type Vela } from './salidas';

export { COSTOS_POR_DEFECTO, type Costos };

/** Datos opcionales del tramo: huecos de datos y funding (perpetuos). */
export interface OpcionesBacktest {
  huecos?: readonly boolean[];
  /** Hora de cierre de cada barra y tasa de funding conocida en ese cierre (null = sin dato). */
  funding?: { tiempos: readonly number[]; tasas: readonly (number | null)[] };
  /**
   * Stop, objetivo y gestión que declara la estrategia (GESTION): el Backtest usa entonces el motor de salidas
   * (salidas.ts, el mismo de la Terminal) con el máximo y el mínimo de cada vela. Sin funding en ese modo.
   */
  salidas?: { reglas: ReglasSalida; velas: readonly Vela[] };
}

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

export function backtest(cierres: readonly number[], posiciones: readonly number[], costos: Costos = COSTOS_POR_DEFECTO, desde = 0, hasta = cierres.length, opciones: OpcionesBacktest = {}): ResultadoBacktest {
  const { huecos, funding, salidas } = opciones;
  if (salidas) {
    // Series de precios que no son las velas (el Luck test permuta los cierres): velas planas de esos cierres.
    const propias = salidas.velas.length === cierres.length && salidas.velas.every((v, i) => v.close === cierres[i]);
    const velas = propias ? salidas.velas : cierres.map((c) => ({ high: c, low: c, close: c }));
    return backtestConSalidas(velas, posiciones, salidas.reglas, costos, desde, hasta, huecos);
  }
  const n = cierres.length;
  const c = costoPorLado(costos);
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
      // (8) Funding cobrado mientras la posición estuvo abierta (tasa conocida al cierre de i−1).
      const tasa = funding?.tasas[i - 1];
      const ff = funding && tasa !== null && tasa !== undefined ? factorFunding(previa, tasa, cobrosFunding(funding.tiempos[i - 1], funding.tiempos[i])) : 1;
      factor *= (1 + rp) * ff;
      abierta.factor *= (1 + rp) * ff;
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

// Motor 2 · Métricas. Todas se calculan sobre los retornos netos por barra (r_i) y las operaciones del Backtest.
//
//   Barras por año  B = 365,25 días / mediana(intervalo entre cierres)   (los días sin grabar no la cambian)
//   Años            A = barras / B
//   Retorno total   = Π(1 + r_i) − 1          CAGR = (1 + total)^(1/A) − 1   (solo con A ≥ 3 meses: llevar
//                   unos pocos días a un año da cifras sin sentido)
//   Sharpe          = media(r) / desv(r) · √B   (desviación muestral, n − 1)
//   Sortino         = media(r) / √(media(min(r, 0)²)) · √B   (solo castiga las caídas)
//   Drawdown máx.   = máx(1 − E_i / máx_{k≤i} E_k)            Calmar = CAGR / drawdown máx.
//   Aciertos        = operaciones ganadoras / operaciones
//   Factor benef.   = Σ ganancias / Σ |pérdidas|   (∞ si no hay pérdidas)
//   Esperanza       = retorno medio por operación; ganancia media y pérdida media por separado
//   Racha perdedora = máximo de operaciones perdedoras seguidas
//   Duración del peor drawdown = barras (y horas) seguidas por debajo del máximo anterior
//   Exposición      = barras con posición / barras

export interface Metricas {
  retornoTotal: number;
  /** Sharpe anualizado con el número real de barras por año del activo. */
  sharpe: number | null;
  sortino: number | null;
  cagr: number | null;
  calmar: number | null;
  maxDrawdown: number;
  /** Barras y horas seguidas por debajo del máximo (el drawdown más largo). */
  duracionDrawdown: { barras: number; horas: number };
  aciertos: number | null;
  factorBeneficio: number | null;
  operaciones: number;
  /** Esperanza: retorno medio por operación. */
  retornoMedioOperacion: number | null;
  gananciaMedia: number | null;
  perdidaMedia: number | null;
  rachaPerdedora: number;
  /** Fracción de barras con posición abierta. */
  exposicion: number;
  barras: number;
}

/** Datos mínimos para anualizar el retorno (CAGR y Calmar): 3 meses. */
export const MIN_ANIOS_CAGR = 0.25;

/** Barras por año según el ritmo típico (mediana) de las barras: no le afectan los días sin grabar. */
export function barrasPorAnio(tiempos: readonly number[]): number {
  if (tiempos.length < 2) return 0;
  const d: number[] = [];
  for (let i = 1; i < tiempos.length; i += 1) if (tiempos[i] > tiempos[i - 1]) d.push(tiempos[i] - tiempos[i - 1]);
  if (!d.length) return 0;
  d.sort((a, b) => a - b);
  const m = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  return (365.25 * 86_400_000) / m;
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

/** Tramo más largo por debajo del máximo anterior: [inicio, fin] en índices de `equity`. */
function drawdownMasLargo(equity: readonly number[]): { desde: number; hasta: number } {
  let pico = -Infinity;
  let inicio = 0;
  let mejor = { desde: 0, hasta: 0 };
  for (let i = 0; i < equity.length; i += 1) {
    if (equity[i] >= pico) {
      pico = equity[i];
      inicio = i;
    } else if (i - inicio > mejor.hasta - mejor.desde) mejor = { desde: inicio, hasta: i };
  }
  return mejor;
}

export function sharpeBarras(retornos: readonly number[]): number | null {
  const n = retornos.length;
  if (n < 10) return null;
  const media = retornos.reduce((a, v) => a + v, 0) / n;
  const varianza = retornos.reduce((a, v) => a + (v - media) ** 2, 0) / (n - 1);
  return varianza > 0 ? media / Math.sqrt(varianza) : null;
}

export function sortinoBarras(retornos: readonly number[]): number | null {
  const n = retornos.length;
  if (n < 10) return null;
  const media = retornos.reduce((a, v) => a + v, 0) / n;
  const caida = Math.sqrt(retornos.reduce((a, v) => a + Math.min(v, 0) ** 2, 0) / n);
  return caida > 0 ? media / caida : null;
}

export function metricas(res: ResultadoBacktest, tiempos: readonly number[], desde = 0, hasta = res.retornos.length): Metricas {
  const rets = res.retornos.slice(desde, hasta);
  const ops = res.operaciones.filter((o) => o.entrada >= desde && o.salida < hasta);
  let e = 1;
  const eq = [1, ...rets.map((r) => (e *= 1 + r))];
  const total = e - 1;
  const t = tiempos.slice(desde, hasta);
  const anual = barrasPorAnio(t);
  const sr = sharpeBarras(rets);
  const so = sortinoBarras(rets);
  const anios = anual > 0 ? rets.length / anual : 0;
  const cagr = anios >= MIN_ANIOS_CAGR && total > -1 ? (1 + total) ** (1 / anios) - 1 : null;
  const dd = maxDrawdown(eq);
  const largo = drawdownMasLargo(eq);
  // eq tiene un punto inicial extra: el índice k de eq corresponde a la barra desde + k − 1.
  const horasDd = largo.hasta > largo.desde ? ((t[Math.min(t.length - 1, largo.hasta - 1)] ?? 0) - (t[Math.max(0, largo.desde - 1)] ?? 0)) / 3_600_000 : 0;
  const ganadas = ops.filter((o) => o.retorno > 0);
  const perdidas = ops.filter((o) => o.retorno <= 0);
  const sumaG = ganadas.reduce((a, o) => a + o.retorno, 0);
  const sumaP = -perdidas.reduce((a, o) => a + o.retorno, 0);
  let racha = 0;
  let rachaMax = 0;
  for (const o of ops) {
    racha = o.retorno <= 0 ? racha + 1 : 0;
    rachaMax = Math.max(rachaMax, racha);
  }
  const expuestas = ops.reduce((a, o) => a + o.barras, 0);
  return {
    retornoTotal: total,
    sharpe: sr === null ? null : sr * Math.sqrt(anual),
    sortino: so === null ? null : so * Math.sqrt(anual),
    cagr,
    calmar: cagr !== null && dd > 0 ? cagr / dd : null,
    maxDrawdown: dd,
    duracionDrawdown: { barras: largo.hasta - largo.desde, horas: horasDd },
    aciertos: ops.length ? ganadas.length / ops.length : null,
    // Sin operaciones perdedoras el factor es infinito (se muestra «∞»).
    factorBeneficio: sumaP > 0 ? sumaG / sumaP : ops.length ? Infinity : null,
    operaciones: ops.length,
    retornoMedioOperacion: ops.length ? ops.reduce((a, o) => a + o.retorno, 0) / ops.length : null,
    gananciaMedia: ganadas.length ? sumaG / ganadas.length : null,
    perdidaMedia: perdidas.length ? -sumaP / perdidas.length : null,
    rachaPerdedora: rachaMax,
    exposicion: rets.length ? expuestas / rets.length : 0,
    barras: rets.length,
  };
}
