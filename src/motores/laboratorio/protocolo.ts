import type { Costos } from '../juez/backtest';
import type { Combo, ResultadoJuez } from '../juez/juez';
import type { Proveedor } from '../almacen/almacen';

export interface PeticionLaboratorio {
  tipo?: 'juzgar';
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
  /** Si la variante elegida abre largos y/o cortos (para describir la lógica). */
  lados: { largos: number; cortos: number };
  /** Costos usados en el backtest. */
  costos: Costos;
  /** Se descontó el funding (hay tasas grabadas en estos datos). */
  fundingIncluido: boolean;
  /** Operaciones fuera de muestra con sus horas reales (motor Backtest). */
  operaciones: OperacionConHora[];
}

export interface OperacionConHora {
  /** Cierre (ms) de la barra en que se decidió entrar y salir. */
  entradaT: number;
  salidaT: number;
  lado: 1 | -1;
  retorno: number;
  barras: number;
}

export type MensajeLaboratorio =
  | { tipo: 'progreso'; id: number; texto: string }
  | { tipo: 'resultado'; id: number; respuesta: RespuestaLaboratorio }
  | { tipo: 'error'; id: number; mensaje: string };

/** Estrategia juzgada cuya señal actual se quiere conocer (con la variante que eligió el Juez). */
export interface EstrategiaEnVivo {
  id: string;
  codigo: string;
  combo: Combo;
  proveedor: Proveedor;
  simbolo: string;
}

export interface PeticionSenales {
  tipo: 'senales';
  id: number;
  estrategias: EstrategiaEnVivo[];
}

export interface SenalEstrategia {
  id: string;
  /** Posición en la última barra guardada (1 largo, −1 corto, 0 fuera); null si no se pudo calcular. */
  posicion: number | null;
  /** Cierre de esa barra (ms). */
  t: number | null;
  error?: string;
}

export type MensajeSenales = { tipo: 'senales'; id: number; senales: SenalEstrategia[] };
