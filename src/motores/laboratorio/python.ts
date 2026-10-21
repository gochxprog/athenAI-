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
import { alterarDesde, analizarCodigo, CORTES_ANTIFUTURO, primeraDiferencia, type ResultadoAntiFuturo } from './antiFuturo';

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

def _athenai_correr_filas(p_json, filas_json):
    filas = json.loads(filas_json)
    pos = list(_ns["estrategia"]([dict(f) for f in filas], dict(json.loads(p_json))))
    if len(pos) != len(filas):
        raise ValueError(f"estrategia() devolvió {len(pos)} posiciones para {len(filas)} filas")
    return json.dumps([float(x) if isinstance(x, (int, float, bool)) else 0 for x in pos])

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
  antiFuturo: ResultadoAntiFuturo;
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

  // Motor 9 · Anti-futuro: análisis del código y prueba de causalidad (recorte y alteración en 8 cortes).
  aviso?.('Anti-futuro: revisando el código y probando con datos recortados y alterados…');
  const estatico = analizarCodigo(codigo);
  let dinamico: ResultadoAntiFuturo['dinamico'] = { cortes: CORTES_ANTIFUTURO.length, recorte: true, alteracion: true, fila: null, prueba: null };
  for (const frac of CORTES_ANTIFUTURO) {
    const hasta = Math.floor(filas.length * frac);
    if (hasta < 10) continue;
    const recortada = normalizarPosiciones(correr(combos[0], hasta), hasta);
    let d = primeraDiferencia(recortada, posiciones[0], hasta);
    if (d >= 0) {
      dinamico = { ...dinamico, recorte: false, fila: d, prueba: 'recorte' };
      break;
    }
    py.globals.set('_athenai_p', JSON.stringify(combos[0]));
    py.globals.set('_athenai_alt', JSON.stringify(filasParaPython(alterarDesde(filas, hasta, 1_000 + hasta))));
    const alterada = normalizarPosiciones(JSON.parse(String(py.runPython('_athenai_correr_filas(_athenai_p, _athenai_alt)'))) as unknown[], filas.length);
    d = primeraDiferencia(alterada, posiciones[0], hasta);
    if (d >= 0) {
      dinamico = { ...dinamico, alteracion: false, fila: d, prueba: 'alteración' };
      break;
    }
  }
  const ok = !estatico.violaciones.length && dinamico.recorte && dinamico.alteracion;
  const detalle = estatico.violaciones.length
    ? `el código lee datos del futuro: ${estatico.violaciones[0]}`
    : dinamico.prueba
      ? `la posición de la fila ${dinamico.fila} cambia al ${dinamico.prueba === 'recorte' ? 'quitar' : 'alterar'} filas posteriores`
      : `posiciones idénticas con los datos recortados y alterados en ${CORTES_ANTIFUTURO.length} puntos`;
  const antiFuturo: ResultadoAntiFuturo = { ok, detalle, estatico, dinamico };
  return { combos, posiciones, antiFuturo };
}
