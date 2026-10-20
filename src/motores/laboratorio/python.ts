// Ejecuta estrategias escritas en Python (Pyodide) sobre las Features guardadas.
//
// Contrato de la estrategia (lo que escribe el usuario):
//
//   PARAMETROS = {"umbral": [40, 60, 80]}      # opcional: rejilla que el Juez usa en el Walk-Forward
//
//   def estrategia(filas, p):
//       # filas: lista de dicts, una por dollar bar (cierre, close y las Features: delta, absorcion_bid…)
//       # p: un juego de parámetros, p. ej. {"umbral": 60}
//       # devuelve una lista con una posición por fila: 1 largo, -1 corto, 0 fuera
//
// La posición de la fila i se decide con la información de esa fila y anteriores; el Juez la aplica desde la
// barra siguiente. La prueba anti-futuro vuelve a ejecutar la estrategia con los datos recortados y comprueba
// que las posiciones pasadas no cambian (si cambian, la estrategia está mirando filas posteriores).
import type { FilaFeatures } from '../nucleo/features';
import { normalizarPosiciones } from '../juez/backtest';
import type { Combo } from '../juez/juez';

/** Interfaz mínima de Pyodide que se usa (permite probar con Pyodide en Node). */
export interface PyodideMinimo {
  runPython(codigo: string): unknown;
  globals: { set(nombre: string, valor: unknown): void; get(nombre: string): unknown };
}

export const MAX_COMBOS = 48;

const ARNES = `
import json, itertools, traceback

def _athenai_cargar(codigo, filas_json):
    global _ns, _filas
    _ns = {"__name__": "estrategia_usuario"}
    exec(compile(codigo, "estrategia.py", "exec"), _ns)
    if "estrategia" not in _ns or not callable(_ns["estrategia"]):
        raise ValueError("Falta la función estrategia(filas, p)")
    _filas = json.loads(filas_json)
    params = _ns.get("PARAMETROS", {}) or {}
    if not isinstance(params, dict):
        raise ValueError("PARAMETROS debe ser un diccionario {nombre: [valores]}")
    claves = list(params.keys())
    valores = [v if isinstance(v, (list, tuple)) else [v] for v in params.values()]
    combos = [dict(zip(claves, c)) for c in itertools.product(*valores)] if claves else [{}]
    return json.dumps(combos)

def _athenai_correr(p_json, hasta):
    p = json.loads(p_json)
    filas = _filas if hasta < 0 else _filas[:hasta]
    pos = _ns["estrategia"]([dict(f) for f in filas], dict(p))
    if pos is None:
        raise ValueError("estrategia() no devolvió nada: debe devolver una lista de posiciones")
    pos = list(pos)
    if len(pos) != len(filas):
        raise ValueError(f"estrategia() devolvió {len(pos)} posiciones para {len(filas)} filas")
    return json.dumps([float(x) if isinstance(x, (int, float, bool)) else 0 for x in pos])
`;

export interface ResultadoEjecucion {
  combos: Combo[];
  posiciones: number[][];
  antiFuturo: { ok: boolean; detalle: string };
}

/** Filas en el formato que ve la estrategia: cierre, close y cada Feature como clave. */
export function filasParaPython(filas: readonly FilaFeatures[]): Record<string, number | null>[] {
  return filas.map((f) => ({ cierre: f.cierre, inicio: f.inicio, close: f.close, ...f.valores }));
}

/** Traduce un error de Python a un mensaje legible (solo la parte del código del usuario). */
export function mensajeError(e: unknown): string {
  const txt = e instanceof Error ? e.message : String(e);
  const lineas = txt.split('\n');
  const propias = lineas.filter((l) => l.includes('estrategia.py') || /^\w*Error/.test(l.trim()));
  return (propias.length ? propias : lineas.slice(-3)).join('\n').trim();
}

export function ejecutarEstrategia(py: PyodideMinimo, codigo: string, filas: readonly FilaFeatures[], aviso?: (texto: string) => void): ResultadoEjecucion {
  py.runPython(ARNES);
  py.globals.set('_athenai_codigo', codigo);
  py.globals.set('_athenai_filas', JSON.stringify(filasParaPython(filas)));
  const combos = JSON.parse(String(py.runPython('_athenai_cargar(_athenai_codigo, _athenai_filas)'))) as Combo[];
  if (combos.length > MAX_COMBOS) throw new Error(`PARAMETROS genera ${combos.length} combinaciones; el máximo es ${MAX_COMBOS} (más variantes = más riesgo de sobreajuste)`);
  const correr = (p: Combo, hasta = -1) => {
    py.globals.set('_athenai_p', JSON.stringify(p));
    return JSON.parse(String(py.runPython(`_athenai_correr(_athenai_p, ${hasta})`))) as unknown[];
  };
  const posiciones = combos.map((c, i) => {
    aviso?.(`Ejecutando variante ${i + 1}/${combos.length} ${JSON.stringify(c)}`);
    return normalizarPosiciones(correr(c), filas.length);
  });

  // Prueba anti-futuro: con los datos recortados en 8 puntos, las posiciones pasadas deben ser idénticas.
  // (Una estrategia que mira una sola fila adelante solo se delata en la última fila de cada recorte: con 8
  // recortes la probabilidad de que se escape por casualidad es < 1 %.)
  aviso?.('Prueba anti-futuro: ejecutando con los datos recortados…');
  const CORTES = [0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86];
  let antiFuturo = { ok: true, detalle: `posiciones idénticas con los datos recortados en ${CORTES.length} puntos` };
  for (const frac of CORTES) {
    const hasta = Math.floor(filas.length * frac);
    if (hasta < 10) continue;
    const parcial = normalizarPosiciones(correr(combos[0], hasta), hasta);
    const distinta = parcial.findIndex((p, i) => p !== posiciones[0][i]);
    if (distinta >= 0) {
      antiFuturo = { ok: false, detalle: `la posición de la fila ${distinta} cambia al añadir filas posteriores (recorte al ${Math.round(frac * 100)} %)` };
      break;
    }
  }
  return { combos, posiciones, antiFuturo };
}
