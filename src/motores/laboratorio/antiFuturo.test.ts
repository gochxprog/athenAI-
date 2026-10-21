// Verificación del motor 9 (Anti-futuro): análisis del código y utilidades de la prueba de causalidad.
import { describe, expect, it } from 'vitest';
import { alterarDesde, analizarCodigo, primeraDiferencia } from './antiFuturo';

describe('Motor 9 · Anti-futuro (análisis del código)', () => {
  it('detecta índices hacia adelante y la última fila de todos los datos', () => {
    const a = analizarCodigo('def estrategia(filas, p):\n    x = filas[i + 1]["close"]\n    y = filas[-1]["close"]\n    z = filas[len(filas) - 1]\n');
    expect(a.violaciones).toHaveLength(3);
    expect(a.violaciones[0]).toMatch(/Línea 2/);
  });

  it('avisa de estadísticas sobre todas las filas, pero no de ventanas del pasado', () => {
    expect(analizarCodigo('m = max([f["delta"] for f in filas])').alertas).toHaveLength(1);
    expect(analizarCodigo('m = sum(f["delta"] for f in filas) / len(filas)').alertas).toHaveLength(1);
    const pasado = analizarCodigo('v = [x["delta"] for x in filas[max(0, i - 20): i + 1]]\nprev = filas[i - 1]');
    expect(pasado).toEqual({ violaciones: [], alertas: [] });
  });

  it('ignora comentarios y textos', () => {
    expect(analizarCodigo('# no usar filas[i + 1]\ns = "filas[-1]"\n').violaciones).toEqual([]);
  });

  it('alterar desde una fila no toca las anteriores y cambia las siguientes', () => {
    const filas = Array.from({ length: 10 }, (_, i) => ({ close: 100 + i, valores: { a: i, b: null as number | null } }));
    const alt = alterarDesde(filas, 6);
    expect(alt.slice(0, 6)).toEqual(filas.slice(0, 6));
    expect(alt.slice(6).every((f, k) => f.close !== filas[6 + k].close && f.valores.a !== filas[6 + k].valores.a && f.valores.b === null)).toBe(true);
    expect(primeraDiferencia([1, 0, 1, 1], [1, 0, -1, 1], 4)).toBe(2);
    expect(primeraDiferencia([1, 0, 1], [1, 0, -1], 2)).toBe(-1);
  });
});
