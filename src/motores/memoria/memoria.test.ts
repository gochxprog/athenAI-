import { describe, expect, it } from 'vitest';
import { entrenarHMM, filtrarHMM } from './hmm';
import { detectarRegimen, type NombreRegimen } from './regimen';
import { buscarMemoria } from './gemelos';
import type { FilaFeatures } from '../nucleo/features';
import { crearAleatorio, normal } from '@/lib/random';

/** Serie sintética con regímenes CONOCIDOS que cambian según una cadena de Markov. */
function serieConRegimenes(n: number, semilla = 3) {
  const r = crearAleatorio(semilla);
  const verdad: NombreRegimen[] = [];
  const filas: (FilaFeatures & { sesion: number })[] = [];
  let reg: NombreRegimen = 'rango';
  let dir = 1;
  let close = 100;
  for (let i = 0; i < n; i += 1) {
    const u = r();
    if (reg === 'rango' && u < 0.02) reg = r() < 0.8 ? 'tendencia' : 'raro';
    else if (reg === 'tendencia' && u < 0.025) reg = r() < 0.85 ? 'rango' : 'raro';
    else if (reg === 'raro' && u < 0.08) reg = 'rango';
    if (reg === 'tendencia' && u > 0.97) dir = -dir;
    let ret: number;
    let rango: number;
    let dur: number;
    let dr: number;
    if (reg === 'rango') {
      ret = normal(r) * 0.0008;
      rango = 0.8 * Math.exp(normal(r) * 0.15);
      dur = 60 * Math.exp(normal(r) * 0.2);
      dr = normal(r) * 0.1;
    } else if (reg === 'tendencia') {
      ret = dir * (0.0009 + Math.abs(normal(r)) * 0.0004);
      rango = 1.0 * Math.exp(normal(r) * 0.15);
      dur = 40 * Math.exp(normal(r) * 0.2);
      dr = dir * (0.3 + Math.abs(normal(r)) * 0.1);
    } else {
      ret = normal(r) * 0.004;
      rango = 2.6 * Math.exp(normal(r) * 0.15);
      dur = 6 * Math.exp(normal(r) * 0.3);
      dr = normal(r) * 0.4;
    }
    close *= 1 + ret;
    verdad.push(reg);
    filas.push({ n: i, inicio: i * 1000, cierre: i * 1000 + 999, close, sesion: 1, valores: { retorno: ret, rango_atr: rango, duracion_s: dur, delta_ratio: dr, hueco: 0 } });
  }
  return { filas, verdad };
}

describe('HMM gaussiano', () => {
  it('recupera dos estados bien separados y el filtro solo usa el pasado', () => {
    const r = crearAleatorio(1);
    const x: number[][] = [];
    for (let b = 0; b < 20; b += 1) for (let i = 0; i < 40; i += 1) x.push([b % 2 ? 4 + normal(r) * 0.5 : normal(r) * 0.5]);
    const m = entrenarHMM(x, 2, { semilla: 2 });
    const medias = m.medias.map((mu) => mu[0]).sort((a, b) => a - b);
    expect(medias[0]).toBeCloseTo(0, 0);
    expect(medias[1]).toBeCloseTo(4, 0);
    expect(m.a[0][0]).toBeGreaterThan(0.9);
    const p1 = filtrarHMM(m, x.slice(0, 300));
    const p2 = filtrarHMM(m, x);
    expect(p2.slice(0, 300)).toEqual(p1);
  });
});

describe('Detector de régimen', () => {
  it('no arranca con pocos datos', () => {
    expect(detectarRegimen(serieConRegimenes(200).filas)).toBeNull();
  });

  it('identifica rango, tendencia y día raro y lo valida fuera de muestra', () => {
    const { filas, verdad } = serieConRegimenes(4000);
    const res = detectarRegimen(filas)!;
    expect(res).not.toBeNull();
    // Coincidencia con la verdad en las últimas 120 barras (historia filtrada, sin futuro).
    const v = verdad.slice(-120);
    const aciertos = res.historia.filter((h, i) => h === v[i]).length / res.historia.length;
    expect(aciertos).toBeGreaterThan(0.75);
    expect(res.validacion.util).toBe(true);
    expect(res.validacion.eficienciaFutura.tendencia!).toBeGreaterThan(res.validacion.eficienciaFutura.rango!);
    expect(res.validacion.persistencia).toBeGreaterThan(3);
    const total = Object.values(res.probabilidades).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('con ruido puro no se declara útil', () => {
    const r = crearAleatorio(9);
    const filas: FilaFeatures[] = Array.from({ length: 3000 }, (_, i) => ({ n: i, inicio: i, cierre: i, close: 100, valores: { retorno: normal(r) * 0.001, rango_atr: Math.exp(normal(r) * 0.2), duracion_s: 30 * Math.exp(normal(r) * 0.2), delta_ratio: normal(r) * 0.2, hueco: 0 } }));
    const res = detectarRegimen(filas)!;
    expect(res.validacion.util).toBe(false);
  });
});

describe('Memoria: día gemelo y "hoy es distinto"', () => {
  it('encuentra gemelos con su futuro y no avisa en un momento normal', () => {
    const { filas } = serieConRegimenes(3000, 5);
    const res = buscarMemoria(filas)!;
    expect(res.gemelos.length).toBe(8);
    for (const g of res.gemelos) {
      expect(g.maxSubida).toBeGreaterThanOrEqual(g.retorno);
      expect(g.maxBajada).toBeLessThanOrEqual(g.retorno);
      expect(g.cierre).toBeLessThan(filas[filas.length - 1].cierre - 20 * 1000);
    }
    // Gemelos separados entre sí al menos una ventana.
    const cierres = res.gemelos.map((g) => g.cierre).sort((a, b) => a - b);
    for (let i = 1; i < cierres.length; i += 1) expect(cierres[i] - cierres[i - 1]).toBeGreaterThanOrEqual(20 * 1000);
    expect(res.distinto.aviso).toBe(false);
  });

  it('avisa cuando lo de ahora no se parece a nada grabado', () => {
    const { filas } = serieConRegimenes(3000, 6);
    for (let i = filas.length - 20; i < filas.length; i += 1) {
      filas[i].valores = { ...filas[i].valores, rango_atr: 9, duracion_s: 0.3, liq_largos_usd: 5e7, retorno: -0.01, delta_ratio: -0.9 };
    }
    const res = buscarMemoria(filas)!;
    expect(res.distinto.aviso).toBe(true);
    expect(res.distinto.percentil).toBeGreaterThanOrEqual(0.98);
  });

  it('no mezcla sesiones ni huecos en una ventana', () => {
    const { filas } = serieConRegimenes(1000, 7);
    filas[filas.length - 5].valores.hueco = 1;
    expect(buscarMemoria(filas)).toBeNull();
  });
});
