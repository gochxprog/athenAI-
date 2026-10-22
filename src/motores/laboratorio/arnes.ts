// Motor de código libre: el arnés de Python que reconoce CUALQUIER forma de estrategia y la convierte en una
// posición por vela para el Juez (1 largo, -1 corto, 0 fuera). Formas que entiende:
//   1. estrategia(velas, p) → lista (la de siempre), o cualquier función parecida: strategy(df), signals(data, fast=10),
//      generate_signals(velas)… (recibe la lista de velas, o un DataFrame de pandas si su primer argumento se llama
//      df/data/datos o el código usa pandas).
//   2. Una función por vela: on_bar(vela, historia), decide(historia)… (devuelve la señal de esa vela).
//   3. Clases estilo backtesting.py: class X(Strategy) con init()/next(), self.I(), self.buy(), self.sell(),
//      self.position.close() y crossover() (el módulo backtesting está imitado dentro).
//   4. Un script suelto que deja sus señales en `senales`/`signals`/`posiciones` o en df['signal'].
// La salida puede ser 1/-1/0, True/False o textos (buy/sell/exit, compra/venta/cerrar); NaN o «hold» mantiene la
// posición anterior. Los datos que el código intente cargar (pd.read_csv, yfinance) se reemplazan por los del VPS.
export const ARNES = String.raw`
import json, itertools, sys, types, inspect
from collections.abc import Mapping

_TXT = {"buy": 1, "long": 1, "compra": 1, "comprar": 1, "largo": 1, "sell": -1, "short": -1, "venta": -1, "vender": -1, "corto": -1,
        "exit": 0, "close": 0, "flat": 0, "cerrar": 0, "salir": 0, "fuera": 0, "neutral": 0}
_LISTA = ("estrategia", "strategy", "signals", "senales", "señales", "generate_signals", "generar_senales", "get_signals", "compute_signals", "run_strategy", "estrategia_df")
_VELA = ("on_bar", "on_candle", "por_vela", "next_bar", "decide", "decidir", "senal", "señal", "signal", "on_tick")
_SALIDAS = ("posiciones", "positions", "senales", "señales", "signals", "signal", "senal", "señal", "position", "posicion")
_DF_ARGS = ("df", "data", "datos", "dataframe", "ohlc", "ohlcv", "prices", "precios", "bars")

def _a_numero(x):
    if x is None: return None
    if isinstance(x, bool): return 1.0 if x else 0.0
    if isinstance(x, str):
        k = x.strip().lower()
        if k in ("hold", "mantener", "keep", "", "none", "nan"): return None
        if k in _TXT: return float(_TXT[k])
        raise ValueError(f"No entiendo la señal «{x}»: usa 1/-1/0, True/False o buy/sell/exit")
    try: v = float(x)
    except Exception: return 0.0
    if v != v: return None
    return max(-1.0, min(1.0, v))

def _posiciones(salida, n):
    if salida is None: raise ValueError("Tu estrategia no devolvió nada: debe dar una señal por vela")
    if hasattr(salida, "columns"):
        col = next((c for c in salida.columns if str(c).lower() in _SALIDAS), None)
        if col is None: raise ValueError("Tu estrategia devolvió una tabla sin columna signal/position")
        salida = salida[col]
    if hasattr(salida, "tolist"): salida = salida.tolist()
    salida = list(salida)
    if len(salida) != n: raise ValueError(f"Tu estrategia devolvió {len(salida)} señales para {n} velas (debe ser una por vela)")
    out, prev = [], 0.0
    for x in salida:
        v = _a_numero(x)
        prev = prev if v is None else v
        out.append(prev)
    return out

class _Vela(Mapping):
    """Una vela que se lee como dict (v["close"], v.get, dict(v)) pero apunta a las columnas: nada se copia, así
    100 mil velas con 40 Features caben en poca memoria. Lo que el código le asigne queda solo en esa vela."""
    __slots__ = ("_c", "_i", "_e")
    def __init__(s, c, i): s._c, s._i, s._e = c, i, None
    def __getitem__(s, k):
        if s._e is not None and k in s._e: return s._e[k]
        return s._c[k][s._i]
    def __setitem__(s, k, x):
        if s._e is None: s._e = {}
        s._e[k] = x
    def __iter__(s): return iter({**s._c, **(s._e or {})})
    def __len__(s): return len({**s._c, **(s._e or {})})
    def __repr__(s): return repr(dict(s))

def _velas(cols):
    return [_Vela(cols, i) for i in range(len(cols["cierre"]))]

def _df(cols):
    import pandas as pd
    df = pd.DataFrame({k: v for k, v in cols.items() if k != "volume"})
    for a, b in (("open", "Open"), ("high", "High"), ("low", "Low"), ("close", "Close"), ("volumen", "Volume"), ("volumen", "volume")):
        df[b] = df[a]
    df.index = pd.to_datetime(df["cierre"], unit="ms")
    return df

def _cortar(cols, n): return {k: v[:n] for k, v in cols.items()}

class _Historia:
    """Las velas hasta la actual (nada del futuro): historia[-1] es la vela de ahora."""
    __slots__ = ("_f", "_n")
    def __init__(s, f, n): s._f, s._n = f, n
    def __len__(s): return s._n
    def __iter__(s): return (s._f[i] for i in range(s._n))
    def __getitem__(s, k):
        if isinstance(k, slice): return [s._f[i] for i in range(s._n)[k]]
        if k < 0: k += s._n
        if k < 0 or k >= s._n: raise IndexError("esa vela todavía no existe (sería mirar al futuro)")
        return s._f[k]

# --- backtesting.py imitado --------------------------------------------------------------------------------
class _Arr:
    """Serie vista hasta la vela actual, como en backtesting.py: x[-1] es el valor de ahora."""
    def __init__(s, d, r): s._d, s._r = d, r
    def _n(s): return len(s._d) if s._r.init else s._r.i + 1
    def __len__(s): return s._n()
    def __iter__(s): return (s._d[i] for i in range(s._n()))
    def __array__(s, dtype=None, copy=None):
        import numpy as np
        return np.asarray(list(s), dtype=dtype)
    def __getitem__(s, k):
        n = s._n()
        if isinstance(k, slice): return [s._d[i] for i in range(n)[k]]
        if k < 0: k += n
        if k < 0 or k >= n: raise IndexError("esa vela todavía no existe (sería mirar al futuro)")
        return s._d[k]
    def __float__(s): return float(s[-1])
    def _o(s, o): return o[-1] if isinstance(o, _Arr) else o
    def __gt__(s, o): return s[-1] > s._o(o)
    def __lt__(s, o): return s[-1] < s._o(o)
    def __ge__(s, o): return s[-1] >= s._o(o)
    def __le__(s, o): return s[-1] <= s._o(o)
    @property
    def values(s): return list(s)
    def tolist(s): return list(s)

class _Datos:
    def __init__(s, cols, r):
        s._r, s._cols, s._n = r, dict(cols), len(cols["cierre"])
        for a, b in (("open", "Open"), ("high", "High"), ("low", "Low"), ("close", "Close"), ("volumen", "Volume")):
            s._cols[b] = cols[a]
        s._filas = cols
    def __getattr__(s, k):
        if k.startswith("_"): raise AttributeError(k)
        if k == "df": return _df(s._filas)
        if k not in s._cols: raise AttributeError(f"Los datos no tienen «{k}»")
        return _Arr(s._cols[k], s._r)
    def __len__(s): return s._n if s._r.init else s._r.i + 1

class _Posicion:
    def __init__(s, e): s._e = e
    def __bool__(s): return s._e._pos != 0
    @property
    def is_long(s): return s._e._pos > 0
    @property
    def is_short(s): return s._e._pos < 0
    @property
    def size(s): return s._e._pos
    def close(s, *a, **k): s._e._pos = 0.0

class Strategy:
    def _armar(s, datos, r):
        s.data, s._r, s._pos = datos, r, 0.0
        s.position = _Posicion(s)
        s.trades, s.closed_trades, s.orders, s.equity = [], [], [], 0
    def I(s, func, *args, **kw):
        for k in ("name", "plot", "overlay", "color", "scatter"): kw.pop(k, None)
        v = func(*args, **kw)
        if hasattr(v, "tolist"): v = v.tolist()
        return _Arr(list(v), s._r)
    def buy(s, *a, **k): s._pos = 1.0
    def sell(s, *a, **k): s._pos = -1.0
    def init(s): pass
    def next(s): pass

def _ult(x, k):
    try: return x[k]
    except TypeError: return x
def crossover(a, b):
    try: return _ult(a, -2) < _ult(b, -2) and _ult(a, -1) > _ult(b, -1)
    except IndexError: return False
def cross(a, b): return crossover(a, b) or crossover(b, a)
def _SMA(valores, n):
    v = list(valores)
    return [sum(v[i - n + 1:i + 1]) / n if i >= n - 1 else float("nan") for i in range(len(v))]

class Backtest:
    """Para que un script con Backtest(datos, MiEstrategia).run() no falle: el Juez hace el backtest de verdad."""
    ultima = None
    def __init__(s, data=None, strategy=None, **kw): Backtest.ultima = strategy
    def run(s, **kw): return {}
    def optimize(s, **kw): return {}
    def plot(s, *a, **kw): return None

def _modulos():
    m = types.ModuleType("backtesting"); m.Strategy, m.Backtest = Strategy, Backtest
    lib = types.ModuleType("backtesting.lib"); lib.crossover, lib.cross = crossover, cross
    test = types.ModuleType("backtesting.test"); test.SMA, test.GOOG, test.EURUSD, test.BTCUSD = _SMA, None, None, None
    m.lib, m.test = lib, test
    sys.modules.update({"backtesting": m, "backtesting.lib": lib, "backtesting.test": test})

def _parchar_cargas(filas):
    """pd.read_csv, yfinance.download y similares devuelven los datos del VPS (el mercado elegido)."""
    yf = types.ModuleType("yfinance"); yf.download = lambda *a, **k: _df(filas)
    sys.modules["yfinance"] = yf
    if "pandas" in sys.modules:
        import pandas as pd
        for nombre in ("read_csv", "read_parquet", "read_excel", "read_json"):
            setattr(pd, nombre, lambda *a, **k: _df(filas))

# --- detección y ejecución ---------------------------------------------------------------------------------
def _usa_pandas(codigo): return "pandas" in codigo or "pd." in codigo

def _llamar(f, filas, p):
    sig = inspect.signature(f)
    pars = list(sig.parameters.values())
    if not pars: raise ValueError(f"{f.__name__}() no recibe datos: debe recibir las velas (o df)")
    primero = pars[0].name.lower()
    datos = _df(filas) if (primero in _DF_ARGS and _PANDAS) or (_PANDAS and _usa_pandas(_CODIGO)) else _velas(filas)
    args, kw = [datos], {}
    for q in pars[1:]:
        if q.name in p: kw[q.name] = p[q.name]
        elif q.default is inspect._empty: args.append(dict(p))
    return f(*args, **kw)

def _por_vela(f, filas, p):
    pars = list(inspect.signature(f).parameters.values())
    velas = _velas(filas)
    extra = {q.name: p[q.name] for q in pars if q.name in p}
    nombres = [q.name.lower() for q in pars if q.name not in p]
    actual = bool(nombres) and nombres[0] in ("vela", "bar", "candle", "row", "fila", "c", "kline")
    out = []
    for i in range(len(velas)):
        h = _Historia(velas, i + 1)
        if len(nombres) >= 2: r = f(velas[i], h, **extra)
        elif actual: r = f(velas[i], **extra)
        else: r = f(h, **extra)
        out.append(r)
    return out

def _clase(cls, filas, p):
    n = len(filas["cierre"])
    r = types.SimpleNamespace(i=n - 1, init=True)
    st = cls.__new__(cls)
    Strategy._armar(st, _Datos(filas, r), r)
    for k, v in p.items(): setattr(st, k, v)
    st.init()
    r.init = False
    out = []
    for i in range(n):
        r.i = i
        st.next()
        out.append(st._pos)
    return out

def _script(ns, filas):
    for k in _SALIDAS:
        if k in ns and ns[k] is not None and not callable(ns[k]): return ns[k]
    df = ns.get("df")
    if df is not None and hasattr(df, "columns"): return df
    raise ValueError("No encontré tus señales: deja el resultado en una variable «senales» (o signals/posiciones), una por vela")

def _espacio(filas, p=None):
    """Un espacio NUEVO por corrida: el código solo ve las velas de esa corrida (ni la serie completa ni nada de
    corridas anteriores). Así el anti-futuro no se puede engañar con variables globales o cachés."""
    Backtest.ultima = None
    _parchar_cargas(filas)
    ns = {"__name__": "estrategia_usuario", "velas": _velas(filas)}
    if p: ns.update({"p": dict(p), **p})
    if _PANDAS: ns["df"] = _df(filas)
    exec(compile(_CODIGO, "estrategia.py", "exec"), ns)
    return ns

def _detectar(ns):
    clases = [v for v in ns.values() if inspect.isclass(v) and issubclass(v, Strategy) and v is not Strategy]
    if Backtest.ultima in clases: return ("clase", Backtest.ultima)
    if clases: return ("clase", clases[-1])
    for n in _LISTA:
        if callable(ns.get(n)): return ("lista", ns[n])
    for n in _VELA:
        if callable(ns.get(n)): return ("vela", ns[n])
    propias = [v for v in ns.values() if inspect.isfunction(v) and getattr(v, "__module__", "") == "estrategia_usuario"]
    if len(propias) == 1: return ("lista", propias[0])
    return ("script", None)

def _athenai_cargar(codigo, cols_json, n_carga):
    """Lee el código con solo las primeras n_carga velas (menos que el primer corte del anti-futuro): ni al cargar
    puede guardar el futuro en algún rincón de Python."""
    global _filas, _CODIGO, _PANDAS
    _CODIGO = codigo
    _filas = json.loads(cols_json)
    _filas["volume"] = _filas["volumen"]
    _modulos()
    _PANDAS = "pandas" in sys.modules or _usa_pandas(codigo)
    if _PANDAS:
        try: import pandas
        except ImportError: raise ValueError("Tu código usa pandas y no está instalado en el VPS: vuelve a correr instalar.sh")
    ns = _espacio(_cortar(_filas, n_carga))
    forma = _detectar(ns)[0]
    params = ns.get("PARAMETROS", ns.get("PARAMS", {})) or {}
    if not isinstance(params, dict): raise ValueError("PARAMETROS debe ser un diccionario {nombre: [valores]}")
    claves = list(params.keys())
    valores = [v if isinstance(v, (list, tuple)) else [v] for v in params.values()]
    combos = [dict(zip(claves, c)) for c in itertools.product(*valores)] if claves else [{}]
    return json.dumps({"combos": combos, "gestion": ns.get("GESTION"), "forma": forma})

def _correr(filas, p):
    ns = _espacio(filas, p)
    tipo, f = _detectar(ns)
    salida = _llamar(f, filas, p) if tipo == "lista" else _por_vela(f, filas, p) if tipo == "vela" else _clase(f, filas, p) if tipo == "clase" else _script(ns, filas)
    return json.dumps(_posiciones(salida, len(filas["cierre"])))

def _athenai_correr(p_json, hasta):
    # Siempre columnas propias (aunque sea la serie completa): ninguna corrida puede tocar las de otra.
    return _correr(_cortar(_filas, len(_filas["cierre"]) if hasta < 0 else hasta), dict(json.loads(p_json)))
def _athenai_correr_alterada(p_json, hasta, alt_json):
    """Las velas hasta «hasta» tal cual y desde ahí las alteradas (solo viaja la parte alterada)."""
    alt = json.loads(alt_json)
    alt["volume"] = alt["volumen"]
    return _correr({k: v[:hasta] + alt[k] for k, v in _filas.items()}, dict(json.loads(p_json)))
`;

/** Nombre de la forma que reconoció el motor (para mostrarlo en el Laboratorio). */
export const FORMAS: Record<string, string> = { lista: 'función con todas las velas', vela: 'función por vela', clase: 'clase estilo backtesting.py', script: 'script con señales' };
