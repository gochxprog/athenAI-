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
  /** GESTION de cada combo si la estrategia probó varias (la del bot es la de juez.comboVivo). */
  gestiones?: ReglasSalida[];
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

/** Una prueba guardada en la Biblioteca (resumen; el resultado completo va aparte). */
export interface EntradaBiblioteca {
  id: string;
  t: number;
  nombre: string;
  simbolo: string;
  serie: Serie;
  fuente: Fuente;
  codigo: string;
  combo: Combo;
  gestion: ReglasSalida | null;
  veredicto: string;
  resumen: string;
  score: number | null;
  /** Variantes que el Juez contó en esta prueba. */
  ensayos: number;
  velas: { total: number; desde: number; hasta: number };
  oos: { sharpe: number | null; retorno: number; caida: number; operaciones: number; aciertos: number | null };
  /** Bot de Paper creado desde esta prueba. */
  botId?: string;
  /** El resultado completo sigue guardado (las pruebas viejas lo pierden). */
  conResultado: boolean;
}
