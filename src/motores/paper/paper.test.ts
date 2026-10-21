import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deslizamientoDinamico, DESLIZ_MAXIMO } from '../juez/costos';
import { bandaTrasOperaciones } from '../juez/monteCarlo';
import { crearAleatorio } from '@/lib/random';
import { abrir, aplicarFunding, cerrar, equity, operacionesCsv, rebalancear, type Bot, type MercadoVivo } from './ejecutor';
import { caidaDelDia, exposicionMaxima, REGLAS_POR_DEFECTO, revisar, revisarOperacion } from './guardian';
import { AlmacenPaper } from './almacenPaper';
import { MotorPaper } from './motorPaper';
import type { EstadoFeed } from '../worker/protocolo';
import type { Aviso } from '../notificaciones/canales';
import type { SenalEstrategia } from '../laboratorio/protocolo';

const T0 = Date.UTC(2026, 9, 21, 7, 59, 0);
const COSTOS = { comisionPb: 5, deslizamientoPb: 1 };

const mercado = (bid: number, ask: number, extra: Partial<MercadoVivo> = {}): MercadoVivo => ({ t: T0, bid, ask, precio: (bid + ask) / 2, atr: null, libro10: null, fundingTasa: null, enVivo: true, ...extra });

function bot(extra: Partial<Bot> = {}): Bot {
  return {
    id: 'b1', nombre: 'Prueba', estrategiaId: 'e1', codigo: '', combo: {}, proveedor: 'binance', simbolo: 'BTCUSDT', mercado: 'binance:BTCUSDT', creado: T0,
    veredicto: 'APROBADA', score: 80, exposicion: 1, capitalInicial: 10_000, capital: 10_000, posicion: null, estado: 'activo', motivo: '',
    costos: COSTOS, retornosJuez: [0.01], dia: { fecha: '2026-10-21', pico: 10_000 }, pausadoDia: null, perdidasSeguidas: 0, operaciones: 0,
    retornoUnidadAcum: 0, ultimoFundingT: T0, ultimaSenalT: null, ultimaSenal: null, ultimoPrecio: null, hueco: false, ultimaActualizacion: T0, curva: [],
    ...extra,
  };
}

describe('Costos en vivo · deslizamiento dinámico', () => {
  it('suma base + 10 % del ATR relativo + impacto en el libro, con tope', () => {
    // 1 pb + 0,1 × (1 / 100) + (50.000 / 100.000) × 0,002 = 0,0001 + 0,001 + 0,001
    expect(deslizamientoDinamico(COSTOS, { precio: 100, atr: 1, nocionalOrden: 50_000, liquidezLado: 100_000, distanciaLado: 0.002 })).toBeCloseTo(0.0021, 12);
    expect(deslizamientoDinamico(COSTOS, { precio: 100, atr: null, nocionalOrden: 1, liquidezLado: null, distanciaLado: null })).toBeCloseTo(0.0001, 12);
    expect(deslizamientoDinamico(COSTOS, { precio: 100, atr: 100, nocionalOrden: 0, liquidezLado: null, distanciaLado: null })).toBe(DESLIZ_MAXIMO);
  });
});

describe('Ejecutor', () => {
  it('largo: compra al ask + deslizamiento, vende al bid − deslizamiento, con comisiones (valores a mano)', () => {
    const b = bot();
    expect(abrir(b, 1, mercado(99.9, 100.1))).toBe(true);
    // Entrada = 100,1 × 1,0001 = 100,11001 · cantidad = 10.000 / 100,11001 · comisión = 10.000 × 0,0005 = 5
    expect(b.posicion!.precioEntrada).toBeCloseTo(100.11001, 9);
    expect(b.posicion!.cantidad).toBeCloseTo(99.890110889, 6);
    expect(b.capital).toBeCloseTo(9_995, 9);
    const op = cerrar(b, mercado(110, 110.2), 'senal')!;
    // Salida = 110 × 0,9999 = 109,989 · comisión = cantidad × 109,989 × 0,0005 = 5,4934067
    expect(op.precioSalida).toBeCloseTo(109.989, 9);
    expect(op.comisiones).toBeCloseTo(10.4934067, 6);
    // P&L = cantidad × (109,989 − 100,11001) − 5 − 5,4934067 = 976,32
    expect(op.pnl).toBeCloseTo(976.32, 4);
    expect(op.retorno).toBeCloseTo(0.097632, 6);
    expect(b.capital).toBeCloseTo(10_976.32, 4);
    expect(b.posicion).toBeNull();
  });

  it('corto con exposición 0,5: vende al bid, recompra al ask, retorno por unidad = retorno / 0,5', () => {
    const b = bot({ exposicion: 0.5 });
    abrir(b, -1, mercado(99.9, 100.1));
    expect(b.posicion!.precioEntrada).toBeCloseTo(99.89001, 9);
    expect(b.capital).toBeCloseTo(9_997.5, 9);
    const op = cerrar(b, mercado(90, 90.2), 'senal')!;
    expect(op.precioSalida).toBeCloseTo(90.20902, 9);
    expect(op.pnl).toBeCloseTo(479.82478, 4);
    expect(op.retorno).toBeCloseTo(0.0479825, 6);
    expect(op.retornoUnidad).toBeCloseTo(0.095965, 5);
  });

  it('rebalancear: girar de largo a corto cierra una operación y abre otra', () => {
    const b = bot();
    rebalancear(b, 1, mercado(99.9, 100.1));
    const ops = rebalancear(b, -1, mercado(101, 101.2));
    expect(ops).toHaveLength(1);
    expect(ops[0].lado).toBe(1);
    expect(b.posicion!.lado).toBe(-1);
    expect(rebalancear(b, -1, mercado(101, 101.2))).toHaveLength(0);
  });

  it('funding: el largo paga lado × cantidad × precio × tasa en cada corte de 8 h', () => {
    const b = bot();
    abrir(b, 1, mercado(99.9, 100.1));
    const q = b.posicion!.cantidad;
    const antes = b.capital;
    // De 07:59 a 07:59:30 no hay corte; a las 08:00:01 sí (uno).
    expect(aplicarFunding(b, T0 + 30_000, 0.0001, 100)).toBe(0);
    expect(aplicarFunding(b, T0 + 61_000, 0.0001, 100)).toBeCloseTo(q * 100 * 0.0001, 12);
    expect(b.capital).toBeCloseTo(antes - q * 0.01, 9);
    const op = cerrar(b, mercado(99.9, 100.1, { t: T0 + 70_000 }), 'senal')!;
    expect(op.funding).toBeCloseTo(q * 0.01, 9);
    // Con tasa positiva el corto cobra.
    const c = bot();
    abrir(c, -1, mercado(99.9, 100.1));
    expect(aplicarFunding(c, T0 + 61_000, 0.0001, 100)).toBeLessThan(0);
  });

  it('equity marca la posición al precio medio y el CSV tiene una fila por operación', () => {
    const b = bot();
    abrir(b, 1, mercado(99.9, 100.1));
    const q = b.posicion!.cantidad;
    expect(equity(b, mercado(104.9, 105.1))).toBeCloseTo(9_995 + q * (105 - 100.11001), 6);
    const op = cerrar(b, mercado(110, 110.2), 'senal')!;
    const csv = operacionesCsv([op]).split('\n');
    expect(csv).toHaveLength(2);
    expect(csv[1].startsWith('BTCUSDT,largo,')).toBe(true);
  });
});

describe('Guardián', () => {
  it('exposición máxima por veredicto', () => {
    expect(exposicionMaxima('APROBADA')).toBe(1);
    expect(exposicionMaxima('APROBADA CON RESERVA')).toBe(0.5);
    expect(exposicionMaxima('RECHAZADA')).toBe(0);
    expect(exposicionMaxima(undefined)).toBe(0);
  });

  it('caída del día desde el pico, que se reinicia al cambiar el día UTC', () => {
    const b = bot();
    expect(caidaDelDia(b, 10_500, T0)).toBe(0);
    expect(caidaDelDia(b, 9_975, T0)).toBeCloseTo(0.05, 12);
    expect(revisar(b, mercado(99.9, 100.1), 9_975, REGLAS_POR_DEFECTO)?.tipo).toBe('caida-dia');
    const manana = T0 + 24 * 3_600_000;
    expect(caidaDelDia(b, 9_975, manana)).toBe(0);
    expect(b.dia.pico).toBe(9_975);
  });

  it('sin datos, vuelta de datos y nuevo día', () => {
    const b = bot();
    expect(revisar(b, mercado(99.9, 100.1, { enVivo: false }), 10_000, REGLAS_POR_DEFECTO)?.tipo).toBe('sin-datos');
    b.estado = 'sin-datos';
    expect(revisar(b, mercado(99.9, 100.1), 10_000, REGLAS_POR_DEFECTO)?.tipo).toBe('datos-vuelven');
    b.estado = 'pausado-dia';
    b.pausadoDia = '2026-10-20';
    expect(revisar(b, mercado(99.9, 100.1), 10_000, REGLAS_POR_DEFECTO)?.tipo).toBe('nuevo-dia');
    b.pausadoDia = '2026-10-21';
    expect(revisar(b, mercado(99.9, 100.1), 10_000, REGLAS_POR_DEFECTO)).toBeNull();
  });

  it('cuarentena tras N pérdidas seguidas', () => {
    expect(revisarOperacion(bot({ perdidasSeguidas: 4, operaciones: 4 }), REGLAS_POR_DEFECTO)).toBeNull();
    expect(revisarOperacion(bot({ perdidasSeguidas: 5, operaciones: 5 }), REGLAS_POR_DEFECTO)?.tipo).toBe('cuarentena');
  });

  it('banda del Juez: con todas las operaciones a +1 %, la banda tras k es exactamente 1,01^k − 1', () => {
    const banda = bandaTrasOperaciones([0.01], 6, crearAleatorio(1))!;
    expect(banda.p5).toBeCloseTo(1.01 ** 6 - 1, 12);
    expect(banda.p95).toBeCloseTo(1.01 ** 6 - 1, 12);
    const dos = bandaTrasOperaciones([0.1, -0.1], 1, crearAleatorio(1))!;
    expect(dos.p5).toBeCloseTo(-0.1, 12);
    expect(dos.p95).toBeCloseTo(0.1, 12);
    expect(revisarOperacion(bot({ operaciones: 6, retornoUnidadAcum: 0.06 }), REGLAS_POR_DEFECTO)?.tipo).toBe('fuera-de-banda');
    expect(revisarOperacion(bot({ operaciones: 6, retornoUnidadAcum: 0.07 }), REGLAS_POR_DEFECTO)).toBeNull();
    // Con menos de 5 operaciones no se juzga la banda.
    expect(revisarOperacion(bot({ operaciones: 4, retornoUnidadAcum: -0.5 }), REGLAS_POR_DEFECTO)).toBeNull();
  });
});

describe('Motor de Paper (de punta a punta con el libro en IndexedDB)', () => {
  function montar() {
    let ahora = T0;
    const avisos: Aviso[] = [];
    const cola: number[] = [];
    let filas = 0;
    const almacen = new AlmacenPaper();
    const motor = new MotorPaper({
      // Una barra = una señal para todos los bots (la base de pruebas comparte bots entre casos).
      senales: async (xs) => {
        const v = cola.shift() ?? 0;
        return xs.map((x): SenalEstrategia => ({ id: x.id, posicion: v, t: ahora }));
      },
      avisar: (a) => avisos.push(a),
      reloj: () => ahora,
      almacen,
      local: null,
    });
    const feed = (bid: number, conexion: EstadoFeed['conexion'] = 'en-vivo') =>
      ({ simbolo: 'BTCUSDT', proveedor: 'binance', conexion, precio: bid + 0.1, filas, guardando: true, resumen: { bid, ask: bid + 0.2, precio: bid + 0.1, atr: null, libro10: null, fundingTasa: null } }) as unknown as EstadoFeed;
    const paso = async (bid: number, opciones: { barra?: number; conexion?: EstadoFeed['conexion'] } = {}) => {
      ahora += 1_000;
      if (opciones.barra !== undefined) {
        filas += 1;
        cola.push(opciones.barra);
      }
      await motor.alFeeds([feed(bid, opciones.conexion)]);
      await motor.esperarSenales();
    };
    return { motor, almacen, avisos, paso, avanzar: (ms: number) => (ahora += ms) };
  }

  const nuevo = { nombre: 'Absorción', estrategiaId: 'e1', codigo: '', combo: {}, proveedor: 'binance' as const, simbolo: 'BTCUSDT', mercadoAprobado: 'binance:BTCUSDT' as const, veredicto: 'APROBADA', score: 80, capital: 10_000, exposicion: 1, costos: COSTOS, retornosJuez: [0.01, -0.005] };

  it('solo crea bots de estrategias aprobadas y limita la exposición según la nota', async () => {
    const { motor } = montar();
    await motor.cargar();
    await expect(motor.crearBot({ ...nuevo, veredicto: 'RECHAZADA' })).rejects.toThrow();
    const b = await motor.crearBot({ ...nuevo, veredicto: 'APROBADA CON RESERVA', exposicion: 3 });
    expect(b.exposicion).toBe(0.5);
  });

  it('un mercado, un juicio: no se crea un bot de BTC con una aprobación de XAU, y un bot de BTC no opera con barras de XAU', async () => {
    const { motor, paso } = montar();
    await motor.cargar();
    await expect(motor.crearBot({ ...nuevo, mercadoAprobado: 'binance:XAUUSDT' })).rejects.toThrow(/no en binance:BTCUSDT/);
    await expect(motor.crearBot({ ...nuevo, simbolo: 'XAUUSDT' })).rejects.toThrow(/aprobó esta estrategia en binance:BTCUSDT/);
    const b = await motor.crearBot(nuevo);
    expect(b.mercado).toBe('binance:BTCUSDT');
    await paso(100); // primer feed de BTC: señal 0
    // Llegan barras nuevas SOLO de XAU (BTC no cambia): el bot de BTC no pide señal ni abre.
    const xau = (filas: number) => ({ simbolo: 'XAUUSDT', proveedor: 'binance', conexion: 'en-vivo', precio: 2400, filas, guardando: true, resumen: { bid: 2400, ask: 2400.2, precio: 2400.1, atr: null, libro10: null, fundingTasa: null } }) as unknown as EstadoFeed;
    const antes = b.ultimaSenalT;
    for (let i = 1; i <= 3; i += 1) {
      await motor.alFeeds([xau(i)]);
      await motor.esperarSenales();
    }
    expect(b.posicion).toBeNull();
    expect(b.ultimaSenalT).toBe(antes);
    expect(b.ultimoPrecio).not.toBe(2400.1);
    await motor.borrar(b.id);
  });

  it('espera la próxima entrada, opera con las señales, guarda las operaciones y el apagado cierra todo', async () => {
    const { motor, almacen, avisos, paso } = montar();
    await motor.cargar();
    const b = await motor.crearBot(nuevo);
    await paso(100); // primer feed: se piden señales del bot nuevo → 0
    expect(b.ultimaSenal).toBe(0);
    await paso(100, { barra: 1 }); // la señal cambia a largo → abre
    expect(b.posicion?.lado).toBe(1);
    expect(b.posicion!.precioEntrada).toBeCloseTo(100.2 * 1.0001, 9);
    await paso(102, { barra: 1 }); // misma señal: no hace nada
    await paso(103, { barra: 0 }); // sale
    expect(b.posicion).toBeNull();
    const ops = await almacen.leerOperaciones(b.id);
    expect(ops).toHaveLength(1);
    expect(ops[0].pnl).toBeGreaterThan(0);
    expect(avisos.some((a) => a.tipo === 'bot' && a.texto.startsWith('Abre largo'))).toBe(true);
    await paso(103, { barra: -1 }); // abre corto
    expect(b.posicion?.lado).toBe(-1);
    await motor.apagarTodo();
    expect(b.posicion).toBeNull();
    expect(b.estado).toBe('apagado');
    expect((await almacen.leerOperaciones(b.id)).map((o) => o.motivo)).toEqual(['senal', 'apagado']);
    // Con el apagado activo no se crean bots ni se reanudan.
    await expect(motor.crearBot(nuevo)).rejects.toThrow();
    await motor.reanudar(b.id);
    expect(b.estado).toBe('apagado');
    // Se recupera de IndexedDB.
    const otro = new MotorPaper({ senales: async () => [], avisar: () => {}, reloj: () => T0, almacen, local: null });
    await otro.cargar();
    expect(otro.bots.find((x) => x.id === b.id)?.capital).toBeCloseTo(b.capital, 9);
  });

  it('un corte de datos con posición abierta: no opera y cierra al volver', async () => {
    const { motor, paso } = montar();
    await motor.cargar();
    const b = await motor.crearBot(nuevo);
    await paso(100);
    await paso(100, { barra: 1 });
    expect(b.posicion).not.toBeNull();
    await paso(100, { conexion: 'reconectando' });
    expect(b.estado).toBe('sin-datos');
    expect(b.posicion).not.toBeNull();
    await paso(99);
    expect(b.estado).toBe('activo');
    expect(b.posicion).toBeNull();
  });

  it('la caída del día cierra y pausa hasta el día siguiente', async () => {
    const { motor, paso, avanzar } = montar();
    await motor.cargar();
    const b = await motor.crearBot(nuevo);
    await paso(100);
    await paso(100, { barra: 1 });
    await paso(94); // −6 %
    expect(b.estado).toBe('pausado-dia');
    expect(b.posicion).toBeNull();
    await paso(94, { barra: -1 }); // pausado: no opera
    expect(b.posicion).toBeNull();
    avanzar(24 * 3_600_000);
    await paso(94);
    expect(b.estado).toBe('activo');
  });

  it('5 pérdidas seguidas → cuarentena', async () => {
    const { motor, paso } = montar();
    await motor.cargar();
    const b = await motor.crearBot(nuevo);
    await paso(100);
    for (let i = 0; i < 5; i += 1) {
      await paso(100, { barra: 1 });
      await paso(99.95, { barra: 0 });
    }
    expect(b.perdidasSeguidas).toBe(5);
    expect(b.estado).toBe('cuarentena');
    await motor.reanudar(b.id);
    expect(b.estado).toBe('activo');
    expect(b.perdidasSeguidas).toBe(0);
  });
});
