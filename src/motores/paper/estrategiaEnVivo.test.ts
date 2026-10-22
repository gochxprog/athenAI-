import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AlmacenPaper } from './almacenPaper';
import { MotorPaper } from './motorPaper';
import type { EstadoFeed } from '../worker/protocolo';
import type { EstrategiaEnVivo, SenalEstrategia } from '../laboratorio/protocolo';
import { COSTOS_POR_DEFECTO } from '../juez/costos';

const T0 = Date.UTC(2026, 9, 21, 9, 0, 0);
const feed = (bid: number, filas: number) => ({ simbolo: 'BTCUSDT', proveedor: 'binance', conexion: 'en-vivo', precio: bid, filas, guardando: true, resumen: { bid, ask: bid + 0.1, precio: bid, atr: 50, libro10: null, fundingTasa: null } }) as unknown as EstadoFeed;

describe('Bot de estrategia en vivo con la GESTION del Juez', () => {
  it('usa la serie del Juez, pone stop/objetivo al entrar, sale por stop y no re-entra con la misma señal', async () => {
    let ahora = T0;
    let senal = 0;
    const pedidas: EstrategiaEnVivo[] = [];
    const motor = new MotorPaper({
      senales: async (xs) => xs.map((x): SenalEstrategia => (pedidas.push(x), { id: x.id, posicion: senal, t: ahora, atr: 100 })),
      avisar: () => {},
      reloj: () => ahora,
      almacen: new AlmacenPaper(),
      local: null,
    });
    await motor.cargar();
    let filas = 1;
    const paso = async (bid: number) => {
      ahora += 1_000;
      await motor.alFeeds([feed(bid, (filas += 1))]);
      await motor.esperarSenales();
    };
    await paso(100_000);
    const b = await motor.crearBot({
      nombre: 'Ruptura', estrategiaId: 'e1', codigo: 'x', combo: {}, proveedor: 'binance', simbolo: 'BTCUSDT', mercadoAprobado: 'binance:BTCUSDT',
      veredicto: 'APROBADA', score: 80, capital: 10_000, exposicion: 1, costos: COSTOS_POR_DEFECTO, retornosJuez: [], serie: '5m', reglasSalida: { stopAtr: 2, rr: 3, gestion: 'fija' },
    });
    await paso(100_000); // primera señal: solo la mira
    expect(pedidas.at(-1)?.serie).toBe('5m');
    senal = 1;
    await paso(100_000);
    expect(b.posicion?.lado).toBe(1);
    const g = b.gestion!.posicion;
    expect(g.stop).toBeCloseTo(b.posicion!.precioEntrada - 200, 6); // 2 × ATR de la vela de la señal
    expect(g.objetivo).toBeCloseTo(b.posicion!.precioEntrada + 600, 6); // 1:3
    await paso(99_700); // el bid cae bajo el stop
    expect(b.posicion).toBeNull();
    const ops = await motor.operaciones(b.id);
    expect(ops.at(-1)?.motivo).toBe('stop');
    expect(ops.at(-1)?.gestion?.r).toBeLessThan(-0.9);
    await paso(100_000); // la señal sigue en 1: como en el Juez, no se vuelve a entrar
    expect(b.posicion).toBeNull();
    senal = 0;
    await paso(100_000);
    senal = 1;
    await paso(100_000); // cambia otra vez: entra de nuevo, con su stop
    expect(b.posicion?.lado).toBe(1);
    expect(b.gestion).not.toBeNull();
    senal = -1;
    await paso(100_100); // giro de la señal: cierra la gestionada (con su R) y abre corto
    expect((await motor.operaciones(b.id)).at(-1)?.motivo).toBe('senal');
    expect((await motor.operaciones(b.id)).at(-1)?.gestion).toBeDefined();
    expect(b.posicion?.lado).toBe(-1);
    expect(b.gestion?.posicion.lado).toBe(-1);
  });
});
