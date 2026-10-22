import type { Costos } from '../juez/backtest';
import type { Combo, ResultadoJuez } from '../juez/juez';
import type { Proveedor } from '../almacen/almacen';
import type { ConfigWfo } from '../juez/walkForward';
import type { ConfigMc } from '../juez/monteCarlo';
import type { ConfigLuck } from '../juez/luckTest';
import type { ConfigEtiquetador, ResultadoEtiquetador } from '../etiquetador/etiquetador';

export interface PeticionLaboratorio {
  tipo?: 'juzgar';
  id: number;
  codigo: string;
  proveedor: Proveedor;
  simbolo: string;
  costos: Costos;
  /** Variantes ya probadas antes con esta idea (para el Deflated Sharpe). */
  ensayosPrevios: number;
  /** Walk-Forward: objetivo y tamaños de ventana (ausente = automático). */
  wfo?: ConfigWfo;
  /** Monte Carlo: simulaciones, método, umbral de ruina y capital (ausente = por defecto). */
  monteCarlo?: ConfigMc;
  /** Luck test: método, métrica y permutaciones (ausente = por defecto). */
  luck?: ConfigLuck;
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
  /** Horas de cada ventana del Walk-Forward. */
  ventanasT: { isDesdeT: number; isHastaT: number; oosDesdeT: number; oosHastaT: number }[];
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

/** Etiquetador: triple barrera + CUSUM + meta-etiquetado sobre las filas grabadas de un mercado. */
export interface PeticionEtiquetar {
  tipo: 'etiquetar';
  id: number;
  proveedor: Proveedor;
  simbolo: string;
  config: ConfigEtiquetador;
}

export type MensajeEtiquetas = { tipo: 'etiquetas'; id: number; resultado: ResultadoEtiquetador | null; csv: string; error?: string };

/** Horas de las ventanas del Walk-Forward y de las operaciones, a partir del cierre (ms) de cada barra juzgada. */
export function horasJuez(resultado: ResultadoJuez, cierres: readonly number[]): Pick<RespuestaLaboratorio, 'ventanasT' | 'operaciones'> {
  const hora = (i: number) => cierres[Math.max(0, Math.min(cierres.length - 1, i))];
  return {
    ventanasT: resultado.tramos.map((t) => ({ isDesdeT: hora(t.isDesde), isHastaT: hora(t.isHasta - 1), oosDesdeT: hora(t.oosDesde), oosHastaT: hora(t.oosHasta - 1) })),
    operaciones: resultado.operacionesOos.map((o) => ({ entradaT: hora(o.entrada), salidaT: hora(o.salida), lado: o.lado, retorno: o.retorno, barras: o.barras })),
  };
}
