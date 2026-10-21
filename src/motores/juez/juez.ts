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
import { ALFA_LUCK, luckTest, type ConfigLuck, type ResultadoLuck } from './luckTest';
import { monteCarlo, RUINA_MAXIMA, type ConfigMc, type ResultadoMc } from './monteCarlo';
import { walkForward, type ClaseWfe, type ConfigWfo, type ObjetivoWfo, type VentanaResultado } from './walkForward';
import { aplicarHuecos, backtest, COSTOS_POR_DEFECTO, metricas, sharpeBarras, type Costos, type Metricas, type Operacion } from './backtest';

export type Combo = Record<string, number | string | boolean>;

export interface EntradaJuez {
  cierres: number[];
  tiempos: number[];
  /** Barras marcadas como hueco (corte de datos): no se mantiene posición a través de ellas. */
  huecos?: boolean[];
  /** Tasa de funding conocida al cierre de cada barra (perpetuos). Si falta, no se descuenta. */
  funding?: (number | null)[];
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
  /** Ventanas y objetivo del Walk-Forward (por defecto: automáticos y Sharpe). */
  wfo?: ConfigWfo;
  /** Método, métrica y permutaciones del Luck test. */
  luck?: ConfigLuck;
  /** Simulaciones, método, umbral de ruina y capital del Monte Carlo. */
  monteCarlo?: ConfigMc;
}

/** Una ventana del Walk-Forward; `desde`/`hasta` = su tramo OOS. */
export interface TramoWF extends VentanaResultado {
  desde: number;
  hasta: number;
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
  /** Walk-Forward: objetivo, tamaños de ventana y eficiencia (WFE). */
  wfo: { objetivo: ObjetivoWfo; lIs: number; lOos: number; embargo: number; wfe: number | null; clase: ClaseWfe | null };
  /** Capital fuera de muestra, por barra (empieza en 1 al inicio del primer tramo). */
  equityOos: number[];
  /** Operaciones fuera de muestra (índices de barra de la serie completa). */
  operacionesOos: Operacion[];
  /** Índice de la barra donde empieza la parte fuera de muestra. */
  inicioOos: number;
  monteCarlo: ResultadoMc | null;
  /** Avisos que no rechazan pero hay que mirar (p. ej. el orden de las operaciones pesa mucho). */
  alertas: string[];
  suerte: ResultadoLuck | null;
  robustez: { costosDobles: number; vecinosPositivos: number | null; tramosPositivos: number; otroMercado: (Metricas & { simbolo: string }) | null };
  deflatedSharpe: number | null;
  pbo: number | null;
  ensayos: number;
}

export const MIN_BARRAS_OOS = 500;
export const MIN_OPERACIONES = 30;

/** Φ(x): función de distribución normal estándar. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
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

const pctTxt = (v: number) => `${(v * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const dec = (v: number, d: number) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

export function juzgar(e: EntradaJuez): ResultadoJuez {
  const n = e.cierres.length;
  const costos = e.costos ?? COSTOS_POR_DEFECTO;
  // Regla de huecos (motor Backtest): sin posición en la barra anterior a un corte de datos.
  const posiciones = e.posiciones.map((p) => aplicarHuecos(p, e.huecos));
  const r = crearAleatorio(e.semilla ?? 12_345);
  const fx = e.funding ? { funding: { tiempos: e.tiempos, tasas: e.funding } } : {};

  // Referencia dentro de muestra (optimista): cada variante sobre toda la serie.
  const completos = posiciones.map((p) => backtest(e.cierres, p, costos, 0, n, fx));
  const metCompletas = completos.map((b) => metricas(b, e.tiempos));
  const srCompletos = completos.map((b) => sharpeBarras(b.retornos) ?? -Infinity);
  const mejor = srCompletos.indexOf(Math.max(...srCompletos));

  // Motor 3 · Walk-Forward (ventanas rolling IS → OOS con embargo).
  const wfo = walkForward({ cierres: e.cierres, tiempos: e.tiempos, posiciones, costos, opciones: fx, config: e.wfo });
  const inicioOos = wfo.inicioOos;
  const retOos = wfo.retornos;
  const posOos = wfo.posiciones;
  const opsOos = wfo.operaciones;
  const tramos: TramoWF[] = wfo.ventanas.map((v) => ({ ...v, desde: v.oosDesde, hasta: v.oosHasta }));
  // Robustez: el mismo θ* de cada ventana con el doble de costos.
  const dobles = { comisionPb: costos.comisionPb * 2, deslizamientoPb: costos.deslizamientoPb * 2 };
  const retDobles = new Array(n).fill(0);
  for (const v of wfo.ventanas) {
    const b = backtest(e.cierres, posiciones[v.combo], dobles, v.oosDesde, v.oosHasta, fx);
    for (let i = v.oosDesde; i < v.oosHasta; i += 1) retDobles[i] = b.retornos[i];
  }
  const resOos = { retornos: retOos, equity: [], operaciones: opsOos };
  const oos = metricas(resOos, e.tiempos, inicioOos, n);
  let eq = 1;
  const equityOos = retOos.slice(inicioOos).map((x) => (eq *= 1 + x));
  const costosDobles = retDobles.slice(inicioOos).reduce((a, x) => a * (1 + x), 1) - 1;
  const tramosPositivos = tramos.length ? tramos.filter((t) => t.retorno > 0).length / tramos.length : 0;

  // Motor 4 · Monte Carlo de las operaciones fuera de muestra.
  const mc = opsOos.length >= 5 ? monteCarlo(opsOos.map((o) => o.retorno), r, e.monteCarlo) : null;

  // Motor 5 · Luck test sobre lo hecho fuera de muestra.
  const largoOos = n - inicioOos;
  const suerte = opsOos.length >= 5 && largoOos > 50 ? luckTest({ cierres: e.cierres, posiciones: posOos, operaciones: opsOos, desde: inicioOos, hasta: n, costos, opciones: { ...fx, huecos: e.huecos }, azar: r, config: e.luck }) : null;

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
    { nombre: 'Eficiencia Walk-Forward (WFE)', ok: wfo.wfe === null ? false : wfo.wfe >= 0.5, valor: wfo.wfe === null ? 'el entrenamiento no gana' : `${dec(wfo.wfe, 2)} (${wfo.clase})`, umbral: '≥ 0,50', explicacion: 'Cuánto de lo que gana entrenando conserva en datos que no vio. < 0,30 = sobreajuste.' },
    { nombre: 'Estable entre tramos', ok: tramosPositivos >= 0.6, valor: `${Math.round(tramosPositivos * tramos.length)}/${tramos.length} tramos positivos`, umbral: '≥ 60 %', explicacion: 'Una ventaja real no depende de un solo periodo.' },
    { nombre: 'Luck test', ok: suerte ? suerte.p < ALFA_LUCK : null, valor: suerte ? `p = ${dec(suerte.p, 3)}` : '—', umbral: 'p < 0,05', explicacion: 'Mercados falsos o entradas al azar no deben igualarla más de 1 de cada 20 veces.' },
    { nombre: 'Drawdown máximo', ok: oos.maxDrawdown <= 0.2, valor: pctTxt(oos.maxDrawdown), umbral: '≤ 20 %', explicacion: 'Peor caída desde un máximo, fuera de muestra.' },
    { nombre: 'Monte Carlo: riesgo de ruina', ok: mc ? mc.probRuina <= RUINA_MAXIMA : null, valor: mc ? `${pctTxt(mc.probRuina)} de simulaciones caen ≥ ${pctTxt(mc.umbralRuina)}` : '—', umbral: '≤ 5 %', explicacion: 'Reordenando las operaciones miles de veces, la mala suerte no debe quemar la cuenta.' },
    { nombre: 'Aguanta costos ×2', ok: costosDobles > 0, valor: pctTxt(costosDobles), umbral: '> 0 %', explicacion: 'Con el doble de comisión y deslizamiento debe seguir ganando.' },
    { nombre: 'Deflated Sharpe', ok: dsr === null ? null : dsr >= 0.95, valor: dsr === null ? '—' : dec(dsr, 3), umbral: '≥ 0,95', explicacion: `Descuenta haber probado ${ensayos} ${ensayos === 1 ? 'variante' : 'variantes'}.` },
    { nombre: 'PBO (sobreajuste)', ok: pbo === null ? null : pbo <= 0.25, valor: pbo === null ? 'una sola variante' : pctTxt(pbo), umbral: '≤ 25 %', explicacion: 'Probabilidad de que la mejor variante dentro de muestra sea mediocre fuera.' },
    { nombre: 'Parámetros vecinos', ok: vecinosPositivos === null ? null : vecinosPositivos >= 0.6, valor: vecinosPositivos === null ? '—' : pctTxt(vecinosPositivos), umbral: '≥ 60 % ganan', explicacion: 'Si cambiar un poco un parámetro la rompe, es sobreajuste.' },
    { nombre: 'Otro mercado', ok: otroMercado ? otroMercado.retornoTotal > 0 : null, valor: otroMercado ? `${otroMercado.simbolo}: ${pctTxt(otroMercado.retornoTotal)}` : 'no probado', umbral: '> 0 %', explicacion: 'Un patrón que también funciona en otro mercado (BTC y XAU) es más fiable.' },
  ];
  const alertas: string[] = [];
  if (mc?.alertaOrden) alertas.push(`Monte Carlo: la peor caída probable (P95 ${pctTxt(mc.ddP95)}) es más del doble que la del backtest (${pctTxt(mc.ddOriginal)}). Si las pérdidas llegan seguidas, dolerá mucho más de lo que muestra el backtest.`);
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
    wfo: { objetivo: wfo.objetivo, lIs: wfo.lIs, lOos: wfo.lOos, embargo: wfo.embargo, wfe: wfo.wfe, clase: wfo.clase },
    equityOos,
    operacionesOos: opsOos,
    inicioOos,
    monteCarlo: mc,
    alertas,
    suerte,
    robustez: { costosDobles, vecinosPositivos, tramosPositivos, otroMercado },
    deflatedSharpe: dsr,
    pbo,
    ensayos,
  };
}
