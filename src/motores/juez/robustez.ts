// Motor 6 · Robustez: pruebas de estrés estructural. Es el único sitio donde se hacen.
//
// A. Costos ×2: los mismos θ* del Walk-Forward con comisión × 2 y deslizamiento × 2, fuera de muestra.
//    Pasa si Profit Factor > 1,2 y retorno neto > 0.
// B. Parámetros vecinos: θ* se elige SOLO con las barras anteriores al primer OOS (el primer IS), y θ* y sus
//    vecinos se miden en el tramo fuera de muestra, que no se usó para elegir (sin fuga de información).
//    Cada parámetro se mueve UN paso contiguo de la rejilla (θ_p − δ y θ_p + δ), dejando los demás iguales.
//    Rentabilidad aceptable = retorno > 0.
//    Pasa si ≥ 70 % de los vecinos son aceptables. Caída = (Sharpe θ* − Sharpe vecino) / |Sharpe θ*|;
//    si la caída media supera el 50 % → alerta de «isla de optimización».
// C. Otro mercado: θ* congelado, sin reoptimizar, en otro activo. No debe destruir capital:
//    pasa si retorno > −10 % y drawdown ≤ 2 × el drawdown fuera de muestra del original (mínimo 10 %).
// D. Estabilidad por regímenes: el tramo fuera de muestra se corta en 10 sub-periodos estancos; cada uno se
//    clasifica por dirección (sube / baja) y volatilidad (alta / baja frente a la mediana). Pasa si gana en
//    ≥ 60 % de los sub-periodos y ningún sub-periodo aporta ≥ 90 % de las ganancias.
// Veredicto del módulo: se cuentan A, B y D (las críticas). 0 fallos → aprobado; 1 → alerta; ≥ 2 → rechazado.
import { backtest, metricas, type Costos, type Metricas, type OpcionesBacktest, type Operacion } from './backtest';
import type { Combo } from './juez';

export const PF_MINIMO_COSTOS = 1.2;
export const VECINOS_MINIMO = 0.7;
export const CAIDA_ISLA = 0.5;
export const SUBPERIODOS = 10;
export const CONSISTENCIA_MINIMA = 0.6;
export const CONCENTRACION_MAXIMA = 0.9;

export interface Vecino {
  combo: number;
  /** Qué cambió, p. ej. «umbral 60 → 70». */
  cambio: string;
  retorno: number;
  sharpe: number | null;
  caida: number | null;
  aceptable: boolean;
}

export interface Subperiodo {
  desde: number;
  hasta: number;
  direccion: 'sube' | 'baja';
  volatilidad: 'alta' | 'baja';
  retorno: number;
}

export type EstadoRobustez = 'aprobado' | 'alerta' | 'rechazado';

export interface ResultadoRobustez {
  costos2x: { retorno: number; factorBeneficio: number | null; ok: boolean };
  /** `base` = variante de la que salen los vecinos (elegida antes del primer OOS). */
  vecinos: { base: number; lista: Vecino[]; proporcion: number | null; caidaMedia: number | null; isla: boolean; ok: boolean | null };
  otroMercado: (Metricas & { simbolo: string; ok: boolean }) | null;
  estabilidad: { subperiodos: Subperiodo[]; consistencia: number; concentracion: number | null; ok: boolean };
  fallas: number;
  estado: EstadoRobustez;
}

/** Vecinos contiguos de `base` en la rejilla: cada parámetro un paso arriba y abajo, el resto igual. */
export function vecinosContiguos(combos: readonly Combo[], base: number): { combo: number; cambio: string }[] {
  const b = combos[base];
  if (!b) return [];
  const out: { combo: number; cambio: string }[] = [];
  for (const k of Object.keys(b)) {
    const valores = [...new Set(combos.map((c) => c[k]))].sort((x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))));
    const i = valores.indexOf(b[k]);
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= valores.length) continue;
      const idx = combos.findIndex((c) => c[k] === valores[j] && Object.keys(b).every((o) => o === k || c[o] === b[o]));
      if (idx >= 0) out.push({ combo: idx, cambio: `${k} ${String(b[k])} → ${String(valores[j])}` });
    }
  }
  return out;
}

/** Sub-periodos estancos del tramo [desde, hasta) con su régimen y el retorno de la estrategia. */
export function subperiodos(cierres: readonly number[], retornos: readonly number[], desde: number, hasta: number, k = SUBPERIODOS): Subperiodo[] {
  const largo = Math.floor((hasta - desde) / k);
  if (largo < 2) return [];
  const partes: (Omit<Subperiodo, 'volatilidad'> & { sd: number })[] = [];
  for (let j = 0; j < k; j += 1) {
    const a = desde + j * largo;
    const z = j === k - 1 ? hasta : a + largo;
    const rm: number[] = [];
    let ret = 1;
    for (let i = a; i < z; i += 1) {
      ret *= 1 + retornos[i];
      if (i + 1 < z && cierres[i] > 0) rm.push(cierres[i + 1] / cierres[i] - 1);
    }
    const m = rm.reduce((s, x) => s + x, 0) / Math.max(1, rm.length);
    const sd = Math.sqrt(rm.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, rm.length - 1));
    partes.push({ desde: a, hasta: z, direccion: cierres[z - 1] >= cierres[a] ? 'sube' : 'baja', retorno: ret - 1, sd });
  }
  const sds = partes.map((p) => p.sd).sort((x, y) => x - y);
  const mediana = sds.length % 2 ? sds[(sds.length - 1) / 2] : (sds[sds.length / 2 - 1] + sds[sds.length / 2]) / 2;
  return partes.map(({ sd, ...p }) => ({ ...p, volatilidad: sd > mediana ? 'alta' : 'baja' }));
}

export function robustez(e: {
  cierres: readonly number[];
  tiempos: readonly number[];
  posiciones: readonly (readonly number[])[];
  combos: readonly Combo[];
  /** θ* elegido solo con barras anteriores al primer OOS. */
  mejor: number;
  /** Métricas de cada variante en el tramo fuera de muestra [inicioOos, n). */
  metOos: readonly Metricas[];
  /** Ventanas del Walk-Forward (para repetirlas con costos ×2). */
  ventanas: readonly { oosDesde: number; oosHasta: number; combo: number }[];
  inicioOos: number;
  /** Retornos fuera de muestra con los costos normales. */
  retornosOos: readonly number[];
  ddOos: number;
  costos: Costos;
  opciones?: OpcionesBacktest;
  otroMercado?: (Metricas & { simbolo: string }) | null;
}): ResultadoRobustez {
  const n = e.cierres.length;
  // A. Costos ×2.
  const dobles: Costos = { comisionPb: e.costos.comisionPb * 2, deslizamientoPb: e.costos.deslizamientoPb * 2 };
  const ret2 = new Array(n).fill(0);
  const ops2: Operacion[] = [];
  for (const v of e.ventanas) {
    const b = backtest(e.cierres, e.posiciones[v.combo], dobles, v.oosDesde, v.oosHasta, e.opciones);
    for (let i = v.oosDesde; i < v.oosHasta; i += 1) ret2[i] = b.retornos[i];
    ops2.push(...b.operaciones);
  }
  const m2 = metricas({ retornos: ret2, equity: [], operaciones: ops2 }, e.tiempos, e.inicioOos, n);
  const costos2x = { retorno: m2.retornoTotal, factorBeneficio: m2.factorBeneficio, ok: m2.retornoTotal > 0 && (m2.factorBeneficio ?? 0) > PF_MINIMO_COSTOS };

  // B. Parámetros vecinos.
  const sB = e.metOos[e.mejor]?.sharpe ?? null;
  const lista: Vecino[] = vecinosContiguos(e.combos, e.mejor).map(({ combo, cambio }) => {
    const m = e.metOos[combo];
    const caida = sB !== null && sB > 0 && m.sharpe !== null ? (sB - m.sharpe) / Math.abs(sB) : null;
    return { combo, cambio, retorno: m.retornoTotal, sharpe: m.sharpe, caida, aceptable: m.retornoTotal > 0 };
  });
  const caidas = lista.map((v) => v.caida).filter((x): x is number => x !== null);
  const caidaMedia = caidas.length ? caidas.reduce((a, x) => a + x, 0) / caidas.length : null;
  const proporcion = lista.length ? lista.filter((v) => v.aceptable).length / lista.length : null;
  const vecinos = { base: e.mejor, lista, proporcion, caidaMedia, isla: caidaMedia !== null && caidaMedia > CAIDA_ISLA, ok: proporcion === null ? null : proporcion >= VECINOS_MINIMO };

  // C. Otro mercado.
  const otroMercado = e.otroMercado ? { ...e.otroMercado, ok: e.otroMercado.retornoTotal > -0.1 && e.otroMercado.maxDrawdown <= Math.max(0.1, 2 * e.ddOos) } : null;

  // D. Estabilidad por regímenes.
  const subs = subperiodos(e.cierres, e.retornosOos, e.inicioOos, n);
  const consistencia = subs.length ? subs.filter((s) => s.retorno > 0).length / subs.length : 0;
  const ganancias = subs.map((s) => Math.max(0, s.retorno));
  const suma = ganancias.reduce((a, x) => a + x, 0);
  const concentracion = suma > 0 ? Math.max(...ganancias) / suma : null;
  const estabilidad = { subperiodos: subs, consistencia, concentracion, ok: consistencia >= CONSISTENCIA_MINIMA && (concentracion === null || concentracion < CONCENTRACION_MAXIMA) };

  // Veredicto del módulo (pruebas críticas: A, B y D; B no cuenta si no hay vecinos que probar).
  const fallas = [costos2x.ok, vecinos.ok, estabilidad.ok].filter((x) => x === false).length;
  return { costos2x, vecinos, otroMercado, estabilidad, fallas, estado: fallas === 0 ? 'aprobado' : fallas === 1 ? 'alerta' : 'rechazado' };
}
