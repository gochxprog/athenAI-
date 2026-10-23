// El Juez: decide si una estrategia sirve, con pruebas que castigan la suerte y el sobreajuste.
//
//   1. Walk-Forward purgado con embargo: las primeras 4/9 partes solo sirven para elegir parámetros; las 5/9
//      restantes se reparten en 5 tramos. En cada tramo se eligen los parámetros con lo ANTERIOR (dejando 20 barras de
//      embargo) y se prueba en el tramo, que nunca se vio. Todas las métricas finales son de esos tramos.
//   2. Monte Carlo: remuestrea las operaciones fuera de muestra 2.000 veces → peor escenario razonable.
//   3. Luck test: 1.000 versiones de la misma estrategia desplazada al azar en el tiempo (misma exposición,
//      mismas operaciones). Si el azar consigue lo mismo a menudo, no hay ventaja.
//   4. Robustez: costos ×2, parámetros vecinos y estabilidad por regímenes (robustez.ts).
//   5. Deflated Sharpe (López de Prado): descuenta haber probado muchas variantes.
//   6. PBO (CSCV): probabilidad de que la mejor variante dentro de muestra sea peor que la mediana fuera.
// Un mercado, un juicio: todo se mide SOLO con los datos (fuera de muestra) del mercado `mercado`. Un edge nunca
// se prueba ni se aprueba con datos de otro activo (docs/ARQUITECTURA_MERCADOS.md).
import { crearAleatorio } from '@/lib/random';
import { SCORE_PAPER, veredicto, type Puerta, type ScoreVeredicto, type Veredicto } from './veredicto';
import { deflatedSharpe, DSR_MINIMO, pboCscv, PBO_MAXIMO, type DetalleDsr, type DetallePbo } from './sobreajuste';
import { robustez, type ResultadoRobustez } from './robustez';
import { ALFA_LUCK, luckTest, type ConfigLuck, type ResultadoLuck } from './luckTest';
import { monteCarlo, RUINA_MAXIMA, type ConfigMc, type ResultadoMc } from './monteCarlo';
import { elegirVariante, walkForward, type ClaseWfe, type ConfigWfo, type ObjetivoWfo, type VentanaResultado } from './walkForward';
import type { MercadoId } from '@/motores/mercado/mercadoId';
import { aplicarHuecos, backtest, COSTOS_POR_DEFECTO, metricas, sharpeBarras, type Costos, type Metricas, type OpcionesBacktest, type Operacion } from './backtest';
import type { ReglasSalida } from './salidas';

export type Combo = Record<string, number | string | boolean>;

export interface EntradaJuez {
  /** Mercado de TODAS las series de esta entrada (market_id). El resultado lo lleva pegado. */
  mercado?: MercadoId;
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
  /** Stop/objetivo/gestión declarados por la estrategia (GESTION) y las velas para vigilarlos. */
  salidas?: OpcionesBacktest['salidas'];
  /** GESTION de cada variante cuando la estrategia prueba varias (p. ej. "rr": [2, 3]): una por combo. */
  salidasPorCombo?: ReglasSalida[];
  /** Variantes probadas en total (todas las ejecuciones de esta idea): alimenta el Deflated Sharpe. */
  ensayos?: number;
  /** Resultado de la prueba anti-futuro (la estrategia no usa datos de barras posteriores). */
  antiFuturo?: { ok: boolean; detalle: string; estatico?: { violaciones: string[]; alertas: string[] }; dinamico?: { cortes: number; recorte: boolean; alteracion: boolean; fila: number | null; prueba: string | null } } | null;
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
  /** puerta = rechaza si falla (cero tolerancia); puntua = entra en la puntuación o es informativa. */
  tipo: 'puerta' | 'puntua';
  ok: boolean | null;
  valor: string;
  umbral: string;
  explicacion: string;
}

export interface ResultadoJuez {
  /** Mercado juzgado (market_id): la aprobación solo vale para él. */
  mercado: MercadoId | null;
  /** APROBADA = lista para Paper Trading (puntuación ≥ 75). */
  veredicto: Veredicto;
  /** Puertas de cero tolerancia (motor 10). */
  puertas: Puerta[];
  /** Puntuación 0–100 (solo si pasa todas las puertas). */
  score: ScoreVeredicto | null;
  /** Detalle del Anti-futuro (motor 9). */
  antiFuturo: EntradaJuez['antiFuturo'];
  resumen: string;
  reglas: Regla[];
  /** Métricas fuera de muestra (las que cuentan). */
  oos: Metricas;
  /** Mejor variante con toda la muestra (optimista: solo como referencia). */
  dentroMuestra: Metricas & { combo: number };
  /** Variante para operar en vivo: la que elegiría hoy el Walk-Forward (mismo objetivo, últimas L_IS barras). */
  comboVivo: number;
  tramos: TramoWF[];
  /** Walk-Forward: objetivo, tamaños de ventana y eficiencia (WFE). */
  wfo: { objetivo: ObjetivoWfo; lIs: number; lOos: number; embargo: number; wfe: number | null; clase: ClaseWfe | null };
  /** Capital fuera de muestra, por barra (empieza en 1 al inicio del primer tramo). */
  equityOos: number[];
  /**
   * Retorno de cada operación del tramo de entrenamiento (antes del primer OOS, menos el embargo) con la variante
   * elegida SOLO con ese tramo. Solo para dibujar la curva In-Sample: no decide nada.
   */
  retornosIs?: number[];
  /** Operaciones fuera de muestra (índices de barra de la serie completa). */
  operacionesOos: Operacion[];
  /** Índice de la barra donde empieza la parte fuera de muestra. */
  inicioOos: number;
  monteCarlo: ResultadoMc | null;
  /** Avisos que no rechazan pero hay que mirar (p. ej. el orden de las operaciones pesa mucho). */
  alertas: string[];
  suerte: ResultadoLuck | null;
  robustez: ResultadoRobustez;
  deflatedSharpe: number | null;
  pbo: number | null;
  /** Términos del Deflated Sharpe y del PBO (para mostrarlos). */
  dsrDetalle: DetalleDsr | null;
  pboDetalle: DetallePbo | null;
  ensayos: number;
}

export const MIN_BARRAS_OOS = 500;
export const MIN_OPERACIONES = 30;

const pctTxt = (v: number) => `${(v * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const dec = (v: number, d: number) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

export function juzgar(e: EntradaJuez): ResultadoJuez {
  const n = e.cierres.length;
  if (!e.posiciones.length) throw new Error('La estrategia no devolvió ninguna variante para juzgar.');
  const roto = e.cierres.findIndex((c) => !(c > 0) || !Number.isFinite(c));
  if (roto >= 0) throw new Error(`La vela ${roto} tiene un precio no válido (${e.cierres[roto]}): el Juez no juzga con datos rotos.`);
  const costos = e.costos ?? COSTOS_POR_DEFECTO;
  // Regla de huecos (motor Backtest): sin posición en la barra anterior a un corte de datos.
  const posiciones = e.posiciones.map((p) => aplicarHuecos(p, e.huecos));
  const r = crearAleatorio(e.semilla ?? 12_345);
  const fx: OpcionesBacktest = { ...(e.funding ? { funding: { tiempos: e.tiempos, tasas: e.funding } } : {}), ...(e.salidas ? { salidas: e.salidas } : {}) };
  // Cada variante con su propia GESTION (si la estrategia prueba varios RR o stops); si no, todas con la misma.
  const porCombo = e.salidas && e.salidasPorCombo?.length === e.posiciones.length ? e.salidasPorCombo : null;
  const fxDe = porCombo ? (i: number): OpcionesBacktest => ({ ...fx, salidas: { ...e.salidas!, reglas: porCombo[i] } }) : undefined;
  const fxCombo = (i: number) => fxDe?.(i) ?? fx;

  // Referencia dentro de muestra (optimista): cada variante sobre toda la serie.
  const completos = posiciones.map((p, i) => backtest(e.cierres, p, costos, 0, n, fxCombo(i)));
  const metCompletas = completos.map((b) => metricas(b, e.tiempos));
  const srCompletos = completos.map((b) => sharpeBarras(b.retornos) ?? -Infinity);
  const mejor = srCompletos.indexOf(Math.max(...srCompletos));

  // Motor 3 · Walk-Forward (ventanas rolling IS → OOS con embargo).
  const wfo = walkForward({ cierres: e.cierres, tiempos: e.tiempos, posiciones, costos, opciones: fx, opcionesDe: fxDe, config: e.wfo });
  const inicioOos = wfo.inicioOos;
  const retOos = wfo.retornos;
  const posOos = wfo.posiciones;
  const opsOos = wfo.operaciones;
  const tramos: TramoWF[] = wfo.ventanas.map((v) => ({ ...v, desde: v.oosDesde, hasta: v.oosHasta }));
  const resOos = { retornos: retOos, equity: [], operaciones: opsOos };
  const oos = metricas(resOos, e.tiempos, inicioOos, n);
  let eq = 1;
  const equityOos = retOos.slice(inicioOos).map((x) => (eq *= 1 + x));

  // Motor 4 · Monte Carlo de las operaciones fuera de muestra.
  const mc = opsOos.length >= 5 ? monteCarlo(opsOos.map((o) => o.retorno), r, e.monteCarlo) : null;

  // Motor 5 · Luck test sobre lo hecho fuera de muestra.
  const largoOos = n - inicioOos;
  const suerte = opsOos.length >= 5 && largoOos > 50 ? luckTest({ cierres: e.cierres, posiciones: posOos, operaciones: opsOos, desde: inicioOos, hasta: n, costos, opciones: { ...fxCombo(wfo.ventanas.at(-1)?.combo ?? mejor), huecos: e.huecos }, azar: r, config: e.luck }) : null;

  // Variante para los vecinos: elegida SOLO con barras anteriores al primer OOS; θ* y vecinos se miden en el OOS.
  const objetivo = wfo.objetivo;
  const seleccionPrevia = elegirVariante({ cierres: e.cierres, tiempos: e.tiempos, posiciones, costos, opciones: fx, opcionesDe: fxDe }, 0, Math.max(0, inicioOos - wfo.embargo), objetivo).combo;
  const metOos = posiciones.map((p, i) => metricas(backtest(e.cierres, p, costos, inicioOos, n, fxCombo(i)), e.tiempos, inicioOos, n));
  const retornosIs = posiciones[seleccionPrevia] ? backtest(e.cierres, posiciones[seleccionPrevia], costos, 0, Math.max(0, inicioOos - wfo.embargo), fxCombo(seleccionPrevia)).operaciones.map((o) => o.retorno) : [];
  // Variante que se lleva a vivo: la que el Walk-Forward elegiría HOY (mismo objetivo, últimas L_IS barras).
  const comboVivo = wfo.ventanas.length ? elegirVariante({ cierres: e.cierres, tiempos: e.tiempos, posiciones, costos, opciones: fx, opcionesDe: fxDe }, Math.max(0, n - wfo.lIs), n, objetivo).combo : mejor;

  // Motor 6 · Robustez (costos ×2, vecinos, estabilidad por regímenes), solo con este mercado.
  const rob = robustez({ cierres: e.cierres, tiempos: e.tiempos, posiciones, combos: e.combos, mejor: seleccionPrevia, metOos, ventanas: wfo.ventanas, inicioOos, retornosOos: retOos, costos, opciones: fx, opcionesDe: fxDe });

  // Motores 7 y 8 · Sobreajuste: Deflated Sharpe (fuera de muestra) y PBO (CSCV con todas las variantes).
  const ensayos = Math.max(e.ensayos ?? 1, e.combos.length);
  const retO = retOos.slice(inicioOos);
  const srO = sharpeBarras(retO);
  const dsrDetalle = srO === null ? null : deflatedSharpe(retO, srO, ensayos, srCompletos);
  const dsr = dsrDetalle?.dsr ?? null;
  const pboDetalle = pboCscv(completos.map((b) => b.retornos));
  const pbo = pboDetalle?.pbo ?? null;

  // Reglas del Juez (fijas: los modelos no pueden cambiarlas).
  const reglas: Regla[] = [
    { nombre: 'Datos suficientes', tipo: 'puerta', ok: largoOos >= MIN_BARRAS_OOS && opsOos.length >= MIN_OPERACIONES, valor: `${largoOos} barras · ${opsOos.length} operaciones fuera de muestra`, umbral: `≥ ${MIN_BARRAS_OOS} barras y ≥ ${MIN_OPERACIONES} operaciones`, explicacion: 'Con pocas operaciones cualquier resultado puede ser casualidad.' },
    { nombre: 'No mira al futuro', tipo: 'puerta', ok: e.antiFuturo ? e.antiFuturo.ok : null, valor: e.antiFuturo?.detalle ?? 'no comprobado', umbral: 'posiciones idénticas con y sin datos posteriores', explicacion: 'Si la posición de hoy cambia al añadir datos de mañana, la estrategia hace trampa.' },
    { nombre: 'Gana fuera de muestra (Walk-Forward)', tipo: 'puntua', ok: oos.retornoTotal > 0, valor: pctTxt(oos.retornoTotal), umbral: '> 0 %', explicacion: 'Solo cuentan los tramos que la estrategia no vio al elegir sus parámetros.' },
    { nombre: 'Eficiencia Walk-Forward (WFE)', tipo: 'puntua', ok: wfo.wfe === null ? false : wfo.wfe >= 0.5, valor: wfo.wfe === null ? 'el entrenamiento no gana' : `${dec(wfo.wfe, 2)} (${wfo.clase})`, umbral: '≥ 0,50', explicacion: 'Cuánto de lo que gana entrenando conserva en datos que no vio. < 0,30 = sobreajuste.' },
    { nombre: 'Luck test', tipo: 'puerta', ok: suerte ? suerte.p < ALFA_LUCK : null, valor: suerte ? `p = ${dec(suerte.p, 3)}` : '—', umbral: 'p < 0,05', explicacion: 'Mercados falsos o entradas al azar no deben igualarla más de 1 de cada 20 veces.' },
    { nombre: 'Drawdown máximo', tipo: 'puntua', ok: oos.maxDrawdown <= 0.2, valor: pctTxt(oos.maxDrawdown), umbral: '≤ 20 %', explicacion: 'Peor caída desde un máximo, fuera de muestra.' },
    { nombre: 'Monte Carlo: riesgo de ruina', tipo: 'puerta', ok: mc ? mc.probRuina <= RUINA_MAXIMA : null, valor: mc ? `${pctTxt(mc.probRuina)} de simulaciones caen ≥ ${pctTxt(mc.umbralRuina)}` : '—', umbral: '≤ 5 %', explicacion: 'Reordenando las operaciones miles de veces, la mala suerte no debe quemar la cuenta.' },
    { nombre: 'Deflated Sharpe', tipo: 'puerta', ok: dsr === null ? null : dsr >= DSR_MINIMO, valor: dsr === null ? '—' : dec(dsr, 3), umbral: '≥ 0,95', explicacion: `Descuenta haber probado ${ensayos} ${ensayos === 1 ? 'variante' : 'variantes'}.` },
    { nombre: 'PBO (sobreajuste)', tipo: 'puerta', ok: pbo === null ? null : pbo < PBO_MAXIMO, valor: pbo === null ? 'una sola variante' : pctTxt(pbo), umbral: '< 5 %', explicacion: 'Probabilidad de que la mejor variante en entrenamiento quede por debajo de la mediana fuera.' },
    { nombre: 'Robustez (costos ×2, vecinos, estabilidad)', tipo: 'puerta', ok: rob.estado !== 'rechazado', valor: `${3 - rob.fallas - (rob.vecinos.ok === null ? 1 : 0)}/${rob.vecinos.ok === null ? 2 : 3} pruebas superadas`, umbral: 'falla como mucho 1', explicacion: 'Debe aguantar el doble de costos, cambios pequeños en sus parámetros y distintos regímenes del mercado.' },
  ];
  const alertas: string[] = [];
  if (mc?.alertaOrden) alertas.push(`Monte Carlo: la peor caída probable (P95 ${pctTxt(mc.ddP95)}) es más del doble que la del backtest (${pctTxt(mc.ddOriginal)}). Si las pérdidas llegan seguidas, dolerá mucho más de lo que muestra el backtest.`);
  if (rob.estado === 'alerta') alertas.push(`Robustez: falla 1 de las pruebas críticas (${[!rob.costos2x.ok && 'costos ×2', rob.vecinos.ok === false && 'parámetros vecinos', !rob.estabilidad.ok && 'estabilidad'].filter(Boolean).join(', ')}). No rechaza, pero revísalo.`);
  if (rob.vecinos.isla) alertas.push(`Isla de optimización: al mover un paso los parámetros, el Sharpe cae de media un ${pctTxt(rob.vecinos.caidaMedia ?? 0)}.`);
  if (rob.costos2x.factorBeneficio !== null && rob.costos2x.factorBeneficio < 1.2) alertas.push('Frágil ante fricciones: con el doble de costos el Profit Factor baja de 1,2.');
  if (wfo.clase === 'sobreajuste') alertas.push(`Walk-Forward: la eficiencia (WFE ${dec(wfo.wfe ?? 0, 2)}) está por debajo de 0,30: alerta roja de sobreajuste.`);
  if (e.antiFuturo?.estatico?.alertas.length) alertas.push(`Anti-futuro: ${e.antiFuturo.estatico.alertas[0]}`);

  // Motor 10 · Veredicto: puertas de cero tolerancia y puntuación.
  const v = veredicto({
    datosSuficientes: reglas[0].ok === true,
    antiFuturoOk: e.antiFuturo ? e.antiFuturo.ok : null,
    probRuina: mc?.probRuina ?? null,
    pbo,
    dsr,
    luckP: suerte?.p ?? null,
    robustezRechazada: rob.estado === 'rechazado',
    wfe: wfo.wfe,
    costos2x: rob.costos2x,
    vecinosProporcion: rob.vecinos.proporcion,
    sharpeOos: oos.sharpe,
    ddOos: oos.maxDrawdown,
  });
  const resumen =
    v.veredicto === 'DATOS INSUFICIENTES'
      ? `Hacen falta más datos: ${reglas[0].valor}. Deja grabando el mercado y vuelve a probar.`
      : v.veredicto === 'RECHAZADA'
        ? `Rechazada por: ${v.falladas.map((x) => `${x.nombre.toLowerCase()} (${x.valor}; se exige ${x.umbral})`).join(', ')}.`
        : v.veredicto === 'APROBADA'
          ? `Pasa todas las puertas con ${dec(v.score!.total, 0)} puntos de 100: lista para Paper Trading. Fuera de muestra: ${pctTxt(oos.retornoTotal)} con ${oos.operaciones} operaciones.`
          : `Pasa todas las puertas, pero con ${dec(v.score!.total, 0)} puntos (se piden ${SCORE_PAPER}): queda en cuarentena; conviene reajustar o grabar más datos.`;

  return {
    mercado: e.mercado ?? null,
    veredicto: v.veredicto,
    puertas: v.puertas,
    score: v.score,
    antiFuturo: e.antiFuturo ?? null,
    resumen,
    reglas,
    oos,
    dentroMuestra: { ...metCompletas[mejor], combo: mejor },
    comboVivo,
    tramos,
    wfo: { objetivo: wfo.objetivo, lIs: wfo.lIs, lOos: wfo.lOos, embargo: wfo.embargo, wfe: wfo.wfe, clase: wfo.clase },
    equityOos,
    retornosIs,
    operacionesOos: opsOos,
    inicioOos,
    monteCarlo: mc,
    alertas,
    suerte,
    robustez: rob,
    deflatedSharpe: dsr,
    pbo,
    dsrDetalle,
    pboDetalle,
    ensayos,
  };
}

