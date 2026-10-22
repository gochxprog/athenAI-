import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide } from 'pyodide';
import { fileURLToPath } from 'node:url';
import { ejecutarEstrategia, type PyodideMinimo } from './python';
import type { FilaFeatures } from '../nucleo/features';

let py: PyodideMinimo;
beforeAll(async () => {
  py = (await loadPyodide({ indexURL: fileURLToPath(new URL('../../../node_modules/pyodide/', import.meta.url)) })) as unknown as PyodideMinimo;
}, 60_000);

// Precio en zigzag (sube 20 velas, baja 20): los cruces de medias caen siempre en el mismo sitio.
const filas: FilaFeatures[] = Array.from({ length: 160 }, (_, i) => {
  const c = 100 + (i % 40 < 20 ? i % 40 : 40 - (i % 40));
  return { n: i, inicio: i * 60_000, cierre: i * 60_000 + 59_999, open: c, high: c + 0.5, low: c - 0.5, close: c, volumen: 10, delta: 1, valores: { absorcion_bid: i % 7 } };
});

describe('Motor de código libre: reconoce cualquier forma de estrategia', () => {
  it('función con todas las velas, con otro nombre y parámetros por nombre', () => {
    const r = ejecutarEstrategia(py, `PARAMETROS = {"umbral": [3, 5]}\ndef signals(velas, umbral=3):\n    return ["buy" if v["absorcion_bid"] >= umbral else "exit" for v in velas]\n`, filas);
    expect(r.combos).toEqual([{ umbral: 3 }, { umbral: 5 }]);
    expect(r.posiciones[0].slice(0, 8)).toEqual([0, 0, 0, 1, 1, 1, 1, 0]);
    expect(r.posiciones[1].slice(0, 8)).toEqual([0, 0, 0, 0, 0, 1, 1, 0]);
    expect(r.antiFuturo.ok).toBe(true);
  });

  it('función por vela con la historia (solo el pasado)', () => {
    const r = ejecutarEstrategia(py, `def on_bar(vela, historia):\n    if len(historia) < 2: return 0\n    return 1 if vela["close"] > historia[-2]["close"] else -1\n`, filas);
    expect(r.posiciones[0][5]).toBe(1);
    expect(r.posiciones[0][25]).toBe(-1);
    expect(r.antiFuturo.ok).toBe(true);
  });

  it('la historia no deja ver el futuro', () => {
    expect(() => ejecutarEstrategia(py, `def decide(historia):\n    return historia[len(historia)]["close"]\n`, filas)).toThrow(/futuro/);
  });

  it('clase estilo backtesting.py con init/next, self.I, crossover y Backtest().run()', () => {
    const codigo = `
from backtesting import Strategy, Backtest
from backtesting.lib import crossover
from backtesting.test import SMA

class Cruce(Strategy):
    n1 = 3
    n2 = 9
    def init(self):
        self.a = self.I(SMA, self.data.Close, self.n1)
        self.b = self.I(SMA, self.data.Close, self.n2)
    def next(self):
        if crossover(self.a, self.b):
            self.position.close()
            self.buy()
        elif crossover(self.b, self.a):
            self.sell()

bt = Backtest(None, Cruce, cash=10000)
stats = bt.run()
`;
    const r = ejecutarEstrategia(py, codigo, filas);
    const pos = r.posiciones[0];
    // Va largo en los tramos que suben y corto en los que bajan (con el retraso de las medias).
    expect(pos[55]).toBe(1);
    expect(pos[75]).toBe(-1);
    expect(pos[95]).toBe(1);
    expect(r.antiFuturo.ok).toBe(true);
  });

  it('script suelto que deja sus señales en una variable', () => {
    const r = ejecutarEstrategia(py, `senales = []\nfor i, v in enumerate(velas):\n    senales.append(1 if i > 0 and v["close"] > velas[i-1]["close"] else None)\n`, filas);
    // None mantiene la posición anterior.
    expect(r.posiciones[0][1]).toBe(1);
    expect(r.posiciones[0][21]).toBe(1);
    expect(r.antiFuturo.ok).toBe(true);
  });

  it('mensajes claros cuando no se entiende la salida', () => {
    expect(() => ejecutarEstrategia(py, `def estrategia(velas, p):\n    return [1, 0]\n`, filas)).toThrow(/2 señales para \d+ velas/);
    expect(() => ejecutarEstrategia(py, `x = 1\n`, filas)).toThrow(/No encontré tus señales/);
  });
});

describe('Anti-futuro: las trampas de la auditoría ya no pasan', () => {
  const trampas: [string, string][] = [
    ['lee la serie completa desde la variable global «velas»', `def estrategia(filas, p):\n    todo = velas\n    return [1 if i + 1 < len(todo) and todo[i + 1]["close"] > todo[i]["close"] else -1 for i in range(len(filas))]\n`],
    ['guarda la corrida completa en una caché y la devuelve recortada', `_c = {}\ndef estrategia(filas, p):\n    if "x" not in _c:\n        x = filas\n        _c["x"] = [1 if j + 1 < len(x) and x[j + 1]["close"] > x[j]["close"] else -1 for j in range(len(x))]\n    return _c["x"][:len(filas)]\n`],
    ['solo la segunda variante mira el futuro', `PARAMETROS = {"modo": [0, 1]}\ndef estrategia(filas, p):\n    n = len(filas)\n    if p["modo"] == 0: return [0] * n\n    return [1 if filas[min(i + 1, n - 1)]["close"] > filas[i]["close"] else -1 for i in range(n)]\n`],
    ['espía el máximo de la vela siguiente de vez en cuando', `def estrategia(filas, p):\n    x = filas\n    return [1 if i % 10 == 2 and i + 1 < len(x) and x[i + 1]["high"] > x[i]["high"] + 0.6 else 0 for i in range(len(x))]\n`],
  ];
  it.each(trampas)('rechaza: %s', (_, codigo) => {
    expect(ejecutarEstrategia(py, codigo, filas).antiFuturo.ok).toBe(false);
  });

  it('no rechaza una estrategia honesta que usa historia[-1] (la vela actual)', () => {
    const r = ejecutarEstrategia(py, `def decide(historia):\n    if len(historia) < 2: return 0\n    return 1 if historia[-1]["close"] > historia[-2]["close"] else -1\n`, filas);
    expect(r.antiFuturo.ok).toBe(true);
  });
});
