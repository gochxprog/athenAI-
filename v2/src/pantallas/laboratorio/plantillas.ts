// Plantillas para empezar: cada una usa velas completas y, si quiere, GESTION (stop, objetivo y manejo).
export const AYUDA = `# Cada vela: inicio, cierre, open, high, low, close, volumen, delta
# y las Features (flujo_5_ratio, absorcion_bid, stoprun_bajo, oi_delta_pct…).
# estrategia(velas, p) devuelve una posición por vela: 1 compra, -1 vende, 0 fuera.
# La vela i solo puede usar velas <= i (el Juez lo comprueba).`;

export const PLANTILLAS: { nombre: string; codigo: string }[] = [
  {
    nombre: 'Ruptura de 20 velas',
    codigo: `${AYUDA}

GESTION = {"stopAtr": 1.5, "rr": 2, "gestion": "be1R"}
PARAMETROS = {"n": [20, 40]}

def estrategia(velas, p):
    n, pos = p["n"], []
    for i, v in enumerate(velas):
        previas = velas[max(0, i - n):i]
        maximo = max((x["high"] for x in previas), default=v["high"])
        pos.append(1 if len(previas) == n and v["close"] > maximo else 0)
    return pos
`,
  },
  {
    nombre: 'Absorción + flujo',
    codigo: `${AYUDA}

GESTION = {"stopAtr": 1, "rr": 2, "gestion": "escalonada"}
PARAMETROS = {"flujo": [0.1, 0.2]}

def estrategia(velas, p):
    def lado(v):
        flujo = v["flujo_5_ratio"] or 0
        if (v["absorcion_bid"] or 0) > 0 and flujo > p["flujo"]: return 1
        if (v["absorcion_ask"] or 0) > 0 and flujo < -p["flujo"]: return -1
        return 0
    return [lado(v) for v in velas]
`,
  },
  {
    nombre: 'Cruce de medias',
    codigo: `${AYUDA}

PARAMETROS = {"rapida": [10, 20], "lenta": [50, 100]}

def media(xs):
    return sum(xs) / len(xs)

def estrategia(velas, p):
    cierres, pos = [v["close"] for v in velas], []
    for i in range(len(cierres)):
        if i < p["lenta"]:
            pos.append(0)
            continue
        r, l = media(cierres[i - p["rapida"] + 1:i + 1]), media(cierres[i - p["lenta"] + 1:i + 1])
        pos.append(1 if r > l else -1)
    return pos
`,
  },
  {
    nombre: 'Estilo backtesting.py',
    codigo: `# Una clase como en backtesting.py: init() prepara los indicadores, next() decide en cada vela.
from backtesting import Strategy
from backtesting.lib import crossover

def SMA(valores, n):
    v = list(valores)
    return [sum(v[i - n + 1:i + 1]) / n if i >= n - 1 else float("nan") for i in range(len(v))]

class CruceMedias(Strategy):
    rapida = 10
    lenta = 30

    def init(self):
        self.r = self.I(SMA, self.data.Close, self.rapida)
        self.l = self.I(SMA, self.data.Close, self.lenta)

    def next(self):
        if crossover(self.r, self.l):
            self.buy()
        elif crossover(self.l, self.r):
            self.sell()

PARAMETROS = {"rapida": [10, 20], "lenta": [30, 50]}
`,
  },
  {
    nombre: 'Script con pandas',
    codigo: `# Un script suelto con pandas: df ya trae Open, High, Low, Close, Volume y las 39 Features.
import pandas as pd

df["media"] = df["Close"].rolling(50).mean()
df["signal"] = 0
df.loc[df["Close"] > df["media"], "signal"] = 1
df.loc[df["Close"] < df["media"], "signal"] = -1
`,
  },
];
