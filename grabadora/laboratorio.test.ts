import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { AlmacenDisco } from './almacenDisco';
import { cargarVelas, correrPrueba, crearLaboratorio, type Trabajo } from './laboratorioVps';
import { parametrosPorDefecto } from '../src/motores/nucleo/parametros';
import type { PyodideMinimo } from '../src/motores/laboratorio/python';
import type { FilaFeatures } from '../src/motores/nucleo/features';

const carpetas: string[] = [];
const temporal = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'));
  carpetas.push(d);
  return d;
};
afterEach(() => carpetas.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const T0 = Date.UTC(2026, 6, 1);
// Una fila por minuto con una tendencia y una oscilación (la estrategia de prueba la sigue).
const fila = (i: number): FilaFeatures => {
  const c = 60_000 + i * 2 + Math.sin(i / 7) * 40;
  return { n: i, inicio: T0 + i * 60_000, cierre: T0 + i * 60_000 + 59_000, open: c - 3, high: c + 8, low: c - 8, close: c, volumen: 5, delta: Math.sin(i / 7), valores: { flujo_5_ratio: Math.cos(i / 7), hueco: 0 } };
};
const grabar = (dir: string, desde: number, hasta: number, sesion: number) => {
  const a = new AlmacenDisco(dir);
  a.nuevaSesion('BTCUSDT', parametrosPorDefecto(), T0, sesion);
  a.guardar('BTCUSDT', sesion, Array.from({ length: hasta - desde }, (_, k) => fila(desde + k)));
  a.vaciar();
};

describe('Laboratorio en el VPS', () => {
  let py: PyodideMinimo;
  beforeAll(async () => {
    py = (await loadPyodide({ indexURL: fileURLToPath(new URL('../node_modules/pyodide/', import.meta.url)) })) as unknown as PyodideMinimo;
  }, 60_000);

  it('carga la historia y después lo grabado desde donde termina la historia, sin repetir', () => {
    const datos = temporal();
    grabar(path.join(datos, 'historia'), 0, 3_000, 1);
    grabar(datos, 2_500, 4_000, 2); // se pisa 500 filas con la historia
    const v = cargarVelas(datos, 'BTCUSDT', '1m', 'todo');
    expect(v).toHaveLength(4_000);
    expect(v.every((x, i) => i === 0 || x.cierre > v[i - 1].cierre)).toBe(true);
    expect(cargarVelas(datos, 'BTCUSDT', '1m', 'grabado')).toHaveLength(1_500);
    expect(cargarVelas(datos, 'BTCUSDT', '15m', 'historia')).toHaveLength(200);
  });

  it('corre la prueba completa: estrategia con GESTION, anti-futuro y Juez sobre velas de 5 min', () => {
    const datos = temporal();
    grabar(datos, 0, 12_000, 1);
    const codigo = `
GESTION = {"stopAtr": 2, "rr": 1.5, "gestion": "be1R"}
PARAMETROS = {"lado": [1, -1]}

def estrategia(filas, p):
    return [p["lado"] if f["flujo_5_ratio"] > 0 and f["close"] > f["open"] else 0 for f in filas]
`;
    const pasos: string[] = [];
    const r = correrPrueba({ codigo, simbolo: 'BTCUSDT', serie: '5m', fuente: 'todo' }, datos, py, (t) => pasos.push(t));
    expect(r.velas).toMatchObject({ total: 2_400, serie: '5m' });
    expect(r.gestion).toEqual({ stopAtr: 2, rr: 1.5, gestion: 'be1R' });
    expect(r.combos).toHaveLength(2);
    expect(r.juez.mercado).toBe('binance:BTCUSDT');
    expect(r.juez.antiFuturo?.ok).toBe(true);
    // Con GESTION, las operaciones las cierra el motor de salidas (traen su motivo: stop, objetivo, break-even…).
    expect(r.juez.operacionesOos.length).toBeGreaterThan(0);
    expect(r.juez.operacionesOos.every((o) => 'motivo' in o)).toBe(true);
    expect(pasos.some((p) => p.includes('Juez'))).toBe(true);
  }, 120_000);

  it('errores claros: pocos datos y fallos del código', () => {
    const datos = temporal();
    grabar(datos, 0, 100, 1);
    expect(() => correrPrueba({ codigo: 'def estrategia(f, p): return []', simbolo: 'BTCUSDT', serie: '1m', fuente: 'todo' }, datos, py, () => undefined)).toThrow(/al menos 300/);
    grabar(datos, 100, 2_000, 2);
    expect(() => correrPrueba({ codigo: 'def estrategia(f, p):\n    return 1 / 0', simbolo: 'BTCUSDT', serie: '1m', fuente: 'todo' }, datos, py, () => undefined)).toThrow(/Error en tu código[\s\S]*ZeroDivisionError/);
  }, 60_000);

  it('una prueba a la vez, con sus pasos, su resultado y la opción de cancelar', async () => {
    const hijos: (EventEmitter & { send: (m: unknown) => void; kill: () => void; recibido?: unknown; muerto?: boolean })[] = [];
    const lab = crearLaboratorio({
      datos: '/no',
      pyodide: null,
      lanzar: () => {
        const h = Object.assign(new EventEmitter(), { send(m: unknown) { h.recibido = m; }, kill() { h.muerto = true; } }) as (typeof hijos)[number];
        hijos.push(h);
        return h as unknown as ChildProcess;
      },
    });
    await expect(lab.accion('probar', { codigo: '', simbolo: 'BTCUSDT' })).rejects.toThrow(/Falta el código/);
    const { id } = (await lab.accion('probar', { codigo: 'x', simbolo: 'btcusdt', serie: '15m', nombre: 'Mi idea' })) as { id: string };
    expect(hijos[0].recibido).toMatchObject({ pedido: { codigo: 'x', simbolo: 'BTCUSDT', serie: '15m', fuente: 'todo' } });
    await expect(lab.accion('probar', { codigo: 'y', simbolo: 'BTCUSDT' })).rejects.toThrow(/Ya hay una prueba/);
    hijos[0].emit('message', { tipo: 'paso', texto: 'Armando velas…' });
    hijos[0].emit('message', { tipo: 'listo', resultado: { juez: { veredicto: 'RECHAZADA' } } });
    const t = lab.trabajo(id) as Trabajo;
    expect(t).toMatchObject({ estado: 'listo', pasos: ['Armando velas…'], pedido: { nombre: 'Mi idea' } });
    expect(t.pedido).not.toHaveProperty('codigo');
    expect(hijos[0].muerto).toBe(true);
    // Libre otra vez; y una prueba cancelada termina con su motivo.
    const otra = (await lab.accion('probar', { codigo: 'z', simbolo: 'BTCUSDT' })) as { id: string };
    await lab.accion('cancelar', { id: otra.id });
    expect(lab.trabajo(otra.id)).toMatchObject({ estado: 'error', error: 'Cancelada.' });
    expect(lab.trabajo('nada')).toEqual({ error: 'No existe esa prueba.' });
  });
});
