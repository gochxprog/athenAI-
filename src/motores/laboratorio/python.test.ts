import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { fileURLToPath } from 'node:url';
import { ejecutarEstrategia, type PyodideMinimo } from './python';
import type { FilaFeatures } from '../nucleo/features';

let py: PyodideMinimo;
beforeAll(async () => {
  py = (await loadPyodide({ indexURL: fileURLToPath(new URL('../../../node_modules/pyodide/', import.meta.url)) })) as unknown as PyodideMinimo;
}, 60_000);

const filas: FilaFeatures[] = Array.from({ length: 200 }, (_, i) => ({ n: i, inicio: i * 1000, cierre: i * 1000 + 999, close: 100 + Math.sin(i / 5) * 3, valores: { delta: Math.sin(i / 3), absorcion_bid: (i * 37) % 100 } }));

describe('Estrategias en Python (Pyodide)', () => {
  it('ejecuta la rejilla de PARAMETROS y devuelve una posición por fila', () => {
    const codigo = `
PARAMETROS = {"umbral": [30, 60], "lado": [1, -1]}

def estrategia(filas, p):
    return [p["lado"] if f["absorcion_bid"] >= p["umbral"] else 0 for f in filas]
`;
    const r = ejecutarEstrategia(py, codigo, filas);
    expect(r.combos).toEqual([
      { umbral: 30, lado: 1 },
      { umbral: 30, lado: -1 },
      { umbral: 60, lado: 1 },
      { umbral: 60, lado: -1 },
    ]);
    expect(r.posiciones[0]).toHaveLength(200);
    expect(r.posiciones[0][1]).toBe(1); // 37 ≥ 30
    expect(r.posiciones[3][2]).toBe(-1); // 74 ≥ 60
    expect(r.antiFuturo.ok).toBe(true);
  });

  it('detecta una estrategia que mira al futuro', () => {
    const tramposa = `
def estrategia(filas, p):
    pos = []
    for i, f in enumerate(filas):
        siguiente = filas[i + 1]["close"] if i + 1 < len(filas) else f["close"]
        pos.append(1 if siguiente > f["close"] else -1)
    return pos
`;
    const r = ejecutarEstrategia(py, tramposa, filas);
    expect(r.antiFuturo.ok).toBe(false);
    expect(r.antiFuturo.detalle).toMatch(/cambia al añadir filas posteriores/);
  });

  it('explica los errores del código', () => {
    expect(() => ejecutarEstrategia(py, 'x = 1', filas)).toThrow(/Falta la función estrategia/);
    expect(() => ejecutarEstrategia(py, 'def estrategia(filas, p):\n    return [1]', filas)).toThrow(/devolvió 1 posiciones para 200 filas/);
    expect(() => ejecutarEstrategia(py, 'def estrategia(filas, p):\n    return [f["no_existe"] for f in filas]', filas)).toThrow(/KeyError/);
  });
});
