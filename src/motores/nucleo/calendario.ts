// Calendario de eventos fuertes (FOMC, CPI, nóminas…): ventanas en las que no se debería operar.
// Las fechas de estos eventos se conocen de antemano, así que marcar una barra como "dentro de la ventana"
// no mira al futuro.

export interface EventoCalendario {
  id: string;
  nombre: string;
  /** Instante del evento (ms UTC). */
  t: number;
  impacto: 'alto' | 'medio';
  /** Minutos antes y después del evento que forman la ventana de no operar. */
  antesMin: number;
  despuesMin: number;
}

/**
 * Reuniones de la Fed que quedan en 2026 (decisión a las 14:00 hora de Nueva York).
 * Fuente: calendario publicado del FOMC; confírmalo en federalreserve.gov/monetarypolicy/fomccalendars.htm.
 */
export const EVENTOS_PREDEFINIDOS: EventoCalendario[] = [
  { id: 'fomc-2026-10-28', nombre: 'FOMC · decisión de tipos', t: Date.UTC(2026, 9, 28, 18, 0), impacto: 'alto', antesMin: 30, despuesMin: 90 },
  { id: 'fomc-2026-12-09', nombre: 'FOMC · decisión de tipos + proyecciones', t: Date.UTC(2026, 11, 9, 19, 0), impacto: 'alto', antesMin: 30, despuesMin: 90 },
];

/** Evento cuya ventana contiene `t`, si lo hay. */
export function eventoEnVentana(eventos: readonly EventoCalendario[], t: number): EventoCalendario | null {
  for (const e of eventos) if (t >= e.t - e.antesMin * 60_000 && t <= e.t + e.despuesMin * 60_000) return e;
  return null;
}

/** Próximo evento (o el que está en curso) a partir de `t`. */
export function proximoEvento(eventos: readonly EventoCalendario[], t: number): EventoCalendario | null {
  let mejor: EventoCalendario | null = null;
  for (const e of eventos) if (e.t + e.despuesMin * 60_000 >= t && (!mejor || e.t < mejor.t)) mejor = e;
  return mejor;
}
