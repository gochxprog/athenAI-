// El Juez: decide si una estrategia sirve, con pruebas que castigan la suerte y el sobreajuste.
//
//   1. Walk-Forward purgado con embargo: el 30 % inicial solo sirve para elegir parámetros; el 70 % restante se
//      reparte en 5 tramos. En cada tramo se eligen los parámetros con lo ANTERIOR (dejando 20 barras de
//      embargo) y se prueba en el tramo, que nunca se vio. Todas las métricas finales son de esos tramos.
//   2. Monte Carlo: remuestrea las operaciones fuera de muestra 2.000 veces → peor escenario razonable.
//   3. Luck test: 1.000 versiones de la misma estrategia desplazada al azar en el tiempo (misma exposición,
//      mismas operaciones). Si el azar consigue lo mismo a menudo, no hay ventaja.
//   4. Robustez: costos ×2, parámetros vecinos, estabilidad entre tramos y otro mercado.
//   5. Deflated Sharpe (López de Prado): descuenta haber probado muchas variantes.
//   6. PBO (CSCV): probabilidad de que la mejor variante dentro de muestra sea peor que la mediana fuera.
import { crearAleatorio } from '@/lib/random';
import { normalInversa } from '@/lib/backtest';
import { backtest, COSTOS_POR_DEFECTO, maxDrawdown, metricas, sharpeBarras, type Costos, type Metricas, type Operacion } from './backtest';

export type Combo = Record<string, number | string | boolean>;

export interface EntradaJuez {
  cierres: number[];
  tiempos: number[];
  /** Barras marcadas como hueco (corte de datos): no se mantiene posición a través de ellas. */
  huecos?: boolean[];
  combos: Combo[];
  /** Posición por barra para cada combo (−1, 0, 1), sobre toda la serie. */
  posiciones: number[][];
  costos?: Costos;
  /** Variantes probadas en total (todas las ejecuciones de esta idea): alimenta el Deflated Sharpe. */
  ensayos?: number;
  /** Misma estrategia (combo elegido) en otro mercado, si se pidió. */
  otroMercado?: { simbolo: string; cierres: number[]; tiempos: number[]; posiciones: number[] } | null;
  /** Resultado de la prueba anti-futuro (la estrategia no usa datos de barras posteriores). */
  antiFuturo?: { ok: boolean; detalle: string } | null;
  semilla?: number;
}

export interface TramoWF {
  desde: number;
  hasta: number;
  combo: number;
  retorno: number;
  sharpe: number | null;
  operaciones: number;
}

export interface Regla {
  nombre: string;
  ok: boolean | null;
  valor: string;
  umbral: string;
  explicacion: string;
}

export interface ResultadoJuez {
  veredicto: 'APROBADA' | 'RECHAZADA' | 'DATOS INSUFICIENTES';
  resumen: string;
  reglas: Regla[];
  /** Métricas fuera de muestra (las que cuentan). */
  oos: Metricas;
  /** Mejor variante con toda la muestra (optimista: solo como referencia). */
  dentroMuestra: Metricas & { combo: number };
  tramos: TramoWF[];
  /** Capital fuera de muestra, por barra (empieza en 1 al inicio del primer tramo). */
  equityOos: number[];
  /** Índice de la barra donde empieza la parte fuera de muestra. */
  inicioOos: number;
  monteCarlo: { p5: number; p50: number; p95: number; ddP95: number; probDd25: number; muestras: number[] } | null;
  suerte: { p: number; real: number; simulaciones: number[] } | null;
  robustez: { costosDobles: number; vecinosPositivos: number | null; tramosPositivos: number; otroMercado: (Metricas & { simbolo: string }) | null };
  deflatedSharpe: number | null;
  pbo: number | null;
  ensayos: number;
}

const TRAMOS = 5;
const EMBARGO = 20;
const FRACCION_INICIAL = 0.3;
export const MIN_BARRAS_OOS = 500;
export const MIN_OPERACIONES = 30;

/** Φ(x): función de distribución normal estándar. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Quita la posición en la barra anterior a un hueco: no se gana ni se pierde a través de un corte de datos. */
function sinHuecos(pos: readonly number[], huecos?: readonly boolean[]): number[] {
  if (!huecos) return [...pos];
  return pos.map((p, i) => (huecos[i + 1] ? 0 : p));
}

/**
 * Deflated Sharpe Ratio (Bailey y López de Prado, 2014).
 * sr: Sharpe por barra; t: barras; n: variantes probadas; varSr: varianza del Sharpe entre variantes.
 */
export function deflatedSharpe(sr: number, t: number, asimetria: number, curtosis: number, n: number, varSr: number): number {
  const g = 0.5772156649;
  const sr0 = n > 1 ? Math.sqrt(Math.max(varSr, 0)) * ((1 - g) * normalInversa(1 - 1 / n) + g * normalInversa(1 - 1 / (n * Math.E))) : 0;
  const den = Math.sqrt(Math.max(1e-12, 1 - asimetria * sr + ((curtosis - 1) / 4) * sr * sr));
  return normalCdf(((sr - sr0) * Math.sqrt(Math.max(1, t - 1))) / den);
}

function momentos(x: readonly number[]): { asimetria: number; curtosis: number } {
  const n = x.length;
  const m = x.reduce((a, v) => a + v, 0) / n;
  const s2 = x.reduce((a, v) => a + (v - m) ** 2, 0) / n;
  if (s2 <= 0) return { asimetria: 0, curtosis: 3 };
  const s = Math.sqrt(s2);
  return { asimetria: x.reduce((a, v) => a + ((v - m) / s) ** 3, 0) / n, curtosis: x.reduce((a, v) => a + ((v - m) / s) ** 4, 0) / n };
}

/** PBO por CSCV con 8 bloques (70 combinaciones mitad/mitad). Necesita al menos 2 variantes. */
export function pboCscv(retornos: readonly (readonly number[])[], bloques = 8): number | null {
  const k = retornos.length;
  if (k < 2) return null;
  const n = retornos[0].length;
  const tam = Math.floor(n / bloques);
  if (tam < 20) return null;
  const sr = (r: readonly number[], idx: number[]) => {
    const xs: number[] = [];
    for (const b of idx) for (let i = b * tam; i < (b + 1) * tam; i += 1) xs.push(r[i]);
    return sharpeBarras(xs) ?? -Infinity;
  };
  const combos: number[][] = [];
  const rec = (desde: number, act: number[]) => {
    if (act.length === bloques / 2) {
      combos.push([...act]);
      return;
    }
    for (let i = desde; i < bloques; i += 1) rec(i + 1, [...act, i]);
  };
  rec(0, []);
  let malos = 0;
  for (const dentro of combos) {
    const fuera = [...Array(bloques).keys()].filter((b) => !dentro.includes(b));
    const srIn = retornos.map((r) => sr(r, dentro));
    const mejor = srIn.indexOf(Math.max(...srIn));
    const srOut = retornos.map((r) => sr(r, fuera));
    const rango = srOut.filter((v) => v < srOut[mejor]).length + 1;
    const w = rango / (k + 1);
    if (Math.log(w / (1 - w)) <= 0) malos += 1;
  }
  return malos / combos.length;
}

const pctTxt = (v: number) => `${(v * 100).toFixed(1)} %`;

export function juzgar(e: EntradaJuez): ResultadoJuez {
  const n = e.cierres.length;
  const costos = e.costos ?? COSTOS_POR_DEFECTO;
  const posiciones = e.posiciones.map((p) => sinHuecos(p, e.huecos));
  const r = crearAleatorio(e.semilla ?? 12_345);

  // Referencia dentro de muestra (optimista): cada variante sobre toda la serie.
  const completos = posiciones.map((p) => backtest(e.cierres, p, costos));
  const metCompletas = completos.map((b) => metricas(b, e.tiempos));
  const srCompletos = completos.map((b) => sharpeBarras(b.retornos) ?? -Infinity);
  const mejor = srCompletos.indexOf(Math.max(...srCompletos));

  // Walk-Forward purgado con embargo.
  const inicioOos = Math.floor(n * FRACCION_INICIAL);
  const largo = Math.floor((n - inicioOos) / TRAMOS);
  const retOos = new Array(n).fill(0);
  const posOos = new Array(n).fill(0);
  const opsOos: Operacion[] = [];
  const tramos: TramoWF[] = [];
  const retDobles = new Array(n).fill(0);
  for (let k = 0; k < TRAMOS && largo > 1; k += 1) {
    const desde = inicioOos + k * largo;
    const hasta = k === TRAMOS - 1 ? n : desde + largo;
    const finIs = Math.max(2, desde - EMBARGO);
    let elegido = 0;
    let mejorSr = -Infinity;
    posiciones.forEach((p, ci) => {
      const b = backtest(e.cierres, p, costos, 0, finIs);
      const s = sharpeBarras(b.retornos.slice(0, finIs)) ?? -Infinity;
      if (s > mejorSr) {
        mejorSr = s;
        elegido = ci;
      }
    });
    const b = backtest(e.cierres, posiciones[elegido], costos, desde, hasta);
    const bDoble = backtest(e.cierres, posiciones[elegido], { comisionPb: costos.comisionPb * 2, deslizamientoPb: costos.deslizamientoPb * 2 }, desde, hasta);
    for (let i = desde; i < hasta; i += 1) {
      retOos[i] = b.retornos[i];
      retDobles[i] = bDoble.retornos[i];
      posOos[i] = i < hasta - 1 ? posiciones[elegido][i] : 0;
    }
    opsOos.push(...b.operaciones);
    const m = metricas(b, e.tiempos, desde, hasta);
    tramos.push({ desde, hasta, combo: elegido, retorno: m.retornoTotal, sharpe: m.sharpe, operaciones: m.operaciones });
  }
  const resOos = { retornos: retOos, equity: [], operaciones: opsOos };
  const oos = metricas(resOos, e.tiempos, inicioOos, n);
  let eq = 1;
  const equityOos = retOos.slice(inicioOos).map((x) => (eq *= 1 + x));
  const costosDobles = retDobles.slice(inicioOos).reduce((a, x) => a * (1 + x), 1) - 1;
  const tramosPositivos = tramos.length ? tramos.filter((t) => t.retorno > 0).length / tramos.length : 0;

  // Monte Carlo de las operaciones fuera de muestra.
  let monteCarlo: ResultadoJuez['monteCarlo'] = null;
  if (opsOos.length >= 5) {
    const finales: number[] = [];
    const dds: number[] = [];
    for (let s = 0; s < 2_000; s += 1) {
      let cap = 1;
      const curva = [1];
      for (let i = 0; i < opsOos.length; i += 1) {
        cap *= 1 + opsOos[Math.floor(r() * opsOos.length)].retorno;
        curva.push(cap);
      }
      finales.push(cap - 1);
      dds.push(maxDrawdown(curva));
    }
    const ord = [...finales].sort((a, b) => a - b);
    const ordDd = [...dds].sort((a, b) => a - b);
    monteCarlo = {
      p5: ord[Math.floor(ord.length * 0.05)],
      p50: ord[Math.floor(ord.length * 0.5)],
      p95: ord[Math.floor(ord.length * 0.95)],
      ddP95: ordDd[Math.floor(ordDd.length * 0.95)],
      probDd25: dds.filter((d) => d > 0.25).length / dds.length,
      muestras: ord.filter((_, i) => i % 10 === 0),
    };
  }

  // Luck test: la misma secuencia de posiciones fuera de muestra desplazada al azar (circular).
  let suerte: ResultadoJuez['suerte'] = null;
  const largoOos = n - inicioOos;
  if (opsOos.length >= 5 && largoOos > 50) {
    const pos = posOos.slice(inicioOos);
    const rb = new Array(largoOos).fill(0);
    for (let i = 0; i + 1 < largoOos; i += 1) rb[i] = e.cierres[inicioOos + i] > 0 ? e.cierres[inicioOos + i + 1] / e.cierres[inicioOos + i] - 1 : 0;
    const coste = (costos.comisionPb + costos.deslizamientoPb) / 10_000;
    const total = (despl: number) => {
      let cap = 1;
      let previa = 0;
      for (let i = 0; i < largoOos; i += 1) {
        const p = pos[(i + despl) % largoOos];
        cap *= 1 + p * rb[i] - Math.abs(p - previa) * coste;
        previa = p;
      }
      return cap - 1;
    };
    const real = total(0);
    const sims: number[] = [];
    for (let s = 0; s < 1_000; s += 1) sims.push(total(1 + Math.floor(r() * (largoOos - 1))));
    sims.sort((a, b) => a - b);
    suerte = { p: (sims.filter((x) => x >= real).length + 1) / (sims.length + 1), real, simulaciones: sims.filter((_, i) => i % 5 === 0) };
  }

  // Parámetros vecinos: variantes que difieren en un solo parámetro de la mejor.
  let vecinosPositivos: number | null = null;
  if (e.combos.length > 1) {
    const base = e.combos[mejor];
    const vecinos = e.combos.map((c, i) => ({ c, i })).filter(({ c, i }) => i !== mejor && Object.keys(base).filter((k) => c[k] !== base[k]).length === 1);
    if (vecinos.length) vecinosPositivos = vecinos.filter(({ i }) => metCompletas[i].retornoTotal > 0).length / vecinos.length;
  }

  let otroMercado: ResultadoJuez['robustez']['otroMercado'] = null;
  if (e.otroMercado) {
    const o = e.otroMercado;
    otroMercado = { simbolo: o.simbolo, ...metricas(backtest(o.cierres, o.posiciones, costos), o.tiempos) };
  }

  // Deflated Sharpe sobre los retornos fuera de muestra.
  const ensayos = Math.max(e.ensayos ?? 1, e.combos.length);
  const retO = retOos.slice(inicioOos);
  const srO = sharpeBarras(retO);
  let dsr: number | null = null;
  if (srO !== null) {
    const { asimetria, curtosis } = momentos(retO);
    const validos = srCompletos.filter((x) => Number.isFinite(x));
    const media = validos.reduce((a, v) => a + v, 0) / Math.max(1, validos.length);
    const varSr = validos.length > 1 ? validos.reduce((a, v) => a + (v - media) ** 2, 0) / (validos.length - 1) : 1 / Math.max(1, retO.length);
    dsr = deflatedSharpe(srO, retO.length, asimetria, curtosis, ensayos, varSr);
  }
  const pbo = pboCscv(completos.map((b) => b.retornos));

  // Reglas del Juez (fijas: los modelos no pueden cambiarlas).
  const reglas: Regla[] = [
    { nombre: 'Datos suficientes', ok: largoOos >= MIN_BARRAS_OOS && opsOos.length >= MIN_OPERACIONES, valor: `${largoOos} barras · ${opsOos.length} operaciones fuera de muestra`, umbral: `≥ ${MIN_BARRAS_OOS} barras y ≥ ${MIN_OPERACIONES} operaciones`, explicacion: 'Con pocas operaciones cualquier resultado puede ser casualidad.' },
    { nombre: 'No mira al futuro', ok: e.antiFuturo ? e.antiFuturo.ok : null, valor: e.antiFuturo?.detalle ?? 'no comprobado', umbral: 'posiciones idénticas con y sin datos posteriores', explicacion: 'Si la posición de hoy cambia al añadir datos de mañana, la estrategia hace trampa.' },
    { nombre: 'Gana fuera de muestra (Walk-Forward)', ok: oos.retornoTotal > 0, valor: pctTxt(oos.retornoTotal), umbral: '> 0 %', explicacion: 'Solo cuentan los tramos que la estrategia no vio al elegir sus parámetros.' },
    { nombre: 'Estable entre tramos', ok: tramosPositivos >= 0.6, valor: `${Math.round(tramosPositivos * tramos.length)}/${tramos.length} tramos positivos`, umbral: '≥ 60 %', explicacion: 'Una ventaja real no depende de un solo periodo.' },
    { nombre: 'Luck test', ok: suerte ? suerte.p <= 0.05 : null, valor: suerte ? `p = ${suerte.p.toFixed(3)}` : '—', umbral: 'p ≤ 0,05', explicacion: 'El azar con la misma exposición no debe igualarla más de 1 de cada 20 veces.' },
    { nombre: 'Drawdown máximo', ok: oos.maxDrawdown <= 0.2, valor: pctTxt(oos.maxDrawdown), umbral: '≤ 20 %', explicacion: 'Peor caída desde un máximo, fuera de muestra.' },
    { nombre: 'Monte Carlo: riesgo de ruina', ok: monteCarlo ? monteCarlo.probDd25 <= 0.1 : null, valor: monteCarlo ? `${pctTxt(monteCarlo.probDd25)} de caídas > 25 %` : '—', umbral: '≤ 10 %', explicacion: 'Barajando las operaciones, la mala suerte no debe quemar la cuenta.' },
    { nombre: 'Aguanta costos ×2', ok: costosDobles > 0, valor: pctTxt(costosDobles), umbral: '> 0 %', explicacion: 'Con el doble de comisión y deslizamiento debe seguir ganando.' },
    { nombre: 'Deflated Sharpe', ok: dsr === null ? null : dsr >= 0.95, valor: dsr === null ? '—' : dsr.toFixed(3), umbral: '≥ 0,95', explicacion: `Descuenta haber probado ${ensayos} ${ensayos === 1 ? 'variante' : 'variantes'}.` },
    { nombre: 'PBO (sobreajuste)', ok: pbo === null ? null : pbo <= 0.25, valor: pbo === null ? 'una sola variante' : pctTxt(pbo), umbral: '≤ 25 %', explicacion: 'Probabilidad de que la mejor variante dentro de muestra sea mediocre fuera.' },
    { nombre: 'Parámetros vecinos', ok: vecinosPositivos === null ? null : vecinosPositivos >= 0.6, valor: vecinosPositivos === null ? '—' : pctTxt(vecinosPositivos), umbral: '≥ 60 % ganan', explicacion: 'Si cambiar un poco un parámetro la rompe, es sobreajuste.' },
    { nombre: 'Otro mercado', ok: otroMercado ? otroMercado.retornoTotal > 0 : null, valor: otroMercado ? `${otroMercado.simbolo}: ${pctTxt(otroMercado.retornoTotal)}` : 'no probado', umbral: '> 0 %', explicacion: 'Un patrón que también funciona en otro mercado (BTC y XAU) es más fiable.' },
  ];
  const insuficiente = reglas[0].ok === false;
  const falladas = reglas.filter((x) => x.ok === false);
  const veredicto = insuficiente ? 'DATOS INSUFICIENTES' : falladas.length ? 'RECHAZADA' : 'APROBADA';
  const resumen =
    veredicto === 'APROBADA'
      ? `Pasa todas las reglas aplicables. Fuera de muestra: ${pctTxt(oos.retornoTotal)} con ${oos.operaciones} operaciones.`
      : veredicto === 'DATOS INSUFICIENTES'
        ? `Hacen falta más datos: ${reglas[0].valor}. Deja grabando el mercado y vuelve a probar.`
        : `No pasa: ${falladas.map((x) => x.nombre.toLowerCase()).join(', ')}.`;

  return {
    veredicto,
    resumen,
    reglas,
    oos,
    dentroMuestra: { ...metCompletas[mejor], combo: mejor },
    tramos,
    equityOos,
    inicioOos,
    monteCarlo,
    suerte,
    robustez: { costosDobles, vecinosPositivos, tramosPositivos, otroMercado },
    deflatedSharpe: dsr,
    pbo,
    ensayos,
  };
}
