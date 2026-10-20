// Detector de régimen: rango / tendencia / día raro, aprendido SOLO de las Features guardadas.
//
// Entradas por dollar bar (independientes del precio del activo):
//   - eficiencia de 10 barras (|Σ retornos| / Σ |retornos|): 1 = el precio va en una dirección, 0 = va y vuelve;
//   - log(rango / ATR): volatilidad relativa de la barra;
//   - log(duración): lo rápido que se negocia el volumen de la barra;
//   - |delta / volumen|: lo desequilibrada que está la agresión.
// Se entrena un HMM de 3 estados y se nombran por sus características:
//   el de mayor volatilidad = "raro"; de los otros dos, el de mayor eficiencia = "tendencia"; el otro = "rango".
import type { FilaFeatures } from '../nucleo/features';
import { entrenarHMM, filtrarHMM, type ModeloHMM } from './hmm';

export type NombreRegimen = 'rango' | 'tendencia' | 'raro';

export const MIN_BARRAS_REGIMEN = 600;
const VENTANA_EFICIENCIA = 10;
const HORIZONTE_VALIDACION = 10;

export interface ValidacionRegimen {
  /** Barras usadas para entrenar (70 %) y para probar fuera de muestra (30 %). */
  barrasEntreno: number;
  barrasPrueba: number;
  /** Duración media (en barras) de cada racha de régimen en la parte de prueba. */
  persistencia: number;
  /** Eficiencia media de las 10 barras SIGUIENTES según el régimen detectado (fuera de muestra). */
  eficienciaFutura: Record<NombreRegimen, number | null>;
  /** Volatilidad media (rango/ATR) de las 10 barras siguientes según el régimen detectado. */
  volatilidadFutura: Record<NombreRegimen, number | null>;
  /** Proporción de barras de prueba en cada régimen. */
  reparto: Record<NombreRegimen, number>;
  /** El régimen detectado anticipa algo de lo que viene: tendencia más eficiente que rango y raro más volátil. */
  util: boolean;
  conclusion: string;
}

export interface ResultadoRegimen {
  actual: NombreRegimen;
  probabilidades: Record<NombreRegimen, number>;
  /** Barras seguidas en el régimen actual. */
  barrasEnRegimen: number;
  /** Régimen de las últimas barras (más antigua primero), para la línea de tiempo. */
  historia: NombreRegimen[];
  validacion: ValidacionRegimen;
  barras: number;
}

interface Serie {
  x: number[][];
  /** Índice de la fila original de cada observación. */
  idx: number[];
}

/** Construye las observaciones del HMM. Corta en huecos y cambios de sesión (no se mezclan tramos). */
export function observaciones(filas: readonly (FilaFeatures & { sesion?: number })[]): Serie {
  const x: number[][] = [];
  const idx: number[] = [];
  let tramo = 0;
  for (let i = 0; i < filas.length; i += 1) {
    const f = filas[i];
    const v = f.valores;
    const nuevoTramo = v.hueco === 1 || (i > 0 && f.sesion !== undefined && f.sesion !== filas[i - 1].sesion);
    tramo = nuevoTramo ? 0 : tramo + 1;
    if (tramo < VENTANA_EFICIENCIA) continue;
    let suma = 0;
    let sumaAbs = 0;
    for (let j = i - VENTANA_EFICIENCIA + 1; j <= i; j += 1) {
      const r = filas[j].valores.retorno ?? 0;
      suma += r;
      sumaAbs += Math.abs(r);
    }
    const rango = v.rango_atr;
    const dur = v.duracion_s;
    const dr = v.delta_ratio;
    if (rango === null || rango === undefined || dur === null || dur === undefined || dr === null || dr === undefined) continue;
    x.push([sumaAbs > 0 ? Math.abs(suma) / sumaAbs : 0, Math.log(Math.max(rango, 1e-3)), Math.log(Math.max(dur, 0.05)), Math.abs(dr)]);
    idx.push(i);
  }
  return { x, idx };
}

function estandarizar(x: number[][]): { z: number[][]; media: number[]; desv: number[] } {
  const d = x[0].length;
  const media = new Array(d).fill(0);
  for (const p of x) p.forEach((v, j) => (media[j] += v / x.length));
  const desv = new Array(d).fill(0);
  for (const p of x) p.forEach((v, j) => (desv[j] += (v - media[j]) ** 2 / x.length));
  for (let j = 0; j < d; j += 1) desv[j] = Math.sqrt(desv[j]) || 1;
  return { z: x.map((p) => p.map((v, j) => (v - media[j]) / desv[j])), media, desv };
}

/** Nombra los estados del HMM: mayor volatilidad = raro; de los demás, mayor eficiencia = tendencia. */
function nombrar(m: ModeloHMM): NombreRegimen[] {
  const ids = [0, 1, 2];
  const raro = ids.reduce((a, b) => (m.medias[b][1] > m.medias[a][1] ? b : a));
  const resto = ids.filter((i) => i !== raro);
  const tendencia = m.medias[resto[0]][0] >= m.medias[resto[1]][0] ? resto[0] : resto[1];
  return ids.map((i) => (i === raro ? 'raro' : i === tendencia ? 'tendencia' : 'rango'));
}

const vacio = <T,>(v: T): Record<NombreRegimen, T> => ({ rango: v, tendencia: v, raro: v });

function validar(filas: readonly FilaFeatures[], serie: Serie, nombres: NombreRegimen[], estados: number[], desde: number): ValidacionRegimen {
  const n = serie.x.length;
  const prueba = estados.slice(desde);
  let rachas = 0;
  for (let i = 0; i < prueba.length; i += 1) if (i === 0 || prueba[i] !== prueba[i - 1]) rachas += 1;
  const persistencia = prueba.length / Math.max(1, rachas);

  const acumEf = vacio(0);
  const acumVol = vacio(0);
  const cuenta = vacio(0);
  const reparto = vacio(0);
  for (let t = desde; t < n; t += 1) {
    const nombre = nombres[estados[t]];
    reparto[nombre] += 1 / Math.max(1, n - desde);
    const i = serie.idx[t];
    if (i + HORIZONTE_VALIDACION >= filas.length) continue;
    let suma = 0;
    let sumaAbs = 0;
    let vol = 0;
    let ok = true;
    for (let j = i + 1; j <= i + HORIZONTE_VALIDACION; j += 1) {
      const v = filas[j].valores;
      if (v.hueco === 1 || v.rango_atr === null || v.rango_atr === undefined) {
        ok = false;
        break;
      }
      const r = v.retorno ?? 0;
      suma += r;
      sumaAbs += Math.abs(r);
      vol += v.rango_atr / HORIZONTE_VALIDACION;
    }
    if (!ok) continue;
    acumEf[nombre] += sumaAbs > 0 ? Math.abs(suma) / sumaAbs : 0;
    acumVol[nombre] += vol;
    cuenta[nombre] += 1;
  }
  const media = (acc: Record<NombreRegimen, number>) =>
    Object.fromEntries((['rango', 'tendencia', 'raro'] as NombreRegimen[]).map((k) => [k, cuenta[k] >= 10 ? acc[k] / cuenta[k] : null])) as Record<NombreRegimen, number | null>;
  const ef = media(acumEf);
  const vol = media(acumVol);
  const tendenciaSepara = ef.tendencia !== null && ef.rango !== null && ef.tendencia > ef.rango;
  // "Raro" es, por definición, poco frecuente: si casi no apareció en la prueba no se puede evaluar (no cuenta en contra).
  const raroEvaluable = vol.raro !== null;
  const raroSepara = !raroEvaluable || [vol.rango, vol.tendencia].every((v) => v === null || vol.raro! > v);
  const util = tendenciaSepara && raroSepara && persistencia >= 3;
  const conclusion = util
    ? `Fuera de muestra, el régimen detectado anticipa lo que viene: en "tendencia" las 10 barras siguientes son más direccionales que en "rango"${raroEvaluable ? ', y en "raro" más volátiles' : ' ("raro" apareció muy poco para evaluarlo)'}. Los regímenes duran ≈ ${persistencia.toFixed(1)} barras.`
    : `Todavía no concluyente: ${!tendenciaSepara ? '"tendencia" no anticipa más dirección que "rango"' : ''}${!tendenciaSepara && !raroSepara ? '; ' : ''}${!raroSepara ? '"raro" no anticipa más volatilidad' : ''}${persistencia < 3 ? `${!tendenciaSepara || !raroSepara ? '; ' : ''}los regímenes duran poco (${persistencia.toFixed(1)} barras)` : ''}. Hacen falta más datos.`;
  return { barrasEntreno: desde, barrasPrueba: n - desde, persistencia, eficienciaFutura: ef, volatilidadFutura: vol, reparto, util, conclusion };
}

/**
 * Entrena con el 70 % más antiguo, valida en el 30 % siguiente (filtro forward, sin futuro) y devuelve el
 * régimen ACTUAL con el modelo reentrenado sobre todo lo disponible.
 */
export function detectarRegimen(filas: readonly (FilaFeatures & { sesion?: number })[], semilla = 7): ResultadoRegimen | null {
  const serie = observaciones(filas);
  if (serie.x.length < MIN_BARRAS_REGIMEN) return null;

  // Validación fuera de muestra: estandarización y modelo SOLO con el tramo de entreno.
  const corte = Math.floor(serie.x.length * 0.7);
  const ent = estandarizar(serie.x.slice(0, corte));
  const zTodo = serie.x.map((p) => p.map((v, j) => (v - ent.media[j]) / ent.desv[j]));
  const mVal = entrenarHMM(zTodo.slice(0, corte), 3, { semilla });
  const estadosVal = filtrarHMM(mVal, zTodo).map((p) => p.indexOf(Math.max(...p)));
  const validacion = validar(filas, serie, nombrar(mVal), estadosVal, corte);

  // Modelo final con todo el histórico para el régimen de ahora.
  const { z } = estandarizar(serie.x);
  const m = entrenarHMM(z, 3, { semilla });
  const nombres = nombrar(m);
  const probs = filtrarHMM(m, z);
  const estados = probs.map((p) => nombres[p.indexOf(Math.max(...p))]);
  const ultima = probs[probs.length - 1];
  const actual = estados[estados.length - 1];
  let barrasEnRegimen = 0;
  for (let i = estados.length - 1; i >= 0 && estados[i] === actual; i -= 1) barrasEnRegimen += 1;
  const probabilidades = vacio(0);
  ultima.forEach((p, i) => (probabilidades[nombres[i]] += p));
  return { actual, probabilidades, barrasEnRegimen, historia: estados.slice(-120), validacion, barras: serie.x.length };
}
