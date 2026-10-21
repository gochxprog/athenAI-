// Conexión con la grabadora 24/7 del VPS: descarga lo grabado a la carpeta «athenai-grabadora» de este navegador.
// Así el Juez, el Etiquetador y la Memoria tienen historia continua aunque el computador haya estado apagado.
// La sincronización es incremental: solo pide las filas con cierre posterior a la última guardada aquí.
import { AlmacenFeatures, type FilaGuardada, type SesionGuardada } from '../almacen/almacen';
import type { ParametrosSimbolo } from '../nucleo/parametros';

export interface ConfigGrabadora {
  url: string;
  clave: string;
  /** Plataforma servida por la propia grabadora con sesión abierta (/entrar): pide con la cookie, sin clave. */
  sesion?: boolean;
}

export interface EstadoRemoto {
  inicio: number;
  version: string;
  simbolos: { simbolo: string; conexion: string; detalle: string; filasSesion: number; ultimoCierre: number | null; cortes: number; tradesPerdidos: number }[];
  almacen: { simbolo: string; filas: number; desde: number | null; hasta: number | null; bytes: number }[];
}

export interface EstadoSincronizacion {
  config: ConfigGrabadora | null;
  enCurso: boolean;
  ultima: number | null;
  /** Filas nuevas descargadas en la última sincronización, por símbolo. */
  nuevas: Record<string, number>;
  remoto: EstadoRemoto | null;
  error: string | null;
  /** La plataforma se abrió desde la propia grabadora (misma dirección) y aún no tiene la clave: se pide una vez. */
  detectada: string | null;
}

const CLAVE = 'athenai.grabadora';
export const CADA_MS = 5 * 60_000;
const PAGINA = 5_000;

const limpiarUrl = (u: string) => u.trim().replace(/\/+$/, '');

export class ClienteGrabadora {
  estado: EstadoSincronizacion = { config: null, enCurso: false, ultima: null, nuevas: {}, remoto: null, error: null, detectada: null };
  private oyentes = new Set<() => void>();

  constructor(
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly local: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
    private readonly crearAlmacen: () => AlmacenFeatures = () => new AlmacenFeatures('grabadora'),
  ) {
    try {
      const x = JSON.parse(this.local?.getItem(CLAVE) ?? 'null') as ConfigGrabadora | null;
      if (x?.url && x.clave) this.estado.config = x;
    } catch {
      // Sin configuración guardada.
    }
  }

  suscribir(o: () => void): () => void {
    this.oyentes.add(o);
    return () => this.oyentes.delete(o);
  }

  private cambiar(x: Partial<EstadoSincronizacion>): void {
    this.estado = { ...this.estado, ...x };
    for (const o of this.oyentes) o();
  }

  private async pedir<T>(c: ConfigGrabadora, ruta: string): Promise<T> {
    let r: Response;
    try {
      r = await this.fetchImpl(`${limpiarUrl(c.url)}${ruta}`, c.sesion ? { credentials: 'same-origin' } : { headers: { Authorization: `Bearer ${c.clave.trim()}` } });
    } catch {
      throw new Error(`No se pudo conectar con ${limpiarUrl(c.url)}. Revisa la dirección, que la grabadora esté encendida y que el puerto esté abierto.`);
    }
    if (r.status === 401) throw new Error('Clave incorrecta.');
    if (!r.ok) throw new Error(`La grabadora respondió HTTP ${r.status}.`);
    return (await r.json()) as T;
  }

  /** Comprueba la conexión y la clave (no guarda nada). */
  probar(c: ConfigGrabadora): Promise<EstadoRemoto> {
    return this.pedir<EstadoRemoto>(c, '/api/estado');
  }

  guardarConfig(c: ConfigGrabadora | null): void {
    try {
      if (c) this.local?.setItem(CLAVE, JSON.stringify({ url: limpiarUrl(c.url), clave: c.clave.trim() }));
      else this.local?.removeItem(CLAVE);
    } catch {
      // Almacenamiento bloqueado: vale para esta sesión.
    }
    this.cambiar({ config: c ? { url: limpiarUrl(c.url), clave: c.clave.trim() } : null, remoto: null, error: null, detectada: c ? null : this.estado.detectada });
  }

  /**
   * Si la plataforma la sirve la propia grabadora (se abrió con la IP del VPS) y no hay conexión guardada,
   * lo anota para pedir la clave una sola vez. La clave nunca viaja sola: la escribe el dueño.
   */
  async detectarMismoOrigen(origen: string | null = typeof location === 'undefined' ? null : location.origin): Promise<boolean> {
    if (!origen || !/^https?:/.test(origen)) return false;
    try {
      const r = await this.fetchImpl(`${origen}/api/salud`, { credentials: 'same-origin' });
      const j = r.ok ? ((await r.json()) as { grabadora?: string; sesion?: boolean }) : null;
      if (j?.grabadora !== 'athenAI') return false;
      // Ya entraste con tu contraseña (/entrar): se conecta sola con la sesión, sin escribir la clave otra vez.
      if (j.sesion) {
        this.cambiar({ config: { url: limpiarUrl(origen), clave: '', sesion: true }, detectada: null, error: null });
        return true;
      }
      if (this.estado.config) return false;
      this.cambiar({ detectada: limpiarUrl(origen) });
      return true;
    } catch {
      return false;
    }
  }

  /** Descarga lo nuevo de cada símbolo. Devuelve las filas nuevas por símbolo. */
  async sincronizar(): Promise<Record<string, number>> {
    const c = this.estado.config;
    if (!c || this.estado.enCurso) return {};
    this.cambiar({ enCurso: true, error: null });
    const nuevas: Record<string, number> = {};
    const al = this.crearAlmacen();
    try {
      const remoto = await this.probar(c);
      this.cambiar({ remoto });
      for (const { simbolo } of remoto.almacen) {
        const { sesiones } = await this.pedir<{ sesiones: { id: number; simbolo: string; inicio: number; parametros: ParametrosSimbolo }[] }>(c, `/api/sesiones?simbolo=${simbolo}`);
        for (const s of sesiones) await al.registrarSesion(s satisfies Required<SesionGuardada>);
        const ultima = (await al.leerUltimas(simbolo, 1))[0];
        let desde = ultima?.cierre ?? 0;
        nuevas[simbolo] = 0;
        for (;;) {
          const r = await this.pedir<{ filas: FilaGuardada[]; mas: boolean }>(c, `/api/filas?simbolo=${simbolo}&desde=${desde}&limite=${PAGINA}`);
          const porSesion = new Map<number, FilaGuardada[]>();
          for (const f of r.filas) porSesion.set(f.sesion, [...(porSesion.get(f.sesion) ?? []), f]);
          for (const [sesion, filas] of porSesion) al.guardar(simbolo, sesion, filas);
          await al.vaciar();
          nuevas[simbolo] += r.filas.length;
          if (!r.mas || !r.filas.length) break;
          desde = r.filas[r.filas.length - 1].cierre;
        }
      }
      this.cambiar({ ultima: Date.now(), nuevas });
      return nuevas;
    } catch (e) {
      this.cambiar({ error: e instanceof Error ? e.message : String(e) });
      return nuevas;
    } finally {
      al.cerrar();
      this.cambiar({ enCurso: false });
    }
  }
}

export const grabadora = new ClienteGrabadora();

let iniciado = false;

/** Sincroniza al abrir la app y cada 5 minutos (si hay una grabadora configurada). */
export function iniciarGrabadora(): void {
  if (iniciado) return;
  iniciado = true;
  void grabadora.detectarMismoOrigen().then(() => grabadora.sincronizar());
  setInterval(() => void grabadora.sincronizar(), CADA_MS);
}
