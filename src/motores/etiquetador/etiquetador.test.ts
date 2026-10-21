// Verificación del motor Etiquetador (triple barrera + CUSUM + meta-etiquetado) con la especificación del usuario.
import { describe, expect, it } from 'vitest';
import { etiquetar, filtroCusum, tripleBarrera, volatilidadEwm, datasetCsv } from './etiquetador';
import { crearAleatorio, normal } from '@/lib/random';

const fila = (close: number, i: number, high = close, low = close) => ({ cierre: i * 60_000, close, high, low, valores: { delta: i } });
const C = { pt: 2, sl: 2, tMax: 5 };

describe('Etiquetador · triple barrera', () => {
  it('toca primero la superior: largo = +1 y meta = 1', () => {
    // P₀ = 100, σ = 1 % → superior 102, inferior 98.
    const filas = [fila(100, 0), fila(101, 1, 101.5, 100.5), fila(101, 2, 102.1, 100), fila(97, 3, 99, 97)];
    const e = tripleBarrera(filas, 0, 1, 0.01, C) as Exclude<ReturnType<typeof tripleBarrera>, 'hueco' | null>;
    expect(e.superior).toBeCloseTo(102, 10);
    expect(e.inferior).toBeCloseTo(98, 10);
    expect(e).toMatchObject({ barrera: 'superior', etiqueta: 1, meta: 1, t1: 2, barras: 2 });
    expect(e.retorno).toBeCloseTo(0.02, 10);
  });

  it('el mismo recorrido para un corto: tocar arriba es pérdida (−1, meta 0)', () => {
    const filas = [fila(100, 0), fila(101, 1, 102.5, 100)];
    const e = tripleBarrera(filas, 0, -1, 0.01, { ...C, tMax: 1 }) as Exclude<ReturnType<typeof tripleBarrera>, 'hueco' | null>;
    expect(e).toMatchObject({ barrera: 'superior', etiqueta: -1, meta: 0 });
    expect(e.retorno).toBeCloseTo(-0.02, 10);
  });

  it('sin tocar ninguna en tMax barras: tiempo = 0; las dos en la misma barra = inferior (pesimista)', () => {
    const planas = Array.from({ length: 7 }, (_, i) => fila(100, i, 100.5, 99.5));
    const t = tripleBarrera(planas, 0, 1, 0.01, C) as Exclude<ReturnType<typeof tripleBarrera>, 'hueco' | null>;
    expect(t).toMatchObject({ barrera: 'tiempo', etiqueta: 0, meta: 0, t1: 5 });
    const ambas = [fila(100, 0), fila(100, 1, 103, 97)];
    expect(tripleBarrera(ambas, 0, 1, 0.01, { ...C, tMax: 1 })).toMatchObject({ barrera: 'inferior', etiqueta: -1 });
  });

  it('descarta eventos que cruzan un hueco o sin futuro suficiente', () => {
    const filas = Array.from({ length: 10 }, (_, i) => fila(100, i));
    const huecos = filas.map((_, i) => i === 3);
    expect(tripleBarrera(filas, 0, 1, 0.01, C, huecos)).toBe('hueco');
    expect(tripleBarrera(filas, 7, 1, 0.01, C)).toBeNull();
  });
});

describe('Etiquetador · CUSUM y volatilidad', () => {
  it('σ exponencial solo con el pasado (cambiar el futuro no cambia σ_t)', () => {
    const r = crearAleatorio(1);
    const c = [100];
    for (let i = 1; i < 300; i += 1) c.push(c[i - 1] * (1 + normal(r) * 0.01));
    const a = volatilidadEwm(c, 50).sigma;
    const otro = [...c.slice(0, 200), ...c.slice(200).map((x) => x * 1.5)];
    const b = volatilidadEwm(otro, 50).sigma;
    expect(b.slice(0, 200)).toEqual(a.slice(0, 200));
    expect(a[299]).toBeGreaterThan(0.007);
    expect(a[299]).toBeLessThan(0.013);
  });

  it('CUSUM: un mercado plano no dispara eventos; un salto sí, con su lado', () => {
    const sigma = new Array(40).fill(0.01);
    const media = new Array(40).fill(0);
    const plano = new Array(40).fill(100);
    expect(filtroCusum(plano, sigma, media, 1)).toEqual([]);
    // Subida de 0,4 % por barra: S⁺ supera 1 % en la 3.ª barra (0,4 + 0,4 + 0,4 = 1,2 %).
    const sube = plano.map((_, i) => 100 * 1.004 ** i);
    expect(filtroCusum(sube, sigma, media, 1)[0]).toEqual({ t: 3, lado: 1 });
    const baja = plano.map((_, i) => 100 * 0.996 ** i);
    expect(filtroCusum(baja, sigma, media, 1)[0]).toEqual({ t: 3, lado: -1 });
  });

  it('muestrea más cuando hay movimiento que cuando el mercado está quieto', () => {
    const r = crearAleatorio(2);
    const c = [100];
    for (let i = 1; i < 2_000; i += 1) c.push(c[i - 1] * (1 + normal(r) * (i < 1_000 ? 0.002 : 0.01)));
    const { sigma, mediaPrevia } = volatilidadEwm(c, 100);
    // Umbral fijo (σ de la parte quieta) para ver el efecto: la parte agitada genera muchos más eventos.
    const fijo = sigma.map(() => 0.004);
    const ev = filtroCusum(c, fijo, mediaPrevia, 1);
    expect(ev.filter((e) => e.t >= 1_000).length).toBeGreaterThan(3 * ev.filter((e) => e.t < 1_000).length);
  });
});

describe('Etiquetador · completo', () => {
  it('genera etiquetas coherentes, meta = 1 solo con etiqueta +1, y el dataset con las Features de t₀', () => {
    const r = crearAleatorio(3);
    const filas = [fila(100, 0)];
    for (let i = 1; i < 3_000; i += 1) {
      const c = filas[i - 1].close * (1 + normal(r) * 0.003);
      filas.push(fila(c, i, c * (1 + Math.abs(normal(r)) * 0.001), c * (1 - Math.abs(normal(r)) * 0.001)));
    }
    const res = etiquetar(filas, { tMax: 30 });
    expect(res.etiquetas.length).toBeGreaterThan(50);
    expect(res.conHighLow).toBe(true);
    for (const e of res.etiquetas) {
      expect(e.meta).toBe(e.etiqueta === 1 ? 1 : 0);
      expect(e.t1).toBeGreaterThan(e.t0);
      expect(e.t1 - e.t0).toBeLessThanOrEqual(30);
    }
    const { positivas, negativas, neutras } = res.resumen;
    expect(positivas + negativas + neutras).toBe(res.etiquetas.length);
    const csv = datasetCsv(filas, res).split('\n');
    expect(csv[0]).toBe('evento_inicio,evento_fin,evento_lado,evento_precio,evento_sigma,evento_barrera,etiqueta,meta,evento_retorno,evento_barras,delta');
    expect(csv).toHaveLength(res.etiquetas.length + 1);
    expect(csv[1].split(',')[10]).toBe(String(res.etiquetas[0].t0));
  });
});
