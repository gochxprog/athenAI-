// Motor 10 · Veredicto: el juez central. Lee el resultado de los motores 1–9 y decide.
//
// 0. Datos suficientes (≥ 500 barras y ≥ 30 operaciones fuera de muestra); si no → DATOS INSUFICIENTES.
// A. Puertas de cero tolerancia: si falla cualquiera → RECHAZADA (con la razón exacta).
//    Anti-futuro detecta fuga · ruina (Monte Carlo) > 5 % · PBO ≥ 5 % · DSR < 0,95 · Luck test p ≥ 0,05 ·
//    módulo de robustez rechazado (2 o más fallos críticos, como dice su especificación).
//    Una puerta que no aplica (p. ej. PBO con una sola variante) no rechaza.
// B. Puntuación 0–100 si pasa todas las puertas (cada parte va de 0 a 1):
//    25 % WFO:               WFE / 0,7 (0,7 = excelente = parte completa)
//    25 % costos y vecinos:  media de [(PF con costos ×2 − 1) / 0,5 si gana con costos ×2, si no 0] y [vecinos aceptables]
//    30 % DSR / PBO:         media de [(DSR − 0,5) / 0,5] y [1 − PBO / 0,5]
//    20 % curva / Luck test: media de [1 − p / 0,05], [Sharpe anual / 2] y [1 − drawdown / 30 %]
//    Todo recortado a [0, 1]. Puntuación ≥ 75 → APROBADA para Paper Trading; < 75 → APROBADA CON RESERVA.

export type Veredicto = 'APROBADA' | 'APROBADA CON RESERVA' | 'RECHAZADA' | 'DATOS INSUFICIENTES';

export const SCORE_PAPER = 75;
export const PESOS_SCORE = { wfo: 0.25, costosVecinos: 0.25, sobreajuste: 0.3, curva: 0.2 } as const;

export interface Puerta {
  nombre: string;
  /** null = no aplica. */
  ok: boolean | null;
  valor: string;
  umbral: string;
}

export interface EntradaVeredicto {
  datosSuficientes: boolean;
  antiFuturoOk: boolean | null;
  probRuina: number | null;
  pbo: number | null;
  dsr: number | null;
  luckP: number | null;
  robustezRechazada: boolean;
  wfe: number | null;
  costos2x: { retorno: number; factorBeneficio: number | null };
  vecinosProporcion: number | null;
  sharpeOos: number | null;
  ddOos: number;
}

export interface ScoreVeredicto {
  total: number;
  partes: { wfo: number; costosVecinos: number; sobreajuste: number; curva: number };
}

const recortar = (x: number) => Math.min(1, Math.max(0, x));
const media = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0;
};

export function puntuar(e: EntradaVeredicto): ScoreVeredicto {
  const wfo = e.wfe === null ? 0 : recortar(e.wfe / 0.7);
  const costos = e.costos2x.retorno > 0 && e.costos2x.factorBeneficio !== null ? recortar((e.costos2x.factorBeneficio - 1) / 0.5) : 0;
  const costosVecinos = media([costos, e.vecinosProporcion]);
  const sobreajuste = media([e.dsr === null ? 0 : recortar((e.dsr - 0.5) / 0.5), e.pbo === null ? null : recortar(1 - e.pbo / 0.5)]);
  const curva = media([e.luckP === null ? 0 : recortar(1 - e.luckP / 0.05), e.sharpeOos === null ? 0 : recortar(e.sharpeOos / 2), recortar(1 - e.ddOos / 0.3)]);
  const total = 100 * (PESOS_SCORE.wfo * wfo + PESOS_SCORE.costosVecinos * costosVecinos + PESOS_SCORE.sobreajuste * sobreajuste + PESOS_SCORE.curva * curva);
  return { total, partes: { wfo, costosVecinos, sobreajuste, curva } };
}

const pct = (v: number) => `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;
const dec = (v: number, d: number) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

export function puertas(e: EntradaVeredicto): Puerta[] {
  return [
    { nombre: 'Anti-futuro (sin fuga de datos)', ok: e.antiFuturoOk === false ? false : e.antiFuturoOk, valor: e.antiFuturoOk === null ? 'no comprobado' : e.antiFuturoOk ? 'causal' : 'fuga detectada', umbral: 'sin fugas' },
    { nombre: 'Probabilidad de ruina (Monte Carlo)', ok: e.probRuina === null ? null : e.probRuina <= 0.05, valor: e.probRuina === null ? '—' : pct(e.probRuina), umbral: '≤ 5 %' },
    { nombre: 'PBO', ok: e.pbo === null ? null : e.pbo < 0.05, valor: e.pbo === null ? 'no aplica (1 variante)' : pct(e.pbo), umbral: '< 5 %' },
    { nombre: 'Deflated Sharpe', ok: e.dsr === null ? null : e.dsr >= 0.95, valor: e.dsr === null ? '—' : dec(e.dsr, 3), umbral: '≥ 0,95' },
    { nombre: 'Luck test', ok: e.luckP === null ? null : e.luckP < 0.05, valor: e.luckP === null ? '—' : `p = ${dec(e.luckP, 3)}`, umbral: 'p < 0,05' },
    { nombre: 'Módulo de robustez', ok: !e.robustezRechazada, valor: e.robustezRechazada ? 'rechazado (≥ 2 fallos)' : 'superado', umbral: '< 2 fallos críticos' },
  ];
}

export function veredicto(e: EntradaVeredicto): { veredicto: Veredicto; puertas: Puerta[]; score: ScoreVeredicto | null; falladas: Puerta[] } {
  const ps = puertas(e);
  if (!e.datosSuficientes) return { veredicto: 'DATOS INSUFICIENTES', puertas: ps, score: null, falladas: [] };
  const falladas = ps.filter((p) => p.ok === false);
  if (falladas.length) return { veredicto: 'RECHAZADA', puertas: ps, score: null, falladas };
  const score = puntuar(e);
  return { veredicto: score.total >= SCORE_PAPER ? 'APROBADA' : 'APROBADA CON RESERVA', puertas: ps, score, falladas };
}
