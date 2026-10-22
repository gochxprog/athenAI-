// Sala de agentes: tipos y cuentas puras que comparten el orquestador del VPS (grabadora/agentesVps.ts) y la
// pantalla Agentes de la v2. Regla: ningún agente aparece trabajando sin un motor real detrás.
import { AGENTES, type AgenteId } from '../../data/agentes';

export type EstadoAgente = 'trabajando' | 'esperando' | 'alerta' | 'pausado' | 'dormido';
/** Cuánto se enciende un agente: 2 trabajando (o en alerta), 1 encendido y listo (su motor corre, espera su turno),
 *  0 apagado (pausado o su motor aún no existe). */
export type Nivel = 0 | 1 | 2;
export const nivelAgente = (e: EstadoAgente): Nivel => (e === 'trabajando' || e === 'alerta' ? 2 : e === 'esperando' ? 1 : 0);
export interface Nota { t: number; id: AgenteId; texto: string; grave?: boolean }
/** Actividad por hora: [hora (ms / 3.600.000, entera), cuántas cosas hizo]. */
export type Cubos = [number, number][];

export interface FichaAgente {
  id: AgenteId;
  estado: EstadoAgente;
  /** Qué hace ahora, en palabras. */
  ahora: string;
  siguiente: string | null;
  ultimo: Nota | null;
  /** 24 valores: lo que hizo en cada una de las últimas 24 horas (la última es la hora en curso). */
  actividad: number[];
  /** Acciones que acepta (solo los agentes con trabajos propios): pausar, reanudar, correr. */
  acciones: string[];
}

export interface Recursos { memTotal: number; memLibre: number; rss: number; carga: number; nucleos: number; discoLibre: number | null; discoTotal: number | null }
export interface Fila { actual: { id: AgenteId; nombre: string; desde: number } | null; espera: { id: AgenteId; nombre: string }[] }
export interface EstadoSala { t: number; desde: number; agentes: FichaAgente[]; notas: Nota[]; fila: Fila; recursos: Recursos }

export const HORA_MS = 3_600_000;
const HORAS = 24;

/** Suma `n` a la hora de `t` y olvida lo de hace más de 24 h. */
export function sumar(c: Cubos, t: number, n = 1): Cubos {
  const h = Math.floor(t / HORA_MS);
  const vivos = c.filter(([x]) => x > h - HORAS);
  const i = vivos.findIndex(([x]) => x === h);
  if (i >= 0) vivos[i] = [h, vivos[i][1] + n];
  else vivos.push([h, n]);
  return vivos;
}

/** Las 24 horas hasta `t` (la última es la hora en curso), con 0 donde no hubo nada. */
export function ultimas24(c: Cubos, t: number): number[] {
  const h = Math.floor(t / HORA_MS);
  const m = new Map(c);
  return Array.from({ length: HORAS }, (_, i) => m.get(h - HORAS + 1 + i) ?? 0);
}

/** La frase de arriba de la sala: cuántos trabajan y qué pasa con el trabajo pesado. */
export function frase(s: Pick<EstadoSala, 'agentes' | 'fila'>): string {
  const n = s.agentes.filter((a) => a.estado === 'trabajando').length;
  const alerta = s.agentes.find((a) => a.estado === 'alerta');
  const nombre = (id: AgenteId) => AGENTES.find((a) => a.id === id)?.nombre ?? id;
  const quien = n === 0 ? 'Nadie está trabajando ahora.' : n === 1 ? 'Un agente trabajando.' : `${n} agentes trabajando.`;
  const fila = s.fila.actual ? `${nombre(s.fila.actual.id)}: ${s.fila.actual.nombre.toLowerCase()}.` : 'La fila pesada está libre.';
  return alerta ? `${quien} ${nombre(alerta.id)} levantó una alerta.` : `${quien} ${fila}`;
}
