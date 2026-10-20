import type { EstadoGrafico, ResumenFlujo } from '../nucleo/pipeline';
import type { EstadoConexion, IdTemporalidad } from '../nucleo/tipos';
import type { Proveedor, ResumenSimbolo } from '../almacen/almacen';
import type { CredencialesRithmic } from '../fuentes/rithmicPuente';
import type { ResultadoRegimen } from '../memoria/regimen';
import type { EventoCalendario } from '../nucleo/calendario';

export type { EventoCalendario };
import type { ResultadoMemoria } from '../memoria/gemelos';
import type { CruceMercados } from '../memoria/cruce';

export type { CruceMercados };

/** Memoria del mercado de un activo (Bloque B): régimen, "hoy es distinto" y día gemelo. */
export interface MemoriaFeed {
  calculadoEn: number;
  /** Filas usadas (de la carpeta de la fuente, o de memoria si no se guarda). */
  filas: number;
  regimen: ResultadoRegimen | null;
  memoria: ResultadoMemoria | null;
  /** Qué falta para que cada parte funcione (null si todo está listo). */
  faltan: string | null;
  error?: string;
}

export type { Proveedor, ResumenSimbolo };

/** Configuración del Centro de datos: activos que aprende, cada uno con su fuente. */
export interface ActivoConfig {
  simbolo: string;
  proveedor: Proveedor;
}

export interface ConfigCentro {
  /** Activos que aprende, cada uno con su fuente (se pueden mezclar: BTC de Binance + NQ de Rithmic). */
  activos: ActivoConfig[];
  /** Guardar las Features en la "carpeta" (base IndexedDB) de la fuente. */
  guardar: boolean;
  binance: { rest: string; ws: string };
  urus: { baseUrl: string };
  rithmic: CredencialesRithmic & { puente: string };
}

export interface EstadoFeed {
  simbolo: string;
  proveedor: Proveedor;
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
  /** Las Features de este activo se están guardando en su carpeta. */
  guardando: boolean;
  /** Cortes de conexión desde que se aplicó la configuración. */
  cortes: number;
  /** Precio muestreado cada segundo (últimos 5 min). */
  historial: number[];
  /** Dollar bars por minuto, ventanas de 10 s (últimos 5 min). */
  ritmo: number[];
  /** Cambio del CVD en el último minuto. */
  cvdVelocidad: number | null;
  resumen: ResumenFlujo;
  memoria: MemoriaFeed | null;
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
  | { tipo: 'vista'; nBarras: number; footprint: boolean; nivelesFootprint: number; heatmap: boolean }
  | { tipo: 'exportar-features'; id: number }
  | { tipo: 'memoria-recalcular' }
  | { tipo: 'calendario'; eventos: EventoCalendario[] }
  | { tipo: 'almacen-resumen'; id: number }
  | { tipo: 'almacen-exportar'; id: number; proveedor: Proveedor; simbolo: string }
  | { tipo: 'almacen-borrar'; id: number; proveedor: Proveedor };

/** Worker → UI */
export type MensajeDelMotor =
  | { tipo: 'estado'; estado: EstadoGrafico; msProceso: number }
  | { tipo: 'feeds'; proveedores: Proveedor[]; visible: string | null; feeds: EstadoFeed[]; enCola: number; cruces: CruceMercados[] }
  | { tipo: 'registro'; entrada: EntradaRegistro }
  | { tipo: 'respuesta'; id: number; ok: boolean; datos?: unknown; error?: string }
  | { tipo: 'error'; mensaje: string };
