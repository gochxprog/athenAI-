import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { crearSala, type Lectura } from './agentesVps';
import { HORA_MS, frase, sumar, ultimas24 } from '../src/motores/agentes/sala';
import type { EstadoSimbolo } from './servidor';

const carpetas: string[] = [];
const temporal = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sala-'));
  carpetas.push(d);
  return d;
};
afterEach(() => carpetas.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const RECURSOS = { memTotal: 4e9, memLibre: 2e9, rss: 3e8, carga: 0.4, nucleos: 2, discoLibre: 1e11, discoTotal: 2e11 };
const mercado = (simbolo: string, conexion = 'en-vivo', filasSesion = 0): EstadoSimbolo => ({ simbolo, conexion, detalle: '', filasSesion, ultimoCierre: null, cortes: 0, tradesPerdidos: 0 });
const lectura = (x: Partial<Lectura> = {}): Lectura => ({ mercados: [mercado('BTCUSDT'), mercado('XAUUSDT')], bots: null, prueba: null, historia: [], ...x });
const sala = (datos = temporal()) => {
  let t = Date.UTC(2026, 9, 22, 10, 0, 0);
  const s = crearSala({ datos, reloj: () => t, recursos: () => RECURSOS });
  return { s, datos, avanzar: (ms: number) => (t += ms), ficha: (id: string) => s.estado().agentes.find((a) => a.id === id)! };
};
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe('cuentas de la sala', () => {
  it('actividad por hora: suma en la hora y olvida lo de hace más de 24 h', () => {
    const t = 1000 * HORA_MS;
    let c = sumar([], t, 3);
    c = sumar(c, t + 10, 2);
    c = sumar(c, t - 30 * HORA_MS, 9);
    expect(ultimas24(c, t).at(-1)).toBe(5);
    expect(ultimas24(sumar(c, t + 25 * HORA_MS), t + 25 * HORA_MS).reduce((a, b) => a + b, 0)).toBe(1);
  });
  it('la frase dice cuántos trabajan y qué hace la fila', () => {
    const { s } = sala();
    s.latir(lectura());
    expect(frase(s.estado())).toMatch(/^\d agentes trabajando\. La fila pesada está libre\./);
  });
});

describe('orquestador en el VPS', () => {
  it('nadie trabaja sin motor: los que no tienen trabajo en el VPS duermen hasta su fase', () => {
    const { s, ficha } = sala();
    s.latir(lectura());
    expect(ficha('vigia').estado).toBe('trabajando');
    expect(ficha('flujo').estado).toBe('trabajando');
    for (const id of ['rastreador', 'etiquetador', 'lector', 'sintetizador']) expect(ficha(id).estado).toBe('dormido');
    expect(ficha('lector').ahora).toMatch(/A3/);
    expect(ficha('guardian').estado).toBe('dormido');
    expect(ficha('juez').estado).toBe('esperando');
  });

  it('Vigía anota los cortes (grave) y la vuelta; queda en alerta mientras un mercado no está en vivo', () => {
    const { s, ficha } = sala();
    s.latir(lectura());
    s.latir(lectura({ mercados: [mercado('BTCUSDT', 'reconectando'), mercado('XAUUSDT')] }));
    expect(ficha('vigia').estado).toBe('alerta');
    s.latir(lectura());
    const notas = s.estado().notas.filter((n) => n.id === 'vigia');
    expect(notas.map((n) => [n.texto, !!n.grave])).toEqual([['BTCUSDT: reconectando → en-vivo', false], ['BTCUSDT: en-vivo → reconectando', true]]);
  });

  it('Flujo cuenta las filas nuevas y al cambiar de hora deja el resumen en la radio', () => {
    const { s, ficha, avanzar } = sala();
    s.latir(lectura({ mercados: [mercado('BTCUSDT', 'en-vivo', 100)] }));
    s.latir(lectura({ mercados: [mercado('BTCUSDT', 'en-vivo', 160)] }));
    expect(ficha('flujo').actividad.at(-1)).toBe(60);
    avanzar(HORA_MS);
    s.latir(lectura({ mercados: [mercado('BTCUSDT', 'en-vivo', 170)] }));
    expect(s.estado().notas[0].texto).toBe('Última hora: +70 filas de Features (BTC 70).');
  });

  it('Programador y luego Juez según el paso de la prueba; bots: lo nuevo de su bitácora va a la radio', () => {
    const { s, ficha } = sala();
    const prueba = { nombre: 'Absorción', simbolo: 'BTCUSDT', serie: '5m', paso: 'Cargando Python…' };
    const bots = { total: 2, activos: 1, enPosicion: 1, apagado: false, bitacora: [{ t: 1, botId: 'a', nombre: 'Viejo', texto: 'ya visto', grave: false }] };
    s.latir(lectura({ prueba, bots }));
    expect(ficha('programador').estado).toBe('trabajando');
    expect(ficha('juez').estado).toBe('esperando');
    const t = s.estado().t;
    s.latir(lectura({ prueba: { ...prueba, paso: 'El Juez está probando: Walk-Forward…' }, bots: { ...bots, bitacora: [{ t: t + 1, botId: 'a', nombre: 'Bot A', texto: 'Abre largo a 81.240', grave: false }, { t: t + 2, botId: 'a', nombre: 'Bot A', texto: 'Pérdida del día: pausado', grave: true }, ...bots.bitacora] } }));
    expect(ficha('juez').estado).toBe('trabajando');
    expect(ficha('programador').ahora).toMatch(/señal de 1 bots/);
    const radio = s.estado().notas.map((n) => [n.id, n.texto]);
    expect(radio).toEqual([['guardian', 'Bot A: Pérdida del día: pausado'], ['ejecutor', 'Bot A: Abre largo a 81.240']]);
    s.latir(lectura({ bots: { ...bots, apagado: true } }));
    expect(ficha('guardian').estado).toBe('alerta');
  });

  it('los trabajos propios van en fila, de uno en uno; pausar los detiene y correr los adelanta', async () => {
    const { s, ficha, avanzar } = sala();
    const orden: string[] = [];
    let soltar: () => void = () => undefined;
    s.tarea({ id: 'rastreador', nombre: 'Régimen de cada mercado', cadaMs: 60_000, correr: () => new Promise<string>((ok) => { soltar = () => { orden.push('rastreador'); ok('Régimen listo.'); }; }) });
    s.tarea({ id: 'etiquetador', nombre: 'Etiquetas de la noche', cadaMs: 60_000, correr: async () => (orden.push('etiquetador'), 'Etiquetas listas.') });
    avanzar(60_000);
    s.latir(lectura());
    expect(ficha('rastreador').estado).toBe('trabajando');
    expect(ficha('etiquetador').ahora).toMatch(/en fila/);
    expect(s.estado().fila.actual?.id).toBe('rastreador');
    soltar();
    await esperar();
    await esperar();
    expect(orden).toEqual(['rastreador', 'etiquetador']);
    expect(s.estado().notas.map((n) => n.texto).slice(0, 2)).toEqual(['Etiquetas listas.', 'Régimen listo.']);
    await s.accion('pausar', { id: 'etiquetador' });
    avanzar(120_000);
    s.latir(lectura());
    expect(ficha('etiquetador').estado).toBe('pausado');
    expect(ficha('etiquetador').acciones).toEqual(['reanudar', 'correr']);
    await expect(s.accion('correr', { id: 'lector' })).rejects.toThrow(/fase A3/);
  });

  it('la radio y la actividad sobreviven a un reinicio del VPS', () => {
    const { s, datos } = sala();
    s.latir(lectura());
    s.latir(lectura({ mercados: [mercado('BTCUSDT', 'error'), mercado('XAUUSDT')] }));
    s.guardar();
    const otra = crearSala({ datos, recursos: () => RECURSOS });
    expect(otra.estado().notas[0].texto).toBe('BTCUSDT: en-vivo → error');
    expect(otra.estado().recursos.memTotal).toBe(4e9);
  });
});
