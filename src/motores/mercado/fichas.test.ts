import { describe, expect, it } from 'vitest';
import { contratosDe, fichaDe, riesgoPorContrato, unidadesDe } from './fichas';

describe('Fichas de mercado (contratos)', () => {
  it('Binance BTC: 1 contrato = 0,001 BTC; cada punto vale 0,001 $ por contrato', () => {
    const f = fichaDe('binance:BTCUSDT');
    expect(unidadesDe(f, 3)).toBeCloseTo(0.003, 12);
    expect(riesgoPorContrato(f, 84_000, 83_800)).toBeCloseTo(0.2, 12);
    expect(contratosDe(f, 0.0149)).toBe(14);
    expect(contratosDe(f, 0.015)).toBe(15);
  });

  it('micro oro CME: 10 oz por contrato, 10 $ por punto', () => {
    const f = fichaDe('rithmic:MGC');
    expect(riesgoPorContrato(f, 2_400, 2_395)).toBe(50);
    expect(contratosDe(f, 25)).toBe(2);
  });

  it('mercado sin ficha: una por defecto marcada como no verificada', () => {
    const f = fichaDe('binance:SOLUSDT');
    expect(f.verificada).toBe(false);
    expect(f.unidad).toBe('SOL');
    expect(f.contrato).toBe(1);
  });
});
