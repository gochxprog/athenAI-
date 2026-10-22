import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AlmacenDisco } from './almacenDisco';
import { etiquetarHistoria, rastrear } from './trabajosVps';
import { parametrosPorDefecto } from '../src/motores/nucleo/parametros';
import { etiquetar } from '../src/motores/etiquetador/etiquetador';
import type { FilaFeatures } from '../src/motores/nucleo/features';

const carpetas: string[] = [];
const temporal = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'trab-'));
  carpetas.push(d);
  return d;
};
afterEach(() => carpetas.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** Una fila por minuto con un paseo de precio determinista (solo para probar la tubería, no el edge). */
function filas(desde: number, n: number): FilaFeatures[] {
  let p = 100;
  return Array.from({ length: n }, (_, i) => {
    const r = Math.sin(i / 7) * 0.004 + Math.sin(i / 53) * 0.006;
    const o = p;
    p *= 1 + r;
    return { n: i, inicio: desde + i * 60_000, cierre: desde + i * 60_000 + 59_000, open: o, high: Math.max(o, p) * 1.001, low: Math.min(o, p) * 0.999, close: p, volumen: 5, delta: r * 100, valores: { hueco: 0, flujo_5_ratio: Math.sin(i / 11) } };
  });
}

function grabar(datos: string, simbolo: string, xs: FilaFeatures[]) {
  const a = new AlmacenDisco(datos);
  a.nuevaSesion(simbolo, parametrosPorDefecto(simbolo), xs[0].inicio, 1);
  a.guardar(simbolo, 1, xs);
  a.vaciar();
}

describe('Etiquetador con barreras en ATR', () => {
  it('mide objetivo y stop en ATR del momento del evento', () => {
    const xs = filas(0, 3_000);
    const r = etiquetar(xs, { pt: 2, sl: 1.5, tMax: 60, medida: 'atr' });
    expect(r.etiquetas.length).toBeGreaterThan(10);
    const e = r.etiquetas[5];
    // superior − precio = 2 × ATR; precio − inferior = 1,5 × ATR (el mismo ATR relativo).
    expect((e.superior / e.precio - 1) / (1 - e.inferior / e.precio)).toBeCloseTo(2 / 1.5, 6);
  });
});

describe('Trabajos de los agentes en el VPS', () => {
  it('Etiquetador: un CSV por mes con el market_id y las Features; los meses viejos no se repiten', () => {
    const datos = temporal();
    // Dos meses enteros de historia importada (agosto y septiembre de 2026).
    grabar(path.join(datos, 'historia'), 'BTCUSDT', filas(Date.UTC(2026, 7, 1), 61 * 1_440));
    const r = etiquetarHistoria(datos, ['BTCUSDT']);
    expect(r.texto).toMatch(/BTC: 2 meses etiquetados/);
    const dir = path.join(datos, 'ml', 'etiquetas', 'btcusdt');
    expect(fs.readdirSync(dir).sort()).toEqual(['2026-08.csv', '2026-09.csv']);
    const csv = fs.readFileSync(path.join(dir, '2026-08.csv'), 'utf8').split('\n');
    expect(csv[0]).toMatch(/^market_id,evento_inicio,.*,flujo_5_ratio/);
    expect(csv.length).toBeGreaterThan(20);
    expect(csv.slice(1).every((l) => l.startsWith('binance:BTCUSDT,2026-08'))).toBe(true);
    // Agosto ya está y no es el mes actual ni el anterior: la segunda vez no se toca.
    const antes = fs.statSync(path.join(dir, '2026-08.csv')).mtimeMs;
    etiquetarHistoria(datos, ['BTCUSDT']);
    expect(fs.statSync(path.join(dir, '2026-08.csv')).mtimeMs).toBe(antes);
  });

  it('Rastreador: deja el estado de cada mercado en disco y avisa si faltan datos', () => {
    const datos = temporal();
    grabar(datos, 'BTCUSDT', filas(Date.UTC(2026, 9, 20), 300));
    const r = rastrear(datos, ['BTCUSDT']);
    expect(r.texto).toMatch(/BTC: faltan datos \(300 filas\)/);
    const x = JSON.parse(fs.readFileSync(path.join(datos, 'agentes', 'rastreador.json'), 'utf8'));
    expect(x.BTCUSDT.filas).toBe(300);
    expect(x.BTCUSDT.regimen).toBeNull();
  });
});
