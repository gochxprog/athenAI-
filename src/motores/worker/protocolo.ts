import type { EstadoGrafico } from '../nucleo/pipeline';
import type { IdTemporalidad } from '../nucleo/tipos';

export type ConfigFuente = { tipo: 'demo'; semilla?: number } | { tipo: 'urus'; baseUrl: string; simbolo: string };

/** UI → Worker */
export type MensajeAlMotor =
  | { tipo: 'iniciar'; fuente: ConfigFuente }
  | { tipo: 'detener' }
  | { tipo: 'temporalidad'; id: IdTemporalidad }
  | { tipo: 'vista'; nBarras: number; footprint: boolean; nivelesFootprint: number }
  | { tipo: 'exportar-features' };

/** Worker → UI */
export type MensajeDelMotor =
  | { tipo: 'estado'; estado: EstadoGrafico; msProceso: number }
  | { tipo: 'features-csv'; csv: string; filas: number }
  | { tipo: 'error'; mensaje: string };
