import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { crearBiblioteca, MAX_RESULTADOS } from './bibliotecaVps';
import { MotorPaper } from '../src/motores/paper/motorPaper';
import { LibroPaperDisco, almacenLocalDisco } from './botsVps';
import type { ResultadoPrueba } from '../src/motores/laboratorio/prueba';

const carpetas: string[] = [];
const temporal = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bib-'));
  carpetas.push(d);
  return d;
};
afterEach(() => carpetas.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const resultado = (veredicto: string, ensayos = 2): ResultadoPrueba =>
  ({
    juez: { veredicto, resumen: 'r', score: { total: 70 }, ensayos, comboVivo: 1, oos: { sharpe: 1.2, retornoTotal: 0.1, maxDrawdown: 0.05, operaciones: 40, aciertos: 0.55 }, operacionesOos: [{ retorno: 0.01 }, { retorno: -0.005 }] },
    combos: [{ n: 20 }, { n: 40 }],
    gestion: { stopAtr: 1.5, rr: 2, gestion: 'be1R' },
    velas: { total: 1000, desde: 1, hasta: 2, serie: '5m', fuente: 'todo' },
    tiempos: [],
  }) as unknown as ResultadoPrueba;
const pedido = { codigo: 'def estrategia(v, p): return [0]*len(v)', simbolo: 'BTCUSDT', serie: '5m' as const, fuente: 'todo' as const, nombre: 'Ruptura' };

describe('Biblioteca en el VPS', () => {
  it('guarda cada prueba con su variante elegida y cuenta todos los intentos (también los borrados)', async () => {
    const b = crearBiblioteca({ datos: temporal() });
    const e = b.guardar(pedido, resultado('RECHAZADA'));
    b.guardar(pedido, resultado('APROBADA', 3));
    expect(b.lista().intentos).toBe(5);
    expect(e).toMatchObject({ nombre: 'Ruptura', combo: { n: 40 }, veredicto: 'RECHAZADA', ensayos: 2, conResultado: true });
    expect(b.resultado(e.id)?.juez.veredicto).toBe('RECHAZADA');
    await b.accion('borrar', { id: e.id });
    expect(b.lista()).toMatchObject({ intentos: 5, entradas: [{ veredicto: 'APROBADA' }] });
    expect(b.resultado('../../etc/passwd')).toBeNull();
  });

  it('los resultados completos más viejos se borran; su resumen queda', () => {
    const b = crearBiblioteca({ datos: temporal() });
    const primera = b.guardar(pedido, resultado('RECHAZADA'));
    for (let i = 0; i < MAX_RESULTADOS; i++) b.guardar(pedido, resultado('RECHAZADA'));
    expect(b.lista().entradas.find((x) => x.id === primera.id)?.conResultado).toBe(false);
    expect(b.resultado(primera.id)).toBeNull();
  });

  it('a Paper solo pasan las aprobadas, con su serie y su GESTION', async () => {
    const datos = temporal();
    const motor = new MotorPaper({ senales: async () => [], avisar: () => {}, reloj: () => 1, almacen: new LibroPaperDisco(path.join(datos, 'paper')), local: almacenLocalDisco(path.join(datos, 'estado.json')) });
    await motor.cargar();
    const b = crearBiblioteca({ datos, paper: () => motor });
    const mala = b.guardar(pedido, resultado('RECHAZADA'));
    await expect(b.accion('paper', { id: mala.id })).rejects.toThrow(/no la aprobó/);
    const buena = b.guardar(pedido, resultado('APROBADA'));
    const { bot } = (await b.accion('paper', { id: buena.id, capital: 5_000 })) as { bot: { id: string; serie: string; reglasSalida: unknown; combo: unknown; capital: number } };
    expect(bot).toMatchObject({ serie: '5m', reglasSalida: { stopAtr: 1.5, rr: 2, gestion: 'be1R' }, combo: { n: 40 }, capital: 5_000 });
    expect(b.lista().entradas[0].botId).toBe(bot.id);
  });
});
