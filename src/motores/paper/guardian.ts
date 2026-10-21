// Motor Guardián: vigila el riesgo de cada bot de Paper y lo frena cuando hace falta.
//
// Reglas (en este orden):
//   1. Sin datos: si el mercado no está «en vivo», el bot no opera. Si tenía posición, se cierra al volver
//      (como en el Juez: nunca se mantiene una posición a través de un corte).
//   2. Caída del día: dd = 1 − equity / pico del día (UTC). Si dd ≥ máximo → cierra y pausa hasta el día siguiente.
//   3. Pérdidas seguidas ≥ máximo → cuarentena (solo tú la levantas).
//   4. Banda del Juez: con k ≥ 5 operaciones, si Π(1 + retorno por unidad) − 1 < P5 de la banda del Monte Carlo
//      tras k operaciones → fuera de banda: aviso rojo y pausa (el bot no se comporta como dijo el Juez).
//   5. Exposición máxima según la nota del Juez: APROBADA → 1× el capital; APROBADA CON RESERVA → 0,5×;
//      cualquier otro veredicto no puede tener bot.
import { bandaTrasOperaciones } from '../juez/monteCarlo';
import { crearAleatorio } from '@/lib/random';
import type { Bot, MercadoVivo } from './ejecutor';

export interface ReglasGuardian {
  /** Caída máxima del día (fracción). */
  ddDiarioMax: number;
  perdidasSeguidasMax: number;
  /** Operaciones mínimas antes de juzgar la banda. */
  minOperacionesBanda: number;
}

export const REGLAS_POR_DEFECTO: ReglasGuardian = { ddDiarioMax: 0.05, perdidasSeguidasMax: 5, minOperacionesBanda: 5 };

export const EXPOSICION_MAXIMA: Record<string, number> = { APROBADA: 1, 'APROBADA CON RESERVA': 0.5 };

export function exposicionMaxima(veredicto: string | undefined): number {
  return (veredicto && EXPOSICION_MAXIMA[veredicto]) || 0;
}

export const fechaUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Actualiza el pico del día (se reinicia al cambiar el día UTC) y devuelve la caída desde ese pico. */
export function caidaDelDia(bot: Bot, e: number, t: number): number {
  const f = fechaUtc(t);
  if (bot.dia.fecha !== f) bot.dia = { fecha: f, pico: e };
  else if (e > bot.dia.pico) bot.dia.pico = e;
  return bot.dia.pico > 0 ? Math.max(0, 1 - e / bot.dia.pico) : 0;
}

export type AccionGuardian =
  | { tipo: 'sin-datos'; texto: string }
  | { tipo: 'datos-vuelven'; texto: string }
  | { tipo: 'caida-dia'; texto: string }
  | { tipo: 'nuevo-dia'; texto: string };

/** Revisión continua (cada segundo): conexión, caída del día y cambio de día. */
export function revisar(bot: Bot, m: MercadoVivo | null, e: number, reglas: ReglasGuardian): AccionGuardian | null {
  const vivo = !!m && m.enVivo && (m.bid !== null || m.precio !== null);
  if (!vivo) {
    if (bot.estado === 'activo') return { tipo: 'sin-datos', texto: `${bot.simbolo} sin datos en vivo: el bot no opera${bot.posicion ? ' y cerrará su posición al volver' : ''}.` };
    return null;
  }
  if (bot.estado === 'sin-datos') return { tipo: 'datos-vuelven', texto: `${bot.simbolo} vuelve a estar en vivo.` };
  const dd = caidaDelDia(bot, e, m.t);
  if (bot.estado === 'pausado-dia' && bot.pausadoDia !== fechaUtc(m.t)) return { tipo: 'nuevo-dia', texto: 'Nuevo día: el bot vuelve a operar.' };
  if (bot.estado === 'activo' && dd >= reglas.ddDiarioMax) return { tipo: 'caida-dia', texto: `Caída del día ${(dd * 100).toFixed(2)} % ≥ ${(reglas.ddDiarioMax * 100).toFixed(1)} %: cierra y pausa hasta mañana.` };
  return null;
}

export type AccionOperacion = { tipo: 'cuarentena' | 'fuera-de-banda'; texto: string };

/** Banda P5–P50–P95 del Juez tras k operaciones (determinista: misma k, misma banda). */
export function bandaJuez(bot: Bot, k: number): { p5: number; p50: number; p95: number } | null {
  return bandaTrasOperaciones(bot.retornosJuez, k, crearAleatorio(1_000 + k));
}

/** Revisión tras cada operación cerrada: pérdidas seguidas y banda del Juez. */
export function revisarOperacion(bot: Bot, reglas: ReglasGuardian): AccionOperacion | null {
  if (bot.perdidasSeguidas >= reglas.perdidasSeguidasMax) return { tipo: 'cuarentena', texto: `${bot.perdidasSeguidas} pérdidas seguidas: cuarentena hasta que lo revises.` };
  if (bot.operaciones >= reglas.minOperacionesBanda) {
    const b = bandaJuez(bot, bot.operaciones);
    if (b && bot.retornoUnidadAcum < b.p5)
      return { tipo: 'fuera-de-banda', texto: `Tras ${bot.operaciones} operaciones va ${(bot.retornoUnidadAcum * 100).toFixed(2)} %, por debajo del P5 del Juez (${(b.p5 * 100).toFixed(2)} %): no se comporta como se esperaba. Pausado.` };
  }
  return null;
}
