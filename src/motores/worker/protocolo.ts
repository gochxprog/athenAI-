import type { EstadoGrafico } from '../nucleo/pipeline';
import type { EstadoConexion, IdTemporalidad } from '../nucleo/tipos';
import type { Proveedor, ResumenSimbolo } from '../almacen/almacen';
import type { CredencialesRithmic } from '../fuentes/rithmicPuente';

export type { Proveedor, ResumenSimbolo };

/** Configuración del Centro de datos: UNA fuente activa y los activos que aprende. */
export interface ConfigCentro {
  proveedor: Proveedor;
  simbolos: string[];
  /** Guardar las Features en la "carpeta" (base IndexedDB) de la fuente. */
  guardar: boolean;
  binance: { rest: string; ws: string };
  urus: { baseUrl: string };
  rithmic: CredencialesRithmic & { puente: string };
}

export interface EstadoFeed {
  simbolo: string;
  conexion: EstadoConexion;
  detalle: string;
  tradesPorSeg: number;
  latenciaMs: number | null;
  precio: number | null;
  /** Filas de Features generadas desde que se aplicó la configuración. */
  filas: number;
  tickSize: number;
  dollarBarUsd: number;
  calibrado: boolean;
}

export interface EntradaRegistro {
  t: number;
  texto: string;
}

/** UI → Worker */
export type MensajeAlMotor =
  | { tipo: 'aplicar'; config: ConfigCentro }
  | { tipo: 'detener' }
  | { tipo: 'ver'; simbolo: string }
  | { tipo: 'temporalidad'; id: IdTemporalidad }
  | { tipo: 'vista'; nBarras: number; footprint: boolean; nivelesFootprint: number }
  | { tipo: 'exportar-features'; id: number }
  | { tipo: 'almacen-resumen'; id: number }
  | { tipo: 'almacen-exportar'; id: number; proveedor: Proveedor; simbolo: string }
  | { tipo: 'almacen-borrar'; id: number; proveedor: Proveedor };

/** Worker → UI */
export type MensajeDelMotor =
  | { tipo: 'estado'; estado: EstadoGrafico; msProceso: number }
  | { tipo: 'feeds'; proveedor: Proveedor | null; visible: string | null; feeds: EstadoFeed[]; enCola: number }
  | { tipo: 'registro'; entrada: EntradaRegistro }
  | { tipo: 'respuesta'; id: number; ok: boolean; datos?: unknown; error?: string }
  | { tipo: 'error'; mensaje: string };
