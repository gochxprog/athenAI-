// Diario de operaciones: la FICHA de cada operación (de un bot o manual), la BITÁCORA de eventos y el resumen tipo
// calendario (día / semana / mes) con sus métricas. Un solo formato para la Terminal, el Diario, Estrategias, el
// Lector, el Sintetizador y, más adelante, el ML.
//
//   P&L neto = P&L de precio − comisiones − funding        R = P&L de precio / riesgo inicial (1R)
//   % de la cuenta = P&L neto / capital al entrar
//   Profit factor = Σ ganancias netas / Σ |pérdidas netas|      Esperanza = media de R por operación
//   Drawdown = peor caída del P&L acumulado desde su máximo (en $)
//   Días, semanas y meses según la hora local de quien mira (desfase en minutos respecto a UTC); la semana empieza el lunes.

import type { MercadoId } from '../mercado/mercadoId';
import type { MotivoSalida, MovimientoStop } from '../juez/salidas';

export type OrigenOperacion = 'bot' | 'manual';

export interface FichaOperacion {
  id: string;
  origen: OrigenOperacion;
  /** Bot que la hizo (null = manual). */
  botId: string | null;
  estrategia: string;
  mercado: MercadoId;
  lado: 1 | -1;
  entrada: {
    t: number;
    precio: number;
    /** Por qué entró, en palabras (lo escribe el bot o el Lector). */
    motivo: string;
    /** Valores de las Features en la barra de la decisión (lo que vio). */
    senales: Record<string, number | null>;
  };
  stopInicial: number;
  objetivo: number | null;
  /** RR planeado (objetivo / riesgo). */
  rr: number | null;
  cantidad: number;
  /** Riesgo inicial en $ (cantidad × |entrada − stop|) y en % de la cuenta. */
  riesgoUsd: number;
  riesgoPct: number;
  capitalEntrada: number;
  movimientosStop: MovimientoStop[];
  salida: { t: number; precio: number; motivo: MotivoSalida | 'manual' | 'guardian' } | null;
  /** Resultado (al cerrar). */
  pnlPrecio: number;
  comisiones: number;
  funding: number;
  /** Deslizamiento real pagado ($) y el que esperaba el Juez ($). */
  deslizamiento: number;
  deslizamientoEsperado: number;
  /** Lo máximo a favor y en contra, en R. */
  mfe: number;
  mae: number;
  /** Captura del gráfico marcada (la toma el Lector) y su explicación. */
  captura?: string;
  explicacion?: string;
}

export type TipoEvento = 'juez' | 'bot' | 'guardian' | 'datos' | 'manual' | 'aviso';

/** Bitácora: todo lo que se decide o pasa, en un solo lugar (Decisiones y el Sintetizador la leen). */
export interface EventoBitacora {
  id: string;
  t: number;
  tipo: TipoEvento;
  mercado?: MercadoId;
  titulo: string;
  detalle: string;
  /** Referencia (id de ficha, paper o bot). */
  ref?: string;
}

export const pnlNeto = (f: FichaOperacion) => f.pnlPrecio - f.comisiones - f.funding;
export const resultadoR = (f: FichaOperacion) => (f.riesgoUsd > 0 ? f.pnlPrecio / f.riesgoUsd : null);
export const resultadoPct = (f: FichaOperacion) => (f.capitalEntrada > 0 ? pnlNeto(f) / f.capitalEntrada : null);

export interface ResumenPeriodo {
  /** Clave: 'AAAA-MM-DD' (día), 'AAAA-Www' (semana ISO) o 'AAAA-MM' (mes). */
  clave: string;
  pnl: number;
  /** Suma de % de la cuenta de cada operación. */
  pct: number;
  operaciones: number;
  ganadoras: number;
}

export interface MetricasDiario {
  operaciones: number;
  pnlNeto: number;
  gananciaBruta: number;
  perdidaBruta: number;
  comisiones: number;
  funding: number;
  aciertos: number | null;
  profitFactor: number | null;
  /** Media de R por operación. */
  esperanzaR: number | null;
  gananciaMedia: number | null;
  perdidaMedia: number | null;
  /** % de operaciones que llegaron a +1R a favor. */
  llegaron1R: number | null;
  maxDrawdown: number;
  mejorDia: ResumenPeriodo | null;
  peorDia: ResumenPeriodo | null;
  rachaGanadora: number;
  rachaPerdedora: number;
  /** Por día de la semana (0 = lunes … 6 = domingo) y por hora local (0–23). */
  porDiaSemana: { pnl: number; operaciones: number }[];
  porHora: { pnl: number; operaciones: number }[];
  largos: { pnl: number; operaciones: number };
  cortos: { pnl: number; operaciones: number };
}

export interface ResumenDiario {
  dias: ResumenPeriodo[];
  semanas: ResumenPeriodo[];
  meses: ResumenPeriodo[];
  metricas: MetricasDiario;
}

const dos = (n: number) => String(n).padStart(2, '0');

/** Fecha local (con el desfase) como partes. */
function local(t: number, desfaseMin: number) {
  const d = new Date(t + desfaseMin * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), dow: (d.getUTCDay() + 6) % 7, base: d };
}

/** Semana ISO 'AAAA-Www' (lunes a domingo). */
function semanaIso(base: Date): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia + 3);
  const primerJueves = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const semana = 1 + Math.round(((d.getTime() - primerJueves.getTime()) / 86_400_000 - 3 + ((primerJueves.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${dos(semana)}`;
}

function acumular(mapa: Map<string, ResumenPeriodo>, clave: string, f: FichaOperacion) {
  const r = mapa.get(clave) ?? { clave, pnl: 0, pct: 0, operaciones: 0, ganadoras: 0 };
  const neto = pnlNeto(f);
  r.pnl += neto;
  r.pct += resultadoPct(f) ?? 0;
  r.operaciones += 1;
  if (neto > 0) r.ganadoras += 1;
  mapa.set(clave, r);
}

/** Resume las operaciones CERRADAS (por fecha de salida) en días, semanas, meses y métricas. */
export function resumirDiario(fichas: readonly FichaOperacion[], desfaseMin = 0): ResumenDiario {
  const cerradas = fichas.filter((f) => f.salida !== null).sort((a, b) => a.salida!.t - b.salida!.t);
  const dias = new Map<string, ResumenPeriodo>();
  const semanas = new Map<string, ResumenPeriodo>();
  const meses = new Map<string, ResumenPeriodo>();
  const porDiaSemana = Array.from({ length: 7 }, () => ({ pnl: 0, operaciones: 0 }));
  const porHora = Array.from({ length: 24 }, () => ({ pnl: 0, operaciones: 0 }));
  const largos = { pnl: 0, operaciones: 0 };
  const cortos = { pnl: 0, operaciones: 0 };
  let ganBruta = 0;
  let perBruta = 0;
  let ganadoras = 0;
  let comisiones = 0;
  let funding = 0;
  let sumaR = 0;
  let nR = 0;
  let llegaron = 0;
  let acum = 0;
  let pico = 0;
  let maxDd = 0;
  let racha = 0;
  let rachaG = 0;
  let rachaP = 0;
  for (const f of cerradas) {
    const neto = pnlNeto(f);
    const l = local(f.salida!.t, desfaseMin);
    acumular(dias, `${l.y}-${dos(l.m)}-${dos(l.d)}`, f);
    acumular(semanas, semanaIso(l.base), f);
    acumular(meses, `${l.y}-${dos(l.m)}`, f);
    porDiaSemana[l.dow].pnl += neto;
    porDiaSemana[l.dow].operaciones += 1;
    // La hora de la ENTRADA es la que dice cuándo decide bien el bot.
    const h = local(f.entrada.t, desfaseMin).h;
    porHora[h].pnl += neto;
    porHora[h].operaciones += 1;
    const lado = f.lado === 1 ? largos : cortos;
    lado.pnl += neto;
    lado.operaciones += 1;
    if (neto > 0) {
      ganBruta += neto;
      ganadoras += 1;
      racha = racha > 0 ? racha + 1 : 1;
    } else {
      perBruta += -neto;
      racha = racha < 0 ? racha - 1 : -1;
    }
    rachaG = Math.max(rachaG, racha);
    rachaP = Math.max(rachaP, -racha);
    comisiones += f.comisiones;
    funding += f.funding;
    const r = resultadoR(f);
    if (r !== null) {
      sumaR += r;
      nR += 1;
    }
    if (f.mfe >= 1) llegaron += 1;
    acum += neto;
    pico = Math.max(pico, acum);
    maxDd = Math.max(maxDd, pico - acum);
  }
  const n = cerradas.length;
  const listaDias = [...dias.values()].sort((a, b) => a.clave.localeCompare(b.clave));
  const perdedoras = n - ganadoras;
  return {
    dias: listaDias,
    semanas: [...semanas.values()].sort((a, b) => a.clave.localeCompare(b.clave)),
    meses: [...meses.values()].sort((a, b) => a.clave.localeCompare(b.clave)),
    metricas: {
      operaciones: n,
      pnlNeto: ganBruta - perBruta,
      gananciaBruta: ganBruta,
      perdidaBruta: perBruta,
      comisiones,
      funding,
      aciertos: n ? ganadoras / n : null,
      profitFactor: perBruta > 0 ? ganBruta / perBruta : ganBruta > 0 ? Infinity : null,
      esperanzaR: nR ? sumaR / nR : null,
      gananciaMedia: ganadoras ? ganBruta / ganadoras : null,
      perdidaMedia: perdedoras ? -perBruta / perdedoras : null,
      llegaron1R: n ? llegaron / n : null,
      maxDrawdown: maxDd,
      mejorDia: listaDias.length ? listaDias.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null,
      peorDia: listaDias.length ? listaDias.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null,
      rachaGanadora: rachaG,
      rachaPerdedora: rachaP,
      porDiaSemana,
      porHora,
      largos,
      cortos,
    },
  };
}
