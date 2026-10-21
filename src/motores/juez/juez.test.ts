import { describe, expect, it } from 'vitest';
import { backtest, metricas, normalizarPosiciones } from './backtest';
import { juzgar, type Combo } from './juez';
import { crearAleatorio, normal } from '@/lib/random';

/** Mercado de prueba con valores fijos (solo para el test). `persistencia` > 0 crea momentum explotable; 0 = paseo aleatorio. */
function mercado(n: number, persistencia: number, semilla: number) {
  const r = crearAleatorio(semilla);
  const cierres = [100];
  const tiempos = [0];
  let previo = 0;
  for (let i = 1; i < n; i += 1) {
    const ret = persistencia * previo + normal(r) * 0.003;
    previo = ret;
    cierres.push(cierres[i - 1] * (1 + ret));
    tiempos.push(i * 60_000);
  }
  return { cierres, tiempos };
}

/** Momentum: posición = signo del retorno de las últimas k barras (solo usa el pasado). */
function momentum(cierres: number[], k: number): number[] {
  return cierres.map((c, i) => (i < k ? 0 : Math.sign(c - cierres[i - k])));
}

describe('Backtest', () => {
  it('aplica la posición desde la barra siguiente y cobra costos por lado', () => {
    const cierres = [100, 101, 102.01, 103.0301];
    const sinCostos = backtest(cierres, [1, 1, 1, 1], { comisionPb: 0, deslizamientoPb: 0 });
    // La posición de la última barra se cierra: 3 barras de +1 %.
    expect(sinCostos.equity[3]).toBeCloseTo(1.01 ** 3, 10);
    expect(sinCostos.operaciones).toHaveLength(1);
    expect(sinCostos.operaciones[0]).toMatchObject({ entrada: 0, salida: 3, lado: 1, barras: 3 });
    const conCostos = backtest(cierres, [1, 1, 1, 1], { comisionPb: 4, deslizamientoPb: 1 });
    expect(conCostos.operaciones[0].retorno).toBeCloseTo((1 - 0.0005) * 1.01 ** 3 * (1 - 0.0005) - 1, 8);
    // Un giro de largo a corto paga dos lados.
    const giro = backtest([100, 100, 100], [1, -1, 0], { comisionPb: 10, deslizamientoPb: 0 });
    expect(giro.retornos[1]).toBeCloseTo((1 - 0.001) ** 2 - 1, 12);
  });

  it('normaliza cualquier salida de la estrategia a −1 / 0 / 1', () => {
    expect(normalizarPosiciones([2, -0.5, 0, 'x', null, true], 7)).toEqual([1, -1, 0, 0, 0, 1, 0]);
  });

  it('calcula drawdown, aciertos y factor de beneficio', () => {
    const cierres = [100, 110, 99, 108.9, 98.01];
    const b = backtest(cierres, [1, 0, 1, 0, 0], { comisionPb: 0, deslizamientoPb: 0 });
    const m = metricas(b, [0, 1, 2, 3, 4].map((x) => x * 86_400_000));
    expect(m.operaciones).toBe(2);
    expect(m.aciertos).toBe(1);
    expect(m.retornoTotal).toBeCloseTo(1.1 * 1.1 - 1, 10);
  });
});

describe('Juez', () => {
  it('APRUEBA una estrategia con ventaja real y suficiente historia', () => {
    const { cierres, tiempos } = mercado(6_000, 0.5, 1);
    const combos: Combo[] = [{ k: 1 }, { k: 2 }, { k: 3 }];
    const res = juzgar({ cierres, tiempos, combos, posiciones: combos.map((c) => momentum(cierres, c.k as number)), antiFuturo: { ok: true, detalle: 'idénticas' } });
    expect(res.oos.retornoTotal).toBeGreaterThan(0);
    expect(res.suerte!.p).toBeLessThan(0.05);
    expect(res.deflatedSharpe!).toBeGreaterThan(0.95);
    expect(res.tramos).toHaveLength(5);
    // El Walk-Forward elige los parámetros solo con datos anteriores a cada tramo.
    for (const t of res.tramos) expect(t.desde).toBeGreaterThanOrEqual(res.inicioOos);
    expect(res.veredicto).toBe('APROBADA');
  });

  it('RECHAZA la misma idea en un mercado sin ventaja (paseo aleatorio)', () => {
    const { cierres, tiempos } = mercado(6_000, 0, 2);
    const combos: Combo[] = [{ k: 1 }, { k: 2 }, { k: 3 }, { k: 5 }];
    const res = juzgar({ cierres, tiempos, combos, posiciones: combos.map((c) => momentum(cierres, c.k as number)), antiFuturo: { ok: true, detalle: 'idénticas' } });
    expect(res.veredicto).toBe('RECHAZADA');
    expect(res.suerte!.p).toBeGreaterThan(0.05);
  });

  it('pide más datos cuando hay pocas operaciones', () => {
    const { cierres, tiempos } = mercado(400, 0.5, 3);
    const res = juzgar({ cierres, tiempos, combos: [{}], posiciones: [momentum(cierres, 1)] });
    expect(res.veredicto).toBe('DATOS INSUFICIENTES');
  });

  it('no mantiene posición a través de un hueco de datos', () => {
    const cierres = [100, 100, 200, 200];
    const huecos = [false, false, true, false];
    const res = juzgar({ cierres, tiempos: [0, 1, 2, 3], huecos, combos: [{}], posiciones: [[1, 1, 1, 1]] });
    expect(res.dentroMuestra.retornoTotal).toBeLessThan(0.01);
  });

});
