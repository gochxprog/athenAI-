import { describe, expect, it } from 'vitest';
import { anteponer, pedirKlines, unirConVivo, velasDeFilas, velasDeKlines, type KlineBinance } from './historial';
import type { BarraGrafico } from '@/motores/nucleo/pipeline';

const DIA = Date.UTC(2026, 9, 21);
const k = (t: number, o: number, h: number, l: number, c: number, v: number, compra: number): KlineBinance => [t, String(o), String(h), String(l), String(c), String(v), t + 59_999, '0', 10, String(compra), '0', '0'];
const viva = (t: number, c: number, d: number, cvd: number): BarraGrafico => ({ n: 1, t, fin: t + 60_000, o: c, h: c, l: c, c, v: Math.abs(d), d, poc: null, completa: true, absorcion: [], agotamiento: null, cvd, oi: null });

describe('Historial del gráfico', () => {
  it('klines → velas: delta = 2 × compra agresiva − volumen y CVD diario (a mano)', () => {
    const vs = velasDeKlines([k(DIA, 100, 105, 99, 104, 10, 7), k(DIA + 60_000, 104, 106, 103, 103, 4, 1)], DIA + 90_000);
    expect(vs.map((b) => [b.o, b.h, b.l, b.c, b.v])).toEqual([[100, 105, 99, 104, 10], [104, 106, 103, 103, 4]]);
    expect(vs.map((b) => b.d)).toEqual([4, -2]); // 2·7 − 10 = 4 ; 2·1 − 4 = −2
    expect(vs.map((b) => b.cvd)).toEqual([4, 2]);
    expect(vs.map((b) => b.completa)).toEqual([true, false]); // la segunda cierra en DIA+119.999 > ahora
  });

  it('el CVD se reinicia a las 00:00 UTC, como en vivo', () => {
    const vs = velasDeKlines([k(DIA - 60_000, 1, 1, 1, 1, 10, 8), k(DIA, 1, 1, 1, 1, 10, 6)]);
    expect(vs.map((b) => b.cvd)).toEqual([6, 2]);
  });

  it('filas grabadas → velas: apertura de la fila, de retorno o del cierre anterior; sin volumen si no se grabó', () => {
    const vs = velasDeFilas([
      { n: 1, inicio: DIA, cierre: DIA + 5_000, close: 110, high: 112, low: 99, valores: { retorno: 0.1 } },
      { n: 2, inicio: DIA + 5_000, cierre: DIA + 9_000, close: 108, valores: {} },
      { n: 3, inicio: DIA + 9_000, cierre: DIA + 12_000, close: 109, high: 110, low: 107, open: 108.5, volumen: 3, delta: -1, valores: {} },
    ]);
    expect(vs[0].o).toBeCloseTo(100, 12); // 110 / 1,1
    expect([vs[0].h, vs[0].l]).toEqual([112, 99]);
    expect([vs[1].o, vs[1].h, vs[1].l]).toEqual([110, 110, 108]); // sin high/low: el rango de apertura y cierre
    expect([vs[2].o, vs[2].v, vs[2].d, vs[2].cvd]).toEqual([108.5, 3, -1, -1]);
    expect(vs.map((b) => b.fin)).toEqual([DIA + 5_000, DIA + 9_000, DIA + 12_000]);
  });

  it('une con lo vivo: lo vivo manda y el CVD vivo sigue desde el del historial (mismo día)', () => {
    const hist = velasDeKlines([k(DIA, 1, 1, 1, 1, 10, 8), k(DIA + 60_000, 1, 1, 1, 1, 10, 8), k(DIA + 120_000, 1, 1, 1, 1, 10, 8)]);
    // El vivo empezó a mitad de la 3.ª vela: su CVD arranca en 0.
    const vivas = [viva(DIA + 120_000, 2, 1, 1), viva(DIA + 180_000, 3, 2, 3)];
    const u = unirConVivo(hist, vivas);
    expect(u.map((b) => b.t)).toEqual([DIA, DIA + 60_000, DIA + 120_000, DIA + 180_000]);
    expect(u[2].c).toBe(2); // la vela viva reemplaza a la histórica del mismo minuto
    expect(u.map((b) => b.cvd)).toEqual([6, 12, 13, 15]); // 12 + (1) ; 12 + (1 + 2)
    expect(vivas[0].cvd).toBe(1); // no modifica lo que llegó del motor
  });

  it('anteponer no repite velas y recalcula el CVD', () => {
    const a = velasDeKlines([k(DIA, 1, 1, 1, 1, 2, 2), k(DIA + 60_000, 1, 1, 1, 1, 2, 2)]);
    const b = velasDeKlines([k(DIA + 60_000, 1, 1, 1, 1, 2, 2), k(DIA + 120_000, 1, 1, 1, 1, 2, 2)]);
    const u = anteponer(a, b);
    expect(u.map((x) => x.t)).toEqual([DIA, DIA + 60_000, DIA + 120_000]);
    expect(u.map((x) => x.cvd)).toEqual([2, 4, 6]);
  });

  it('pide a Binance la URL correcta (endTime para ir hacia atrás) y falla claro si no responde', async () => {
    const urls: string[] = [];
    const ok = (async (u: string) => (urls.push(u), { ok: true, json: async () => [k(DIA, 1, 1, 1, 1, 1, 1)] })) as unknown as typeof fetch;
    expect(await pedirKlines('https://fapi.binance.com/', 'BTCUSDT', '5m', DIA, 2000, ok)).toHaveLength(1);
    expect(urls[0]).toBe(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=1500&endTime=${DIA}`);
    const mal = (async () => ({ ok: false, status: 451, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(pedirKlines('x', 'BTCUSDT', '1m', null, 10, mal)).rejects.toThrow(/451/);
  });
});
