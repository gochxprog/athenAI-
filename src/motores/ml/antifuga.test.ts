// Pruebas anti-fuga antes del primer modelo (sin modelos: solo el dataset y su partición en el tiempo).
import { describe, expect, it } from 'vitest';
import { columnasEntrada, COLUMNAS_RESPUESTA, leerCsv, verificarDataset, walkForwardPurgado, type Muestra } from './antifuga';
import { datasetCsv, etiquetar } from '../etiquetador/etiquetador';
import { DEFINICIONES_FEATURES } from '../nucleo/features';
import { crearAleatorio, normal } from '@/lib/random';

const MIN = 60_000;

/** Serie de prueba (solo para verificar): paseo aleatorio con Features que solo miran el pasado. */
function serie(n: number, semilla = 7) {
  const r = crearAleatorio(semilla);
  const filas: { n: number; inicio: number; cierre: number; close: number; high: number; low: number; open: number; volumen: number; delta: number; valores: Record<string, number | null> }[] = [];
  let c = 100;
  for (let i = 0; i < n; i += 1) {
    const previo = c;
    c *= 1 + normal(r) * 0.003;
    const ret = c / previo - 1;
    // Features causales: retorno de la barra y media de los 5 retornos anteriores (conocidos al cierre).
    const media5 = i >= 5 ? (filas.slice(-5).reduce((a, f) => a + (f.valores.retorno ?? 0), 0) / 5) : null;
    filas.push({ n: i, inicio: i * MIN, cierre: (i + 1) * MIN, close: c, high: c * 1.001, low: c * 0.999, open: previo, volumen: 10, delta: 1, valores: { retorno: ret, media5, hueco: 0 } });
  }
  return filas;
}
const CFG = { pt: 2, sl: 2, tMax: 20, cusumMult: 1, span: 50 };

describe('Columnas del dataset: la respuesta nunca es entrada', () => {
  it('las columnas de la respuesta y la identidad quedan fuera de las entradas', () => {
    const cab = ['market_id', 'evento_inicio', 'evento_fin', 'evento_lado', 'evento_precio', 'evento_sigma', 'evento_barrera', 'etiqueta', 'meta', 'evento_retorno', 'evento_barras', 'delta_z', 'obi_10'];
    expect(columnasEntrada(cab)).toEqual(['evento_lado', 'evento_sigma', 'delta_z', 'obi_10']);
  });

  it('ninguna Feature del catálogo se llama como una columna de la respuesta o de identidad', () => {
    const prohibidas = new Set<string>([...COLUMNAS_RESPUESTA, 'market_id', 'evento_inicio', 'evento_precio']);
    for (const d of DEFINICIONES_FEATURES) expect(prohibidas.has(d.clave)).toBe(false);
  });

  it('apertura, volumen y delta de la vela (para dibujar) NO entran al dataset: solo las Features', () => {
    const filas = serie(800);
    const r = etiquetar(filas, CFG);
    const { cabecera } = leerCsv(datasetCsv(filas, r, 'binance:BTCUSDT'));
    for (const c of ['open', 'volumen', 'delta', 'close', 'high', 'low']) expect(cabecera).not.toContain(c);
  });
});

describe('Dataset del Etiquetador listo para entrenar', () => {
  const filas = serie(1_500);
  const r = etiquetar(filas, CFG);
  const csv = datasetCsv(filas, r, 'binance:BTCUSDT');

  it('pasa la verificación: un mercado, orden cronológico, fin > inicio y sin columnas sospechosas', () => {
    const v = verificarDataset(csv);
    expect(r.etiquetas.length).toBeGreaterThan(30);
    expect(v.problemas).toEqual([]);
    expect(v).toMatchObject({ ok: true, mercado: 'binance:BTCUSDT', filas: r.etiquetas.length });
    expect(v.entradas).toEqual(['evento_lado', 'evento_sigma', 'retorno', 'media5', 'hueco']);
  });

  it('las Features de cada fila son las de la barra t₀ (la de la decisión), no las de después', () => {
    const { filas: ds } = leerCsv(csv);
    r.etiquetas.forEach((e, i) => {
      expect(Number(ds[i].retorno)).toBe(filas[e.t0].valores.retorno);
      expect(Date.parse(ds[i].evento_inicio)).toBe(filas[e.t0].cierre);
    });
  });

  it('cortar la historia no cambia las filas cuyo resultado ya se conocía (Features y etiqueta idénticas)', () => {
    const corte = 900;
    const csvCorto = datasetCsv(filas.slice(0, corte), etiquetar(filas.slice(0, corte), CFG), 'binance:BTCUSDT');
    const largo = leerCsv(csv).filas;
    const corto = leerCsv(csvCorto).filas;
    const limite = filas[corte - 1].cierre;
    const cerradas = largo.filter((f) => Date.parse(f.evento_fin) <= limite);
    expect(cerradas.length).toBeGreaterThan(10);
    for (const f of cerradas) expect(corto.find((x) => x.evento_inicio === f.evento_inicio)).toEqual(f);
  });

  it('detecta una fuga plantada: una columna copiada de la etiqueta', () => {
    const { cabecera, filas: ds } = leerCsv(csv);
    const trampa = [[...cabecera, 'pista'].join(','), ...ds.map((f) => [...cabecera.map((c) => f[c]), f.etiqueta].join(','))].join('\n');
    const v = verificarDataset(trampa);
    expect(v.ok).toBe(false);
    expect(v.problemas.some((p) => p.includes('«pista»') && p.includes('posible fuga'))).toBe(true);
  });

  it('detecta mercados mezclados, desorden y respuestas imposibles', () => {
    const { cabecera, filas: ds } = leerCsv(csv);
    const armar = (xs: typeof ds) => [cabecera.join(','), ...xs.map((f) => cabecera.map((c) => f[c]).join(','))].join('\n');
    expect(verificarDataset(armar([...ds.slice(0, 20), ...ds.slice(20, 40).map((f) => ({ ...f, market_id: 'binance:XAUUSDT' }))])).problemas[0]).toMatch(/Mezcla 2 mercados/);
    expect(verificarDataset(armar([ds[1], ds[0], ...ds.slice(2)])).problemas[0]).toMatch(/orden cronológico/);
    expect(verificarDataset(armar([{ ...ds[0], evento_fin: ds[0].evento_inicio }, ...ds.slice(1)])).problemas[0]).toMatch(/evento_fin no es posterior/);
  });
});

describe('Walk-forward purgado con embargo (sin barajar)', () => {
  it('ejemplo a mano: se purgan los eventos cuyo resultado se solapa con la prueba', () => {
    // 10 eventos cada 10 min; cada respuesta tarda 25 min.
    const m: Muestra[] = Array.from({ length: 10 }, (_, i) => ({ inicio: i * 10 * MIN, fin: i * 10 * MIN + 25 * MIN }));
    const p = walkForwardPurgado(m, { tramos: 2, fraccionInicial: 0.4, embargoMs: 0 });
    // Prueba 1 = eventos 4–6 (empieza a los 40 min). Entrena con fin < 40: eventos 0 (25) y 1 (35). El 2 (45) y 3 (55) se purgan.
    expect(p[0]).toEqual({ entreno: [0, 1], prueba: [4, 5, 6] });
    // Prueba 2 = eventos 7–9 (empieza a los 70). Entrena con fin < 70: eventos 0–4 (fin 65). 5 y 6 se purgan.
    expect(p[1]).toEqual({ entreno: [0, 1, 2, 3, 4], prueba: [7, 8, 9] });
    // Con 10 min de embargo: fin + 10 < inicio de la prueba.
    expect(walkForwardPurgado(m, { tramos: 2, fraccionInicial: 0.4, embargoMs: 10 * MIN })[1].entreno).toEqual([0, 1, 2, 3]);
  });

  it('con el dataset real: ningún ejemplo de entreno es posterior a la prueba ni conoce su resultado durante ella', () => {
    const filas = serie(1_500, 11);
    const ds = leerCsv(datasetCsv(filas, etiquetar(filas, CFG), 'binance:BTCUSDT')).filas;
    const m = ds.map((f) => ({ inicio: Date.parse(f.evento_inicio), fin: Date.parse(f.evento_fin) }));
    const embargo = 20 * MIN;
    const ps = walkForwardPurgado(m, { tramos: 5, embargoMs: embargo });
    expect(ps).toHaveLength(5);
    const vistas = new Set<number>();
    for (const p of ps) {
      const t = m[p.prueba[0]].inicio;
      for (const i of p.entreno) {
        expect(m[i].inicio).toBeLessThan(t);
        expect(m[i].fin + embargo).toBeLessThan(t);
        expect(p.prueba).not.toContain(i);
      }
      for (const j of p.prueba) {
        expect(vistas.has(j)).toBe(false); // cada evento se prueba una sola vez
        vistas.add(j);
      }
    }
  });

  it('rechaza muestras desordenadas (nunca se baraja)', () => {
    expect(() => walkForwardPurgado([{ inicio: 2, fin: 3 }, { inicio: 1, fin: 2 }], { tramos: 1 })).toThrow(/orden cronológico/);
  });
});
