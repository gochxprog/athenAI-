import { describe, expect, it } from 'vitest';
import { pnlNeto, resultadoR, resumirDiario, type FichaOperacion } from './diario';

const H = 3_600_000;
let n = 0;
/** Ficha cerrada: riesgo 100 $, capital 10.000 $. */
function ficha(entradaT: number, salidaT: number, pnlPrecio: number, extra: Partial<FichaOperacion> = {}): FichaOperacion {
  n += 1;
  return {
    id: `f${n}`,
    origen: 'bot',
    botId: 'b1',
    estrategia: 'prueba',
    mercado: 'binance:BTCUSDT',
    lado: 1,
    entrada: { t: entradaT, precio: 100, motivo: '', senales: {} },
    stopInicial: 99,
    objetivo: 102,
    rr: 2,
    cantidad: 100,
    riesgoUsd: 100,
    riesgoPct: 0.01,
    capitalEntrada: 10_000,
    movimientosStop: [],
    salida: { t: salidaT, precio: 100 + pnlPrecio / 100, motivo: 'objetivo' },
    pnlPrecio,
    comisiones: 2,
    funding: 0,
    deslizamiento: 0,
    deslizamientoEsperado: 0,
    mfe: pnlPrecio > 0 ? 2 : 0.3,
    mae: -0.5,
    ...extra,
  };
}

// Lunes 19-oct-2026 00:00 UTC.
const LUNES = Date.UTC(2026, 9, 19);

describe('Diario de operaciones (calendario y métricas)', () => {
  it('P&L neto y R de una ficha', () => {
    const f = ficha(LUNES, LUNES + H, 200);
    expect(pnlNeto(f)).toBe(198);
    expect(resultadoR(f)).toBe(2);
  });

  it('agrupa por día, semana ISO (lunes a domingo) y mes, por la fecha de salida', () => {
    const fichas = [
      ficha(LUNES + 9 * H, LUNES + 10 * H, 200), // lunes 19: +198
      ficha(LUNES + 11 * H, LUNES + 12 * H, -100), // lunes 19: −102
      ficha(LUNES + 24 * H + 9 * H, LUNES + 24 * H + 10 * H, 300), // martes 20: +298
      ficha(LUNES + 6 * 24 * H + 9 * H, LUNES + 7 * 24 * H + 1 * H, -100), // sale el lunes 26: semana siguiente
    ];
    const r = resumirDiario(fichas);
    expect(r.dias.map((d) => [d.clave, d.pnl, d.operaciones])).toEqual([
      ['2026-10-19', 96, 2],
      ['2026-10-20', 298, 1],
      ['2026-10-26', -102, 1],
    ]);
    expect(r.semanas.map((s) => [s.clave, s.pnl])).toEqual([
      ['2026-W43', 394],
      ['2026-W44', -102],
    ]);
    expect(r.meses).toEqual([{ clave: '2026-10', pnl: 292, pct: expect.closeTo(292 / 10_000, 12), operaciones: 4, ganadoras: 2 }]);
  });

  it('el desfase horario mueve la operación al día local correcto', () => {
    // Sale el martes 20 a las 02:00 UTC → en Venezuela (UTC−4) todavía es lunes 19.
    const r = resumirDiario([ficha(LUNES + 24 * H, LUNES + 26 * H, 100)], -240);
    expect(r.dias[0].clave).toBe('2026-10-19');
    expect(r.metricas.porDiaSemana[0].operaciones).toBe(1);
    expect(r.metricas.porHora[20].operaciones).toBe(1); // entró a las 20:00 locales
  });

  it('métricas: aciertos, profit factor, esperanza en R, rachas, drawdown y largos/cortos', () => {
    const fichas = [
      ficha(LUNES, LUNES + H, 200),
      ficha(LUNES + 2 * H, LUNES + 3 * H, 200),
      ficha(LUNES + 4 * H, LUNES + 5 * H, -100, { lado: -1 }),
      ficha(LUNES + 6 * H, LUNES + 7 * H, -100),
      ficha(LUNES + 8 * H, LUNES + 9 * H, -100),
      ficha(LUNES + 10 * H, LUNES + 11 * H, 300),
      ficha(LUNES + 12 * H, LUNES + 13 * H, 0, { salida: null }), // abierta: no cuenta
    ];
    const m = resumirDiario(fichas).metricas;
    expect(m.operaciones).toBe(6);
    expect(m.aciertos).toBe(0.5);
    expect(m.gananciaBruta).toBe(198 + 198 + 298);
    expect(m.perdidaBruta).toBe(102 * 3);
    expect(m.profitFactor).toBeCloseTo(694 / 306, 10);
    expect(m.esperanzaR).toBeCloseTo((2 + 2 - 1 - 1 - 1 + 3) / 6, 10);
    expect(m.rachaGanadora).toBe(2);
    expect(m.rachaPerdedora).toBe(3);
    expect(m.maxDrawdown).toBe(306);
    expect(m.comisiones).toBe(12);
    expect(m.cortos).toEqual({ pnl: -102, operaciones: 1 });
    expect(m.llegaron1R).toBe(0.5);
    expect(m.mejorDia?.pnl).toBe(388);
  });

  it('sin operaciones no inventa nada', () => {
    const m = resumirDiario([]).metricas;
    expect(m.operaciones).toBe(0);
    expect(m.aciertos).toBeNull();
    expect(m.profitFactor).toBeNull();
    expect(m.mejorDia).toBeNull();
  });
});
