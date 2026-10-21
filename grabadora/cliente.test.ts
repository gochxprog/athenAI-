import 'fake-indexeddb/auto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { AlmacenDisco } from './almacenDisco';
import { crearServidor } from './servidor';
import { ClienteGrabadora } from '../src/motores/grabadora/cliente';
import { AlmacenFeatures } from '../src/motores/almacen/almacen';
import { parametrosPorDefecto } from '../src/motores/nucleo/parametros';

const DIA = Date.UTC(2026, 9, 21);
const fila = (n: number) => ({ n, inicio: DIA + n * 1_000 - 500, cierre: DIA + n * 1_000, close: 100 + n, valores: { delta_ratio: 0.1, hueco: 0 } });

describe('Sincronización plataforma ← grabadora del VPS', () => {
  it('descarga todo, luego solo lo nuevo, con sus sesiones, a la carpeta athenai-grabadora', async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
    const disco = new AlmacenDisco(d);
    disco.nuevaSesion('BTCUSDT', parametrosPorDefecto(), DIA, 42);
    disco.guardar('BTCUSDT', 42, Array.from({ length: 12 }, (_, i) => fila(i + 1)));
    disco.vaciar();
    const srv = crearServidor({ almacen: disco, clave: 'k', estado: () => ({ inicio: 1, version: 't', simbolos: [] }) });
    await new Promise<void>((ok) => srv.listen(0, ok));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
    const memoria = new Map<string, string>();
    const local = { getItem: (k: string) => memoria.get(k) ?? null, setItem: (k: string, v: string) => void memoria.set(k, v), removeItem: (k: string) => void memoria.delete(k) };
    try {
      const c = new ClienteGrabadora(undefined, local);
      await expect(c.probar({ url, clave: 'mala' })).rejects.toThrow('Clave incorrecta');
      c.guardarConfig({ url, clave: 'k' });
      expect(await c.sincronizar()).toEqual({ BTCUSDT: 12 });
      // Lo nuevo: solo 3 filas más.
      disco.guardar('BTCUSDT', 42, [fila(13), fila(14), fila(15)]);
      disco.vaciar();
      expect(await c.sincronizar()).toEqual({ BTCUSDT: 3 });
      expect(await c.sincronizar()).toEqual({ BTCUSDT: 0 });
      const al = new AlmacenFeatures('grabadora');
      const resumen = await al.resumen();
      expect(resumen).toEqual([{ simbolo: 'BTCUSDT', filas: 15, desde: DIA + 1_000, hasta: DIA + 15_000, sesiones: 1 }]);
      expect((await al.leer('BTCUSDT')).every((f) => f.sesion === 42)).toBe(true);
      al.cerrar();
      // La configuración se recuerda.
      expect(new ClienteGrabadora(undefined, local).estado.config).toEqual({ url: url.replace(/\/$/, ''), clave: 'k' });
      // Abierta desde la propia grabadora y sin conexión guardada: la detecta (para pedir la clave una vez).
      const nuevo = new ClienteGrabadora(undefined, { getItem: () => null, setItem: () => {}, removeItem: () => {} });
      expect(await nuevo.detectarMismoOrigen(url.replace(/\/$/, ''))).toBe(true);
      expect(nuevo.estado.detectada).toBe(url.replace(/\/$/, ''));
      // Otra dirección que no es una grabadora: nada.
      const otro = new ClienteGrabadora(async () => new Response('no', { status: 404 }), { getItem: () => null, setItem: () => {}, removeItem: () => {} });
      expect(await otro.detectarMismoOrigen('http://127.0.0.1:9')).toBe(false);
      // Con conexión ya guardada no vuelve a pedir nada.
      expect(await new ClienteGrabadora(undefined, local).detectarMismoOrigen(url)).toBe(false);
    } finally {
      srv.close();
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
