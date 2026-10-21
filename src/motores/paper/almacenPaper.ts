// Libro de Paper Trading en IndexedDB («carpeta» athenai-paper): los bots con su estado y todas sus operaciones.
// Funciona en el navegador y en Node con fake-indexeddb (pruebas).
import type { Bot, OperacionPaper } from './ejecutor';

const BASE = 'athenai-paper';
const VERSION = 1;

function promesa<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, mal) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

export class AlmacenPaper {
  private db: Promise<IDBDatabase> | null = null;

  private abrir(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = new Promise((ok, mal) => {
      const r = indexedDB.open(BASE, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('bots')) db.createObjectStore('bots', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('operaciones')) db.createObjectStore('operaciones', { keyPath: 'id', autoIncrement: true }).createIndex('botId', 'botId');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
    return this.db;
  }

  private async almacen(nombre: 'bots' | 'operaciones', modo: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.abrir()).transaction(nombre, modo).objectStore(nombre);
  }

  async leerBots(): Promise<Bot[]> {
    return promesa((await this.almacen('bots', 'readonly')).getAll() as IDBRequest<Bot[]>);
  }

  async guardarBot(b: Bot): Promise<void> {
    await promesa((await this.almacen('bots', 'readwrite')).put(b));
  }

  async borrarBot(id: string): Promise<void> {
    await promesa((await this.almacen('bots', 'readwrite')).delete(id));
    const ops = await this.leerOperaciones(id);
    const st = await this.almacen('operaciones', 'readwrite');
    await Promise.all(ops.map((o) => promesa(st.delete(o.id!))));
  }

  async agregarOperacion(o: OperacionPaper): Promise<number> {
    return Number(await promesa((await this.almacen('operaciones', 'readwrite')).add(o)));
  }

  /** Operaciones de un bot (o de todos), en orden de cierre. */
  async leerOperaciones(botId?: string): Promise<OperacionPaper[]> {
    const st = await this.almacen('operaciones', 'readonly');
    const xs = await promesa((botId ? st.index('botId').getAll(botId) : st.getAll()) as IDBRequest<OperacionPaper[]>);
    return xs.sort((a, b) => a.salidaT - b.salidaT || (a.id ?? 0) - (b.id ?? 0));
  }
}
