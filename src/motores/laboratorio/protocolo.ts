import type { Costos } from '../juez/backtest';
import type { Combo, ResultadoJuez } from '../juez/juez';
import type { Proveedor } from '../almacen/almacen';

export interface PeticionLaboratorio {
  id: number;
  codigo: string;
  proveedor: Proveedor;
  simbolo: string;
  /** Otro mercado para la prueba de robustez (BTC frente a XAU, por ejemplo). */
  otro: { proveedor: Proveedor; simbolo: string } | null;
  costos: Costos;
  /** Variantes ya probadas antes con esta idea (para el Deflated Sharpe). */
  ensayosPrevios: number;
}

export interface RespuestaLaboratorio {
  resultado: ResultadoJuez;
  combos: Combo[];
  filas: number;
  desde: number;
  hasta: number;
  /** Cierre (ms) de la primera barra fuera de muestra. */
  inicioOosT: number;
  segundos: number;
}

export type MensajeLaboratorio =
  | { tipo: 'progreso'; id: number; texto: string }
  | { tipo: 'resultado'; id: number; respuesta: RespuestaLaboratorio }
  | { tipo: 'error'; id: number; mensaje: string };
