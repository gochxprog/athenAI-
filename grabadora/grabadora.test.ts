import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AlmacenDisco, leerLineas } from './almacenDisco';
import { crearServidor, LIMITE_FILAS } from './servidor';
import { leerOCrearClave } from './grabadora';
import { parametrosPorDefecto } from '../src/motores/nucleo/parametros';
import type { FilaFeatures } from '../src/motores/nucleo/features';

const carpetas: string[] = [];
const temporal = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'grabadora-'));
  carpetas.push(d);
  return d;
};
afterEach(() => {
  for (const d of carpetas.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const DIA = Date.UTC(2026, 9, 21);
const fila = (n: number, cierre: number): FilaFeatures => ({ n, inicio: cierre - 1_000, cierre, close: 100 + n, valores: { delta_ratio: 0.1 * n, hueco: 0 } });

describe('Almacén en disco de la grabadora', () => {
  it('guarda por símbolo y día UTC, lee en orden desde un cierre y resume', () => {
    const a = new AlmacenDisco(temporal());
    a.nuevaSesion('BTCUSDT', parametrosPorDefecto(), DIA, 7);
    a.guardar('BTCUSDT', 7, [fila(1, DIA + 1_000), fila(2, DIA + 2_000)]);
    a.guardar('BTCUSDT', 7, [fila(3, DIA + 86_400_000 + 500)]); // día siguiente
    expect(a.vaciar()).toBe(3);
    expect(a.dias('BTCUSDT')).toEqual(['2026-10-21', '2026-10-22']);
    expect(a.leer('BTCUSDT', 0, 10).filas.map((f) => f.n)).toEqual([1, 2, 3]);
    expect(a.leer('BTCUSDT', DIA + 1_000, 10).filas.map((f) => f.n)).toEqual([2, 3]);
    const pagina = a.leer('BTCUSDT', 0, 2);
    expect(pagina.filas).toHaveLength(2);
    expect(pagina.mas).toBe(true);
    expect(a.leer('BTCUSDT', 0, 10).filas[0].sesion).toBe(7);
    expect(a.resumen()).toEqual([{ simbolo: 'BTCUSDT', filas: 3, desde: DIA + 1_000, hasta: DIA + 86_400_500, bytes: expect.any(Number) }]);
    // Al escribir más, el resumen se actualiza sin releer el disco.
    a.guardar('BTCUSDT', 7, [fila(4, DIA + 86_400_000 + 900)]);
    a.vaciar();
    expect(a.resumen()[0].filas).toBe(4);
    expect(a.sesiones('BTCUSDT').map((s) => s.id)).toEqual([7]);
  });

  it('una línea cortada por un apagón se ignora al leer', () => {
    const d = temporal();
    const f = path.join(d, 'x.jsonl');
    fs.writeFileSync(f, '{"cierre":1}\n{"cierre":2}\n{"cier');
    expect(leerLineas<{ cierre: number }>(f).map((x) => x.cierre)).toEqual([1, 2]);
  });

  it('no deja leer fuera de su carpeta con un símbolo raro', () => {
    const a = new AlmacenDisco(temporal());
    expect(a.leer('../../etc', 0, 10).filas).toEqual([]);
  });

  it('la clave se crea una vez y se reutiliza', () => {
    const d = temporal();
    const k = leerOCrearClave(d);
    expect(k.length).toBeGreaterThanOrEqual(20);
    expect(leerOCrearClave(d)).toBe(k);
  });
});

describe('API de la grabadora', () => {
  it('sin clave no da datos; con clave da estado y filas', async () => {
    const a = new AlmacenDisco(temporal());
    a.guardar('BTCUSDT', 1, [fila(1, DIA + 1_000), fila(2, DIA + 2_000)]);
    a.vaciar();
    const srv = crearServidor({ almacen: a, clave: 'secreta', estado: () => ({ inicio: 1, version: 't', simbolos: [] }) });
    await new Promise<void>((ok) => srv.listen(0, ok));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/api/salud`)).status).toBe(200);
      expect((await fetch(`${base}/api/estado`)).status).toBe(401);
      expect((await fetch(`${base}/api/estado`, { headers: { Authorization: 'Bearer otra' } })).status).toBe(401);
      const auth = { headers: { Authorization: 'Bearer secreta' } };
      const e = (await (await fetch(`${base}/api/estado`, auth)).json()) as { almacen: { filas: number }[] };
      expect(e.almacen[0].filas).toBe(2);
      const r = (await (await fetch(`${base}/api/filas?simbolo=btcusdt&desde=${DIA + 1_000}`, auth)).json()) as { filas: { n: number }[]; mas: boolean };
      expect(r.filas.map((x) => x.n)).toEqual([2]);
      expect(r.mas).toBe(false);
      const pre = await fetch(`${base}/api/filas`, { method: 'OPTIONS' });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization');
      expect(LIMITE_FILAS).toBe(5_000);
    } finally {
      srv.close();
    }
  });
});
