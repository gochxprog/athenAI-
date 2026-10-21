import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AlmacenFeatures } from './almacen';
import { parametrosPorDefecto } from '../nucleo/parametros';
import type { FilaFeatures } from '../nucleo/features';

const fila = (n: number, cierre: number): FilaFeatures => ({ n, inicio: cierre - 1000, cierre, close: 100 + n, valores: { delta: n } });

describe('almacén de Features por fuente', () => {
  it('guarda por símbolo y sesión, resume y lee en orden', async () => {
    const a = new AlmacenFeatures('binance');
    const s1 = await a.nuevaSesion('BTCUSDT', parametrosPorDefecto(), 1);
    a.guardar('BTCUSDT', s1, [fila(1, 2000), fila(2, 3000)]);
    const s2 = await a.nuevaSesion('ETHUSDT', parametrosPorDefecto('ETHUSDT', 0.01), 1);
    a.guardar('ETHUSDT', s2, [fila(1, 2500)]);
    expect(await a.vaciar()).toBe(3);
    expect(await a.resumen()).toEqual([
      { simbolo: 'BTCUSDT', filas: 2, desde: 2000, hasta: 3000, sesiones: 1 },
      { simbolo: 'ETHUSDT', filas: 1, desde: 2500, hasta: 2500, sesiones: 1 },
    ]);
    const leidas = await a.leer('BTCUSDT');
    expect(leidas.map((f) => [f.n, f.sesion])).toEqual([[1, s1], [2, s1]]);
  });

  it('cada proveedor es una base separada y se borra sin tocar a las demás', async () => {
    const bin = new AlmacenFeatures('binance');
    const urus = new AlmacenFeatures('urus');
    const s = await urus.nuevaSesion('BTCUSDT', parametrosPorDefecto(), 1);
    urus.guardar('BTCUSDT', s, [fila(1, 9000)]);
    await urus.vaciar();
    const antesBinance = (await bin.resumen()).find((r) => r.simbolo === 'BTCUSDT')?.filas;
    expect((await urus.resumen())[0].filas).toBe(1);
    await urus.borrar();
    expect(await urus.resumen()).toEqual([]);
    expect((await bin.resumen()).find((r) => r.simbolo === 'BTCUSDT')?.filas).toBe(antesBinance);
  });
});
