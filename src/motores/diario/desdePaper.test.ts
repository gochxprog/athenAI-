import { describe, expect, it } from 'vitest';
import { fichaDeOperacion } from './desdePaper';
import { resultadoR, resumirDiario } from './diario';
import type { Bot, OperacionPaper } from '../paper/ejecutor';

const op = (extra: Partial<OperacionPaper> = {}): OperacionPaper => ({
  id: 1, botId: 'manual:binance:BTCUSDT', simbolo: 'BTCUSDT', lado: 1, entradaT: Date.UTC(2026, 9, 20, 10), salidaT: Date.UTC(2026, 9, 20, 11),
  precioEntrada: 100, precioSalida: 110, cantidad: 2, nocional: 200, comisiones: 1, deslizamientoUsd: 0.2, funding: 0.5, pnl: 18.5, retorno: 0.00185, retornoUnidad: 0.00185, motivo: 'objetivo',
  gestion: { stopInicial: 95, objetivo: 110, riesgo: 5, r: 2, mfe: 2, mae: -0.3, movimientos: [] },
  ...extra,
});
const manual = { origen: 'manual', mercado: 'binance:BTCUSDT', capitalInicial: 10_000 } as unknown as Bot;

describe('Diario desde las operaciones de Paper', () => {
  it('con stop: R = P&L de precio / riesgo; el capital de entrada sale del retorno', () => {
    const f = fichaDeOperacion(op(), manual);
    expect(f.origen).toBe('manual');
    expect(f.pnlPrecio).toBe(20);
    expect(f.riesgoUsd).toBe(10);
    expect(resultadoR(f)).toBe(2);
    expect(f.capitalEntrada).toBeCloseTo(10_000, 6);
    expect(f.rr).toBe(2);
    expect(f.salida?.motivo).toBe('objetivo');
  });

  it('sin stop (bot de señal): sin R, pero cuenta en el calendario', () => {
    const f = fichaDeOperacion(op({ gestion: undefined, motivo: 'senal', botId: 'b1' }), { origen: undefined, nombre: 'Absorción', mercado: 'binance:BTCUSDT', capitalInicial: 10_000 } as unknown as Bot);
    expect(resultadoR(f)).toBeNull();
    expect(f.estrategia).toBe('Absorción');
    const r = resumirDiario([f]);
    expect(r.dias[0].pnl).toBeCloseTo(18.5, 9);
    expect(r.metricas.esperanzaR).toBeNull();
  });
});
