// Tipos de una prueba del Laboratorio (los comparten la grabadora, que la corre, y la plataforma, que la muestra).
import type { Combo, ResultadoJuez } from '../juez/juez';
import type { ReglasSalida } from '../juez/salidas';
import type { Serie } from './velas';

export const FUENTES = ['todo', 'historia', 'grabado'] as const;
export type Fuente = (typeof FUENTES)[number];

export interface PedidoPrueba { codigo: string; simbolo: string; serie: Serie; fuente: Fuente; nombre?: string }
export interface ResultadoPrueba {
  juez: ResultadoJuez;
  combos: Combo[];
  gestion: ReglasSalida | null;
  velas: { total: number; desde: number; hasta: number; serie: Serie; fuente: Fuente };
  /** Hora de cierre de cada vela (para poner fechas a los tramos y operaciones). */
  tiempos: number[];
}
export interface Trabajo {
  id: string;
  estado: 'corriendo' | 'listo' | 'error';
  pasos: string[];
  inicio: number;
  fin: number | null;
  pedido: Omit<PedidoPrueba, 'codigo'>;
  resultado: ResultadoPrueba | null;
  error: string | null;
}
