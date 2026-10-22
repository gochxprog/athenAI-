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
    expect(r.antiFuturo.estatico.violaciones[0]).toMatch(/filas\[i \+ 1\]/);
    // Escondido en otra variable: el análisis del código no lo ve, la prueba de causalidad sí.
    const escondida = `
def estrategia(filas, p):
    pos = []
    for i, f in enumerate(filas):
        j = min(i + 1, len(filas) - 1)
        pos.append(1 if filas[j]["close"] > f["close"] else -1)
    return pos
`;
    const e = ejecutarEstrategia(py, escondida, filas);
    expect(e.antiFuturo.estatico.violaciones).toEqual([]);
    expect(e.antiFuturo.ok).toBe(false);
    expect(e.antiFuturo.dinamico.prueba).not.toBeNull();
  });

  it('detecta la normalización con todos los datos (incluye el futuro)', () => {
    const global = `
def estrategia(filas, p):
    tope = max([f["delta"] for f in filas])
    return [1 if f["delta"] > 0.8 * tope else 0 for f in filas]
`;
    const r = ejecutarEstrategia(py, global, filas);
    expect(r.antiFuturo.estatico.alertas[0]).toMatch(/max/);
    expect(r.antiFuturo.ok).toBe(false);
    expect(r.antiFuturo.dinamico.alteracion).toBe(false);
    // La versión causal (ventana rodante con el pasado) pasa.
    const rodante = `
def estrategia(filas, p):
    pos = []
    for i, f in enumerate(filas):
        ventana = [x["delta"] for x in filas[max(0, i - 20): i + 1]]
        pos.append(1 if f["delta"] >= max(ventana) else 0)
    return pos
`;
    const b = ejecutarEstrategia(py, rodante, filas);
    expect(b.antiFuturo.ok).toBe(true);
    expect(b.antiFuturo.estatico.violaciones).toEqual([]);
  });

  it('explica los errores del código', () => {
    expect(() => ejecutarEstrategia(py, 'x = 1', filas)).toThrow(/Falta la función estrategia/);
    expect(() => ejecutarEstrategia(py, 'def estrategia(filas, p):\n    return [1]', filas)).toThrow(/devolvió 1 posiciones para 200 filas/);
    expect(() => ejecutarEstrategia(py, 'def estrategia(filas, p):\n    return [f["no_existe"] for f in filas]', filas)).toThrow(/KeyError/);
  });

  it('la estrategia ve la vela completa (open/high/low/volumen/delta) y declara GESTION', () => {
    const velas = filas.map((f) => ({ ...f, open: f.close - 1, high: f.close + 2, low: f.close - 2, volumen: 10, delta: 1 }));
    const codigo = `
GESTION = {"stopAtr": 1.5, "rr": 2, "gestion": "be1R"}

def estrategia(filas, p):
    return [1 if f["high"] - f["low"] == 4 and f["open"] < f["close"] and f["volumen"] == 10 else 0 for f in filas]
`;
    const r = ejecutarEstrategia(py, codigo, velas);
    expect(r.gestion).toEqual({ stopAtr: 1.5, rr: 2, gestion: 'be1R' });
    expect(r.posiciones[0].every((p) => p === 1)).toBe(true);
    expect(r.antiFuturo.ok).toBe(true);
  });

  it('GESTION mal escrita da un error claro', () => {
    expect(() => ejecutarEstrategia(py, 'GESTION = {"stopAtr": 0, "rr": 2}\ndef estrategia(filas, p):\n    return [0] * len(filas)', filas)).toThrow(/GESTION no válida/);
  });
});
