import { describe, expect, it } from 'vitest';
import { lecturaDe } from './lectura';
import type { EstadoFeed } from '../worker/protocolo';

const AHORA = 1_000_000_000;
const feed = (resumen: Partial<EstadoFeed['resumen']>, extra: Partial<EstadoFeed> = {}) =>
  ({
    simbolo: 'BTCUSDT',
    conexion: 'en-vivo',
    detalle: '',
    memoria: null,
    resumen: { precio: 100, vwap: 99, absorcion: null, agotamiento: null, liqLargosUsd: 0, liqCortosUsd: 0, stopRuns: 0, icebergs: 0, barrasFlujo: [], ...resumen },
    ...extra,
  }) as unknown as EstadoFeed;
const compras = Array.from({ length: 5 }, () => ({ compra: 80, venta: 20 }));

describe('lecturaDe', () => {
  it('sin conexión no inventa nada', () => {
    expect(lecturaDe(feed({}, { conexion: 'reconectando' }), AHORA).titular).toBe('Sin datos en vivo');
  });

  it('presión compradora', () => {
    const l = lecturaDe(feed({ barrasFlujo: compras }), AHORA);
    expect(l.titular).toBe('Mandan los compradores');
    expect(l.sesgo).toBe(1);
    expect(l.motivos).toContain('Precio sobre el VWAP');
  });

  it('compras frenadas por absorción en el ask', () => {
    const l = lecturaDe(feed({ barrasFlujo: compras, absorcion: { lado: 'ask', score: 80, t: AHORA - 10_000 }, liqLargosUsd: 5e6 }), AHORA);
    expect(l.titular).toBe('Compran, pero los frenan arriba');
    expect(l.sesgo).toBe(-1);
  });

  it('ignora señales viejas', () => {
    const l = lecturaDe(feed({ barrasFlujo: compras, absorcion: { lado: 'ask', score: 80, t: AHORA - 3_600_000 } }), AHORA);
    expect(l.titular).toBe('Mandan los compradores');
  });
});
