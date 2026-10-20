// Cliente único del Worker del motor. Vive mientras la app esté abierta: el motor sigue procesando y
// generando Features aunque el usuario cambie de módulo (los modelos no pierden barras).
// La configuración del Centro de datos se guarda en este navegador; la contraseña de Rithmic solo si el usuario lo pide.
import type { EstadoGrafico } from '../nucleo/pipeline';
import type { IdTemporalidad } from '../nucleo/tipos';
import { BINANCE_REST, BINANCE_WS } from '../fuentes/binance';
import type { ConfigCentro, EntradaRegistro, EstadoFeed, MensajeAlMotor, MensajeDelMotor, Proveedor, ResumenSimbolo } from './protocolo';

type Oyente = (estado: EstadoGrafico, msProceso: number) => void;

export interface EstadoFeeds {
  /** Fuentes en uso (una por cada tipo de activo asignado). */
  proveedores: Proveedor[];
  visible: string | null;
  feeds: EstadoFeed[];
  enCola: number;
}

type OyenteFeeds = (f: EstadoFeeds, registro: readonly EntradaRegistro[]) => void;

const CLAVE = 'athenai.centro-de-datos';

export const CONFIG_POR_DEFECTO: ConfigCentro = {
  activos: [{ simbolo: 'BTCUSDT', proveedor: 'binance' }],
  guardar: true,
  binance: { rest: BINANCE_REST, ws: BINANCE_WS },
  urus: { baseUrl: 'http://localhost:3000' },
  rithmic: { puente: 'http://localhost:8787', usuario: '', contrasena: '', sistema: 'Rithmic Paper Trading', gateway: 'Chicago Area' },
};

export interface ConfigGuardada {
  config: ConfigCentro;
  recordarContrasena: boolean;
}

function leerConfig(): ConfigGuardada {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as ConfigGuardada | null;
    if (x?.config) {
      // Configuraciones antiguas: una sola fuente para todos los activos.
      const viejo = x.config as unknown as { proveedor?: Proveedor; simbolos?: string[] };
      const activos = x.config.activos ?? (viejo.proveedor && viejo.simbolos ? viejo.simbolos.map((simbolo) => ({ simbolo, proveedor: viejo.proveedor! })) : CONFIG_POR_DEFECTO.activos);
      const c = { ...x.config, activos };
      delete (c as { proveedor?: unknown }).proveedor;
      delete (c as { simbolos?: unknown }).simbolos;
      return {
        recordarContrasena: !!x.recordarContrasena,
        config: { ...CONFIG_POR_DEFECTO, ...c, binance: { ...CONFIG_POR_DEFECTO.binance, ...c.binance }, urus: { ...CONFIG_POR_DEFECTO.urus, ...c.urus }, rithmic: { ...CONFIG_POR_DEFECTO.rithmic, ...c.rithmic } },
      };
    }
  } catch {
    // Sin almacenamiento local: configuración por defecto.
  }
  return { config: CONFIG_POR_DEFECTO, recordarContrasena: false };
}

function guardarConfig(g: ConfigGuardada): void {
  try {
    const copia: ConfigGuardada = { ...g, config: { ...g.config, rithmic: { ...g.config.rithmic, contrasena: g.recordarContrasena ? g.config.rithmic.contrasena : '' } } };
    localStorage.setItem(CLAVE, JSON.stringify(copia));
  } catch {
    // Almacenamiento bloqueado: la configuración vale para esta sesión.
  }
}

class MotorCliente {
  private worker: Worker | null = null;
  private oyentes = new Set<Oyente>();
  private oyentesFeeds = new Set<OyenteFeeds>();
  private ultimo: { estado: EstadoGrafico; ms: number } | null = null;
  private pendientes = new Map<number, { ok: (x: unknown) => void; mal: (e: Error) => void }>();
  private siguienteId = 1;
  feeds: EstadoFeeds = { proveedores: [], visible: null, feeds: [], enCola: 0 };
  registro: EntradaRegistro[] = [];
  guardada: ConfigGuardada = leerConfig();
  error: string | null = null;

  get config(): ConfigCentro {
    return this.guardada.config;
  }

  private asegurar(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./motor.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<MensajeDelMotor>) => {
      const m = e.data;
      switch (m.tipo) {
        case 'estado':
          this.ultimo = { estado: m.estado, ms: m.msProceso };
          for (const o of this.oyentes) o(m.estado, m.msProceso);
          break;
        case 'feeds':
          this.feeds = { proveedores: m.proveedores, visible: m.visible, feeds: m.feeds, enCola: m.enCola };
          this.avisarFeeds();
          break;
        case 'registro':
          this.registro = [m.entrada, ...this.registro].slice(0, 80);
          this.avisarFeeds();
          break;
        case 'respuesta': {
          const p = this.pendientes.get(m.id);
          this.pendientes.delete(m.id);
          if (m.ok) p?.ok(m.datos);
          else p?.mal(new Error(m.error ?? 'Error en el motor'));
          break;
        }
        case 'error':
          this.error = m.mensaje;
          this.registro = [{ t: Date.now(), texto: `Error: ${m.mensaje}` }, ...this.registro].slice(0, 80);
          this.avisarFeeds();
          break;
      }
    };
    w.onerror = (e) => {
      this.error = e.message || 'Error en el motor';
    };
    this.worker = w;
    w.postMessage({ tipo: 'aplicar', config: this.config } satisfies MensajeAlMotor);
    return w;
  }

  private avisarFeeds(): void {
    for (const o of this.oyentesFeeds) o(this.feeds, this.registro);
  }

  private enviar(m: MensajeAlMotor): void {
    this.asegurar().postMessage(m);
  }

  private pedir<T>(m: (id: number) => MensajeAlMotor): Promise<T> {
    const id = this.siguienteId++;
    return new Promise<T>((ok, mal) => {
      this.pendientes.set(id, { ok: ok as (x: unknown) => void, mal });
      this.enviar(m(id));
    });
  }

  suscribir(o: Oyente): () => void {
    this.asegurar();
    this.oyentes.add(o);
    if (this.ultimo) o(this.ultimo.estado, this.ultimo.ms);
    return () => this.oyentes.delete(o);
  }

  suscribirFeeds(o: OyenteFeeds): () => void {
    this.asegurar();
    this.oyentesFeeds.add(o);
    o(this.feeds, this.registro);
    return () => this.oyentesFeeds.delete(o);
  }

  /** Aplica la configuración: detiene la fuente actual, limpia el pipeline y empieza a aprender de los activos asignados. */
  aplicar(config: ConfigCentro, recordarContrasena: boolean): void {
    this.guardada = { config, recordarContrasena };
    guardarConfig(this.guardada);
    this.ultimo = null;
    this.enviar({ tipo: 'aplicar', config });
  }

  recalcularMemoria(): void {
    this.enviar({ tipo: 'memoria-recalcular' });
  }

  detener(): void {
    this.enviar({ tipo: 'detener' });
  }

  ver(simbolo: string): void {
    this.feeds = { ...this.feeds, visible: simbolo };
    this.enviar({ tipo: 'ver', simbolo });
  }

  temporalidad(id: IdTemporalidad): void {
    this.enviar({ tipo: 'temporalidad', id });
  }

  vista(nBarras: number, footprint: boolean, nivelesFootprint: number): void {
    this.enviar({ tipo: 'vista', nBarras, footprint, nivelesFootprint });
  }

  exportarFeatures(): Promise<{ csv: string; filas: number; simbolo: string | null; proveedor: Proveedor | undefined }> {
    return this.pedir((id) => ({ tipo: 'exportar-features', id }));
  }

  resumenAlmacen(): Promise<Record<Proveedor, ResumenSimbolo[]>> {
    return this.pedir((id) => ({ tipo: 'almacen-resumen', id }));
  }

  exportarAlmacen(proveedor: Proveedor, simbolo: string): Promise<{ csv: string; filas: number }> {
    return this.pedir((id) => ({ tipo: 'almacen-exportar', id, proveedor, simbolo }));
  }

  borrarAlmacen(proveedor: Proveedor): Promise<boolean> {
    return this.pedir((id) => ({ tipo: 'almacen-borrar', id, proveedor }));
  }
}

export const motorOrderFlow = new MotorCliente();

/** Descarga un CSV en el navegador. */
export function descargarCsv(csv: string, nombre: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
