import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { abrirManual, MAX_POSICIONES, previaOrden, tamanoPorRiesgo, tieneObjetivo, vigilarGestion } from './manual';
import { AlmacenPaper } from './almacenPaper';
import { MotorPaper, idManual } from './motorPaper';
import type { Bot, MercadoVivo } from './ejecutor';
import type { EstadoFeed } from '../worker/protocolo';

const T0 = Date.UTC(2026, 9, 21, 9, 0, 0);
const SIN_COSTOS = { comisionPb: 0, deslizamientoPb: 0 };
const mercado = (bid: number, ask = bid, atr: number | null = 10): MercadoVivo => ({ t: T0, bid, ask, precio: (bid + ask) / 2, atr, libro10: null, fundingTasa: null, enVivo: true });
const cuenta = (capital = 10_000): Bot =>
  ({ id: 'm', nombre: 'Manual', simbolo: 'BTCUSDT', capital, capitalInicial: capital, posicion: null, exposicion: 1, costos: SIN_COSTOS, gestion: null }) as unknown as Bot;

describe('Órdenes a mano (Terminal)', () => {
  it('tamaño por riesgo: cantidad = riesgo $ / distancia al stop; sin apalancamiento', () => {
    expect(tamanoPorRiesgo(10_000, 0.01, 50, 1_000)).toEqual({ cantidad: 2, riesgoUsd: 100, recortada: false });
    // 2 BTC × 100.000 = 200.000 > capital: se recorta a 0,1 BTC (riesgo real 5 $).
    expect(tamanoPorRiesgo(10_000, 0.01, 50, 100_000)).toEqual({ cantidad: 0.1, riesgoUsd: 5, recortada: true });
    const r = tamanoPorRiesgo(10_000, 0.01, 0.5, 100); // pediría 200 unidades = 20.000 $ > capital
    expect(r.recortada).toBe(true);
    expect(r.cantidad).toBe(100);
    expect(r.riesgoUsd).toBe(50);
  });

  it('vista previa: stop por ATR y objetivo por RR desde el lado del libro', () => {
    const p = previaOrden({ capital: 10_000, abierto: 0 }, mercado(99, 100), { lado: 1, riesgoPct: 0.01, stopAtr: 2, rr: 3, gestion: 'fija' })!;
    expect(p.entrada).toBe(100);
    expect(p.stop).toBe(80);
    expect(p.objetivo).toBe(160);
    expect(p.rr).toBe(3);
    expect(p.riesgoUsd).toBeCloseTo(100, 9);
    expect(previaOrden({ capital: 10_000, abierto: 0 }, mercado(99, 100, null), { lado: 1, riesgoPct: 0.01, stopAtr: 2, gestion: 'fija' })).toBeNull();
  });

  it('largo con objetivo: sale por el bid al tocarlo; R y P&L cuadran', () => {
    const b = cuenta();
    expect(abrirManual(b, mercado(99.9, 100, null), { lado: 1, riesgoPct: 0.01, stopPrecio: 90, rr: 2, gestion: 'fija' })).toBeNull();
    expect(b.posicion!.cantidad).toBeCloseTo(10, 9);
    expect(vigilarGestion(b, { ...mercado(110, 120, null), t: T0 + 1 })).toBeNull(); // el ask toca 120, pero se sale por el bid
    const op = vigilarGestion(b, { ...mercado(120, 120.1, null), t: T0 + 2 })!;
    expect(op.motivo).toBe('objetivo');
    expect(op.pnl).toBeCloseTo(200, 9);
    expect(op.gestion!.r).toBeCloseTo(2, 9);
    expect(b.capital).toBeCloseTo(10_200, 9);
    expect(b.gestion).toBeNull();
  });

  it('corto: el stop se mira por el ask; escalonada mueve a BE y luego asegura 1R', () => {
    const b = cuenta();
    abrirManual(b, mercado(100, 100.1, null), { lado: -1, riesgoPct: 0.01, stopPrecio: 110, rr: 3, gestion: 'escalonada' });
    vigilarGestion(b, mercado(89.8, 90, null)); // MFE 1R
    expect(b.gestion!.posicion.stop).toBe(100);
    vigilarGestion(b, mercado(79.9, 80, null)); // MFE 2R
    expect(b.gestion!.posicion.stop).toBe(90);
    const op = vigilarGestion(b, mercado(89.9, 90.05, null))!; // el ask sube a 90,05 ≥ stop 90
    expect(op.motivo).toBe('stop-en-ganancia');
    expect(op.gestion!.movimientos.map((m) => m.r)).toEqual([0, 1]);
    expect(op.pnl).toBeGreaterThan(0);
  });

  it('sin objetivo («libre»): solo sale por el stop; el objetivo sobrevive a JSON', () => {
    const b = cuenta();
    abrirManual(b, mercado(100), { lado: 1, riesgoPct: 0.005, stopAtr: 1, gestion: 'be1R' });
    const g = JSON.parse(JSON.stringify(b.gestion)) as NonNullable<Bot['gestion']>;
    expect(tieneObjetivo(g.posicion.objetivo)).toBe(false);
    expect(vigilarGestion(b, mercado(1_000))).toBeNull();
  });

  it('lotaje fijo: usa la cantidad dada; el riesgo sale de cantidad × distancia; no abre si no cabe o arriesga > 5 %', () => {
    const p = previaOrden({ capital: 10_000, abierto: 0 }, mercado(99, 100, null), { lado: 1, riesgoPct: 0.01, cantidad: 20, stopPrecio: 98, rr: 2, gestion: 'fija' })!;
    expect(p.cantidad).toBe(20);
    expect(p.riesgoUsd).toBe(40);
    const b = cuenta();
    expect(abrirManual(b, mercado(99, 100, null), { lado: 1, riesgoPct: 0.01, cantidad: 20, stopPrecio: 98, rr: 2, gestion: 'fija' })).toBeNull();
    expect(b.posicion!.cantidad).toBe(20);
    expect(abrirManual(cuenta(), mercado(99, 100, null), { lado: 1, riesgoPct: 0.01, cantidad: 200, stopPrecio: 98, gestion: 'fija' })).toMatch(/no cabe/);
    expect(abrirManual(cuenta(), mercado(99, 100, null), { lado: 1, riesgoPct: 0.01, cantidad: 90, stopPrecio: 90, gestion: 'fija' })).toMatch(/más del 5/);
    expect(abrirManual(cuenta(), mercado(99, 100, null), { lado: 1, riesgoPct: 0.01, cantidad: 0, stopPrecio: 90, gestion: 'fija' })).toMatch(/lotaje/);
  });

  it('no abre si ya hay posición o el riesgo es absurdo', () => {
    const b = cuenta();
    expect(abrirManual(b, mercado(100), { lado: 1, riesgoPct: 0.5, stopPrecio: 90, gestion: 'fija' })).toMatch(/riesgo/);
    abrirManual(b, mercado(100), { lado: 1, riesgoPct: 0.01, stopPrecio: 90, gestion: 'fija' });
    expect(abrirManual(b, mercado(100), { lado: -1, riesgoPct: 0.01, stopPrecio: 110, gestion: 'fija' })).toMatch(/Ya hay/);
  });

  it('en el motor: tu cuenta a mano no pide señales, el stop salta solo y queda en el libro', async () => {
    let ahora = T0;
    let pidio = 0;
    const motor = new MotorPaper({ senales: async (xs) => ((pidio += xs.length), []), avisar: () => {}, reloj: () => ahora, almacen: new AlmacenPaper(), local: null });
    await motor.cargar();
    const feed = (bid: number, filas: number) => ({ simbolo: 'BTCUSDT', proveedor: 'binance', conexion: 'en-vivo', precio: bid, filas, guardando: true, resumen: { bid, ask: bid + 0.1, precio: bid, atr: 50, libro10: null, fundingTasa: null } }) as unknown as EstadoFeed;
    await motor.alFeeds([feed(100_000, 1)]);
    const b = await motor.ordenManual({ proveedor: 'binance', simbolo: 'BTCUSDT', lado: 1, riesgoPct: 0.01, stopAtr: 2, rr: 2, gestion: 'fija' });
    expect(b.id).toBe(idManual('binance:BTCUSDT'));
    await expect(motor.ordenManual({ proveedor: 'binance', simbolo: 'BTCUSDT', lado: 1, riesgoPct: 0.01, stopAtr: 2, gestion: 'fija' })).rejects.toThrow(/Sin margen libre/); // 1×: la 1.ª ya usa toda la cuenta
    ahora += 1_000;
    await motor.alFeeds([feed(99_890, 2)]); // cae por debajo del stop (≈ 99.900)
    await motor.esperarSenales();
    expect(b.posicion).toBeNull();
    expect(pidio).toBe(0);
    const ops = await motor.operaciones(b.id);
    expect(ops.at(-1)?.motivo).toBe('stop');
    expect(ops.at(-1)?.gestion?.r).toBeLessThan(-0.9);
  });

  it('precio vivo (100 ms): el stop sale en el tick que lo toca, sin esperar al segundo, y con ese precio', async () => {
    const ahora = T0;
    const motor = new MotorPaper({ senales: async () => [], avisar: () => {}, reloj: () => ahora, almacen: new AlmacenPaper(), local: null });
    await motor.cargar();
    const feed = { simbolo: 'XAUUSDT', proveedor: 'binance', conexion: 'en-vivo', precio: 100_000, filas: 1, guardando: true, resumen: { bid: 100_000, ask: 100_000.1, precio: 100_000, atr: 50, libro10: null, fundingTasa: null } } as unknown as EstadoFeed;
    await motor.alFeeds([feed]);
    const b = await motor.ordenManual({ proveedor: 'binance', simbolo: 'XAUUSDT', lado: 1, riesgoPct: 0.01, stopAtr: 2, rr: 2, gestion: 'fija' });
    const stop = b.gestion!.posicion.stop;
    // (XAU: el libro de pruebas es compartido y el caso anterior dejó su cuenta de BTC guardada.)
    // Ticks por encima del stop: nada. Otro mercado: nada.
    await motor.alPrecio('binance:XAUUSDT', { b: stop + 5, a: stop + 5.1, p: stop + 5 });
    await motor.alPrecio('binance:BTCUSDT', { b: 1, a: 1, p: 1 });
    expect(b.posicion).not.toBeNull();
    // El tick que toca el stop la cierra ahí mismo (bid del largo), con el deslizamiento de un stop a mercado.
    await motor.alPrecio('binance:XAUUSDT', { b: stop - 1, a: stop - 0.9, p: stop - 1 });
    expect(b.posicion).toBeNull();
    const op = (await motor.operaciones(b.id)).at(-1)!;
    expect(op.motivo).toBe('stop');
    expect(op.precioSalida).toBeLessThan(stop);
    expect(op.precioSalida).toBeGreaterThan(stop - 1 - 0.01 * stop);
  });

  it('apalancamiento: deja abrir hasta capital × A, pero no con el stop más allá de la liquidación', () => {
    const b = cuenta();
    // 1 % de riesgo con stop a 1 punto de 100: pediría 100 unidades = 10.000 USD; con 2× cabe entero.
    expect(abrirManual(b, mercado(99.9, 100, null), { lado: 1, riesgoPct: 0.01, stopPrecio: 99, gestion: 'fija', apalancamiento: 2 })).toBeNull();
    expect(b.posicion!.cantidad * b.posicion!.precioEntrada).toBeGreaterThan(9_900);
    // Con 10× se liquida a ≈ 10 % en contra: un stop a 9 % queda pasado el 80 % de eso.
    expect(abrirManual(cuenta(), mercado(99.9, 100, null), { lado: 1, riesgoPct: 0.01, stopPrecio: 91, gestion: 'fija', apalancamiento: 10 })).toMatch(/liquidar/);
    expect(abrirManual(cuenta(), mercado(99.9, 100, null), { lado: 1, riesgoPct: 0.01, stopPrecio: 91, gestion: 'fija', apalancamiento: 20 })).toMatch(/1× a 10×/);
    // Lo ya abierto en la cuenta resta de lo libre.
    expect(abrirManual(cuenta(), mercado(99.9, 100, null), { lado: 1, riesgoPct: 0.01, cantidad: 30, stopPrecio: 99, gestion: 'fija' }, { capital: 10_000, abierto: 8_000 })).toMatch(/libres 2\.?000/);
  });

  it('en el motor: varias posiciones a la vez en un mercado, con la misma cuenta, y lo ganado vuelve a la cuenta', async () => {
    const ahora = T0;
    const motor = new MotorPaper({ senales: async () => [], avisar: () => {}, reloj: () => ahora, almacen: new AlmacenPaper(), local: null });
    await motor.cargar();
    const feed = (bid: number) => ({ simbolo: 'ETHUSDT', proveedor: 'binance', conexion: 'en-vivo', precio: bid, filas: 1, guardando: true, resumen: { bid, ask: bid + 0.01, precio: bid, atr: 5, libro10: null, fundingTasa: null } }) as unknown as EstadoFeed;
    await motor.alFeeds([feed(3_000)]);
    const orden = { proveedor: 'binance' as const, simbolo: 'ETHUSDT', lado: 1 as const, riesgoPct: 0.002, stopAtr: 2, rr: 2, gestion: 'fija' as const, apalancamiento: 5 };
    const uno = await motor.ordenManual(orden);
    const dos = await motor.ordenManual({ ...orden, lado: -1 });
    expect(uno.id).toBe(idManual('binance:ETHUSDT'));
    expect(dos.id).toBe(`${uno.id}#2`);
    expect(dos.cuenta).toBe(uno.id);
    expect([uno.posicion?.lado, dos.posicion?.lado]).toEqual([1, -1]);
    // La comisión de la 2.ª ya se descontó de la cuenta: su capital propio es 0.
    expect(dos.capital).toBe(0);
    const antes = uno.capital;
    await motor.cerrarManual(dos.id);
    const op = (await motor.operaciones(dos.id)).at(-1)!;
    expect(dos.capital).toBe(0);
    // La cuenta recibe el cierre (P&L de precio − comisión de salida); la de entrada ya la había pagado al abrir.
    expect(uno.capital).toBeCloseTo(antes + op.pnl + (op.nocional * 5) / 10_000, 6);
    for (let i = 0; i < MAX_POSICIONES - 1; i += 1) await motor.ordenManual(orden);
    await expect(motor.ordenManual(orden)).rejects.toThrow(/posiciones abiertas/);
  });
});
