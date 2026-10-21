import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlmacenDisco } from './almacenDisco';
import { almacenLocalDisco, cargadorPython, crearApiPaper, LibroPaperDisco, senalesDisco } from './botsVps';
import { crearServidor } from './servidor';
import { MotorPaper } from '../src/motores/paper/motorPaper';
import type { EstadoFeed } from '../src/motores/worker/protocolo';
import type { OperacionPaper } from '../src/motores/paper/ejecutor';
import type { SenalEstrategia } from '../src/motores/laboratorio/protocolo';
import { parametrosPorDefecto } from '../src/motores/nucleo/parametros';

const T0 = Date.UTC(2026, 9, 21, 8, 0, 0);
const COSTOS = { comisionPb: 5, deslizamientoPb: 1 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'athenai-bots-'));
const NUEVO = { nombre: 'Absorción', estrategiaId: 'e1', codigo: '', combo: {}, proveedor: 'binance' as const, simbolo: 'BTCUSDT', mercadoAprobado: 'binance:BTCUSDT' as const, veredicto: 'APROBADA', score: 80, capital: 10_000, exposicion: 1, costos: COSTOS, retornosJuez: [0.01, -0.005] };
const op = (botId: string, salidaT: number): OperacionPaper => ({ botId, lado: 1, entradaT: salidaT - 1, salidaT, precioEntrada: 100, precioSalida: 101, cantidad: 1, comisiones: 0, funding: 0, pnl: 1, retorno: 0.01, retornoUnidad: 0.01, motivo: 'senal' }) as unknown as OperacionPaper;

describe('Bots en el VPS · libro en disco', () => {
  it('guarda bots y operaciones, sobrevive a un reinicio y borrar un bot borra sus operaciones', async () => {
    const dir = tmp();
    const a = new LibroPaperDisco(dir);
    await a.guardarBot({ id: 'b1', nombre: 'uno' } as never);
    await a.guardarBot({ id: 'b2', nombre: 'dos' } as never);
    expect(await a.agregarOperacion(op('b1', 3))).toBe(1);
    expect(await a.agregarOperacion(op('b2', 2))).toBe(2);
    expect(await a.agregarOperacion(op('b1', 1))).toBe(3);
    // Reinicio: otra instancia sobre la misma carpeta sigue numerando y lee lo mismo.
    const b = new LibroPaperDisco(dir);
    expect((await b.leerBots()).map((x) => x.id).sort()).toEqual(['b1', 'b2']);
    expect((await b.leerOperaciones('b1')).map((o) => o.salidaT)).toEqual([1, 3]);
    expect(await b.agregarOperacion(op('b2', 5))).toBe(4);
    await b.borrarBot('b1');
    expect((await b.leerBots()).map((x) => x.id)).toEqual(['b2']);
    expect((await b.leerOperaciones()).map((o) => o.botId)).toEqual(['b2', 'b2']);
  });

  it('«localStorage» en archivo: guarda el apagado de emergencia entre reinicios', () => {
    const f = path.join(tmp(), 'estado.json');
    const l = almacenLocalDisco(f);
    expect(l.getItem('x')).toBeNull();
    l.setItem('x', '1');
    expect(almacenLocalDisco(f).getItem('x')).toBe('1');
  });
});

describe('Bots en el VPS · señal con Python sobre las filas grabadas en disco', () => {
  let dir: string;
  beforeAll(() => {
    dir = tmp();
    const al = new AlmacenDisco(dir);
    al.nuevaSesion('BTCUSDT', parametrosPorDefecto('BTCUSDT'), T0, 1);
    // Filas grabadas: absorción alta solo en la última.
    al.guardar('BTCUSDT', 1, Array.from({ length: 30 }, (_, i) => ({ n: i, inicio: T0 + i * 60_000, cierre: T0 + i * 60_000 + 59_999, close: 100 + i, valores: { absorcion_bid: i === 29 ? 90 : 10 } })));
    al.vaciar();
  });

  it('ejecuta la estrategia con la variante del Juez y devuelve la posición de la última barra', async () => {
    const al = new AlmacenDisco(dir);
    expect(al.leerUltimas('BTCUSDT', 5).map((f) => f.n)).toEqual([25, 26, 27, 28, 29]);
    const senales = senalesDisco(al, cargadorPython(null));
    const codigo = ['PARAMETROS = {"umbral": [50, 95]}', 'def estrategia(filas, p):', '    return [1 if (f.get("absorcion_bid") or 0) > p["umbral"] else 0 for f in filas]'].join('\n');
    const [s50, s95, sinDatos] = await senales([
      { id: 'a', codigo, combo: { umbral: 50 }, proveedor: 'binance', simbolo: 'BTCUSDT' },
      { id: 'b', codigo, combo: { umbral: 95 }, proveedor: 'binance', simbolo: 'BTCUSDT' },
      { id: 'c', codigo, combo: { umbral: 50 }, proveedor: 'binance', simbolo: 'ETHUSDT' },
    ]);
    expect(s50).toEqual({ id: 'a', posicion: 1, t: T0 + 29 * 60_000 + 59_999 });
    expect(s95.posicion).toBe(0);
    expect(sinDatos.posicion).toBeNull();
    expect(sinDatos.error).toMatch(/Sin filas/);
  }, 120_000);
});

describe('Bots en el VPS · API', () => {
  let base = '';
  let srv: ReturnType<typeof crearServidor>;
  let ahora = T0;
  const cola: number[] = [];
  let motor: MotorPaper;
  beforeAll(async () => {
    const dir = tmp();
    motor = new MotorPaper({
      senales: async (xs) => xs.map((x): SenalEstrategia => ({ id: x.id, posicion: cola.shift() ?? 0, t: ahora })),
      avisar: () => {},
      reloj: () => ahora,
      almacen: new LibroPaperDisco(path.join(dir, 'paper')),
      local: almacenLocalDisco(path.join(dir, 'paper', 'estado.json')),
    });
    await motor.cargar();
    srv = crearServidor({ almacen: new AlmacenDisco(dir), clave: 'k', estado: () => ({ inicio: 1, version: 't', simbolos: [] }), paper: crearApiPaper(motor) });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => srv.close());

  const auth = { Authorization: 'Bearer k' };
  const post = (accion: string, cuerpo: unknown, h: Record<string, string> = { ...auth, 'Content-Type': 'application/json' }) => fetch(`${base}/api/paper/${accion}`, { method: 'POST', headers: h, body: JSON.stringify(cuerpo) });
  let filas = 0;
  const paso = async (bid: number, senal?: number) => {
    ahora += 1_000;
    if (senal !== undefined) {
      filas += 1;
      cola.push(senal);
    }
    await motor.alFeeds([{ simbolo: 'BTCUSDT', proveedor: 'binance', conexion: 'en-vivo', precio: bid + 0.1, filas, guardando: true, resumen: { bid, ask: bid + 0.2, precio: bid + 0.1, atr: null, libro10: null, fundingTasa: null } } as unknown as EstadoFeed]);
    await motor.esperarSenales();
  };

  it('sin clave no deja ver ni tocar los bots; las acciones solo aceptan JSON', async () => {
    expect((await fetch(`${base}/api/paper`)).status).toBe(401);
    expect((await post('crear', NUEVO, { 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await post('crear', NUEVO, { ...auth, 'Content-Type': 'text/plain' })).status).toBe(415);
  });

  it('crea un bot, opera con las señales y la plataforma ve bots, bitácora y operaciones', async () => {
    const r = await post('crear', NUEVO);
    expect(r.status).toBe(200);
    const id = ((await r.json()) as { bot: { id: string } }).bot.id;
    await paso(100); // primera señal: 0
    await paso(100, 1); // entra largo
    await paso(110, 0); // sale con ganancia
    const e = (await (await fetch(`${base}/api/paper`, { headers: auth })).json()) as { bots: { id: string; operaciones: number }[]; bitacora: { texto: string }[]; apagado: boolean };
    expect(e.bots.find((b) => b.id === id)?.operaciones).toBe(1);
    expect(e.bitacora.some((x) => x.texto.startsWith('Cierra largo'))).toBe(true);
    const ops = (await (await fetch(`${base}/api/paper/operaciones?bot=${id}`, { headers: auth })).json()) as { operaciones: OperacionPaper[] };
    expect(ops.operaciones).toHaveLength(1);
    expect(ops.operaciones[0].pnl).toBeGreaterThan(0);
  });

  it('el Juez manda: no crea bots rechazados ni de otro mercado; apagado de emergencia y rearmar', async () => {
    const mal = await post('crear', { ...NUEVO, veredicto: 'RECHAZADA' });
    expect(mal.status).toBe(400);
    expect(((await mal.json()) as { error: string }).error).toMatch(/no la aprobó/);
    expect((await post('crear', { ...NUEVO, mercadoAprobado: 'binance:XAUUSDT' })).status).toBe(400);
    expect((await post('apagar', {})).status).toBe(200);
    expect(motor.apagado).toBe(true);
    expect(motor.bots.every((b) => b.estado === 'apagado')).toBe(true);
    expect((await post('crear', NUEVO)).status).toBe(400);
    await post('rearmar', {});
    expect(motor.apagado).toBe(false);
    expect((await post('nada', {})).status).toBe(400);
  });
});
