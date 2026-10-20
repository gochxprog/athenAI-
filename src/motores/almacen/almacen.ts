// Almacén de Features por fuente de datos. Cada proveedor tiene su PROPIA base IndexedDB ("carpeta"):
//   athenai-binance · athenai-rithmic · athenai-urus · athenai-simulacion
// Así los datos de una fuente nunca se mezclan con los de otra y cada una se exporta o se borra por separado.
// Funciona en el Worker del motor (IndexedDB existe en workers) y en Node con fake-indexeddb (pruebas).
import type { FilaFeatures } from '../nucleo/features';
import type { ParametrosSimbolo } from '../nucleo/parametros';

export type Proveedor = 'binance' | 'rithmic' | 'urus' | 'simulacion';

export const PROVEEDORES: Proveedor[] = ['binance', 'rithmic', 'urus', 'simulacion'];

export const nombreBase = (p: Proveedor) => `athenai-${p}`;

export interface FilaGuardada extends FilaFeatures {
  simbolo: string;
  /** Sesión de captura: cambia al reconectar o reaplicar la configuración (la numeración `n` se reinicia). */
  sesion: number;
}

export interface SesionGuardada {
  id?: number;
  simbolo: string;
  inicio: number;
  parametros: ParametrosSimbolo;
}

export interface ResumenSimbolo {
  simbolo: string;
  filas: number;
  desde: number | null;
  hasta: number | null;
  sesiones: number;
}

const VERSION = 1;

function promesa<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, mal) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

function fin(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, mal) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error ?? new Error('Transacción abortada'));
  });
}

const rango = (s: string) => IDBKeyRange.bound([s, -Infinity, -Infinity], [s, Infinity, Infinity]);

export class AlmacenFeatures {
  private db: Promise<IDBDatabase> | null = null;
  private pendientes: FilaGuardada[] = [];

  constructor(
    readonly proveedor: Proveedor,
    private readonly idb: IDBFactory = indexedDB,
  ) {}

  private abrir(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise((ok, mal) => {
      const r = this.idb.open(nombreBase(this.proveedor), VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('filas')) db.createObjectStore('filas', { keyPath: ['simbolo', 'cierre', 'n'] });
        if (!db.objectStoreNames.contains('sesiones')) db.createObjectStore('sesiones', { keyPath: 'id', autoIncrement: true }).createIndex('simbolo', 'simbolo');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
    return this.db;
  }

  async nuevaSesion(simbolo: string, parametros: ParametrosSimbolo, inicio: number): Promise<number> {
    const db = await this.abrir();
    const tx = db.transaction('sesiones', 'readwrite');
    const id = await promesa(tx.objectStore('sesiones').add({ simbolo, inicio, parametros } satisfies SesionGuardada));
    await fin(tx);
    return id as number;
  }

  /** Encola filas; se escriben en una sola transacción con `vaciar()`. */
  guardar(simbolo: string, sesion: number, filas: readonly FilaFeatures[]): void {
    for (const f of filas) this.pendientes.push({ ...f, simbolo, sesion });
  }

  get enCola(): number {
    return this.pendientes.length;
  }

  async vaciar(): Promise<number> {
    if (!this.pendientes.length) return 0;
    const lote = this.pendientes;
    this.pendientes = [];
    const db = await this.abrir();
    const tx = db.transaction('filas', 'readwrite');
    const st = tx.objectStore('filas');
    for (const f of lote) st.put(f);
    await fin(tx);
    return lote.length;
  }

  async resumen(): Promise<ResumenSimbolo[]> {
    const db = await this.abrir();
    const tx = db.transaction(['filas', 'sesiones'], 'readonly');
    const sesiones = (await promesa(tx.objectStore('sesiones').getAll())) as SesionGuardada[];
    const porSimbolo = new Map<string, number>();
    for (const s of sesiones) porSimbolo.set(s.simbolo, (porSimbolo.get(s.simbolo) ?? 0) + 1);
    const filas = tx.objectStore('filas');
    const salida: ResumenSimbolo[] = [];
    for (const [simbolo, nSes] of porSimbolo) {
      const n = await promesa(filas.count(rango(simbolo)));
      const primero = await promesa(filas.openCursor(rango(simbolo), 'next'));
      const desde = primero ? (primero.value as FilaGuardada).cierre : null;
      const ultimo = await promesa(filas.openCursor(rango(simbolo), 'prev'));
      const hasta = ultimo ? (ultimo.value as FilaGuardada).cierre : null;
      salida.push({ simbolo, filas: n, desde, hasta, sesiones: nSes });
    }
    return salida.sort((a, b) => a.simbolo.localeCompare(b.simbolo));
  }

  async leer(simbolo: string): Promise<FilaGuardada[]> {
    await this.vaciar();
    const db = await this.abrir();
    const tx = db.transaction('filas', 'readonly');
    return (await promesa(tx.objectStore('filas').getAll(rango(simbolo)))) as FilaGuardada[];
  }

  /** Últimas `n` filas de un símbolo, en orden cronológico (recorre el índice hacia atrás). */
  async leerUltimas(simbolo: string, n: number): Promise<FilaGuardada[]> {
    await this.vaciar();
    const db = await this.abrir();
    const tx = db.transaction('filas', 'readonly');
    const salida: FilaGuardada[] = [];
    await new Promise<void>((ok, mal) => {
      const c = tx.objectStore('filas').openCursor(rango(simbolo), 'prev');
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur || salida.length >= n) return ok();
        salida.push(cur.value as FilaGuardada);
        cur.continue();
      };
      c.onerror = () => mal(c.error);
    });
    return salida.reverse();
  }

  /** Borra la "carpeta" completa de este proveedor. */
  async borrar(): Promise<void> {
    this.pendientes = [];
    if (this.db) (await this.db).close();
    this.db = null;
    await new Promise<void>((ok, mal) => {
      const r = this.idb.deleteDatabase(nombreBase(this.proveedor));
      r.onsuccess = () => ok();
      r.onerror = () => mal(r.error);
      r.onblocked = () => ok();
    });
  }

  cerrar(): void {
    void this.db?.then((d) => d.close());
    this.db = null;
  }
}
