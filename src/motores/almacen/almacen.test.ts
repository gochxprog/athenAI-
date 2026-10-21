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
    const rithmic = new AlmacenFeatures('rithmic');
    const s = await rithmic.nuevaSesion('BTCUSDT', parametrosPorDefecto(), 1);
    rithmic.guardar('BTCUSDT', s, [fila(1, 9000)]);
    await rithmic.vaciar();
    const antesBinance = (await bin.resumen()).find((r) => r.simbolo === 'BTCUSDT')?.filas;
    expect((await rithmic.resumen())[0].filas).toBe(1);
    await rithmic.borrar();
    expect(await rithmic.resumen()).toEqual([]);
    expect((await bin.resumen()).find((r) => r.simbolo === 'BTCUSDT')?.filas).toBe(antesBinance);
  });

  it('lee hacia atrás por páginas, solo de su símbolo y sin repetir (para el historial del gráfico)', async () => {
    const a = new AlmacenFeatures('grabadora');
    const s = await a.nuevaSesion('XAUUSDT', parametrosPorDefecto('XAUUSDT', 0.01), 1);
    a.guardar('XAUUSDT', s, [1, 2, 3, 4, 5].map((n) => fila(n, n * 1000)));
    const o = await a.nuevaSesion('SOLUSDT', parametrosPorDefecto('SOLUSDT', 0.01), 1);
    a.guardar('SOLUSDT', o, [fila(9, 2500)]);
    await a.vaciar();
    const p1 = await a.leerAntes('XAUUSDT', Infinity, 2);
    expect(p1.map((f) => f.cierre)).toEqual([4000, 5000]);
    const p2 = await a.leerAntes('XAUUSDT', p1[0].cierre, 2);
    expect(p2.map((f) => f.cierre)).toEqual([2000, 3000]);
    const p3 = await a.leerAntes('XAUUSDT', p2[0].cierre, 2);
    expect(p3.map((f) => f.cierre)).toEqual([1000]);
    expect(await a.leerAntes('XAUUSDT', 1000, 2)).toEqual([]);
  });
});
