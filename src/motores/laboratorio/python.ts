// Ejecuta estrategias escritas en Python (Pyodide) sobre las Features guardadas.
//
// Motor de código libre (arnes.ts): acepta cualquier forma de estrategia (función con todas las velas, función por
// vela, clase estilo backtesting.py o script suelto). La forma de siempre:
//
//   PARAMETROS = {"umbral": [40, 60, 80]}      # opcional: rejilla que el Juez usa en el Walk-Forward
//
//   GESTION = {"stopAtr": 1.5, "rr": 2, "gestion": "be1R"}   # opcional: stop, objetivo y manejo (salidas.ts)
//
//   def estrategia(filas, p):
//       # filas: lista de dicts, una por vela (inicio, cierre, open, high, low, close, volumen, delta y las Features)
//       # p: un juego de parámetros, p. ej. {"umbral": 60}
//       # devuelve una lista con una posición por fila: 1 largo, -1 corto, 0 fuera
//
// La posición de la fila i se decide con la información de esa fila y anteriores; el Juez la aplica desde la
// barra siguiente. La prueba anti-futuro vuelve a ejecutar la estrategia con los datos recortados y comprueba
// que las posiciones pasadas no cambian (si cambian, la estrategia está mirando filas posteriores).
import type { FilaFeatures } from '../nucleo/features';
import { normalizarPosiciones } from '../juez/backtest';
import type { Combo } from '../juez/juez';
import { MODOS_GESTION, type ReglasSalida } from '../juez/salidas';
import { ARNES, FORMAS } from './arnes';
import { alterarDesde, analizarCodigo, CORTES_ANTIFUTURO, primeraDiferencia, type ResultadoAntiFuturo } from './antiFuturo';

/** Interfaz mínima de Pyodide que se usa (permite probar con Pyodide en Node). */
export interface PyodideMinimo {
  runPython(codigo: string): unknown;
  globals: { set(nombre: string, valor: unknown): void; get(nombre: string): unknown };
  /** Paquetes extra (numpy, pandas) que vienen junto a Pyodide en el VPS. */
  loadPackage?(nombres: string[]): Promise<unknown>;
}

/** Antes de correr: si el código usa numpy o pandas, los carga (una vez). Sin ellos, el error lo explica. */
export async function prepararPython(py: PyodideMinimo, codigo: string): Promise<void> {
  const paquetes = [/\b(numpy|np\.)/.test(codigo) || /pandas|pd\./.test(codigo) ? 'numpy' : '', /pandas|pd\./.test(codigo) ? 'pandas' : ''].filter(Boolean);
  if (!paquetes.length || !py.loadPackage) return;
  try {
    await py.loadPackage(paquetes);
  } catch {
    throw new Error(`Tu código usa ${paquetes.join(' y ')} y no están en este Python. En el VPS: vuelve a correr instalar.sh (los descarga).`);
  }
}

export const MAX_COMBOS = 48;


export interface ResultadoEjecucion {
  combos: Combo[];
  /** Stop, objetivo y manejo que declaró la estrategia (GESTION), o null si opera solo con su señal. */
  gestion: ReglasSalida | null;
  posiciones: number[][];
  antiFuturo: ResultadoAntiFuturo;
}

/** Filas en el formato que ve la estrategia: cierre, close y cada Feature como clave. */
export function filasParaPython(filas: readonly FilaFeatures[]): Record<string, number | null>[] {
  return filas.map(({ inicio, cierre, open, high, low, close, volumen, delta, valores }) => ({ inicio, cierre, open: open ?? close, high: high ?? close, low: low ?? close, close, volumen: volumen ?? null, delta: delta ?? null, ...valores }));
}

/** Valida GESTION: stop en ATR > 0, RR > 0 y un modo conocido. Cualquier otra cosa es un error claro. */
export function leerGestion(g: unknown): ReglasSalida | null {
  if (g === null || g === undefined) return null;
  const x = g as Partial<ReglasSalida>;
  const gestion = x.gestion ?? 'fija';
  if (!(Number(x.stopAtr) > 0) || !(Number(x.rr) > 0) || !MODOS_GESTION.includes(gestion)) throw new Error(`GESTION no válida: usa {"stopAtr": 1.5, "rr": 2, "gestion": "fija" | "be1R" | "escalonada"}`);
  return { stopAtr: Number(x.stopAtr), rr: Number(x.rr), gestion, ...(Number(x.maxBarras) > 0 ? { maxBarras: Number(x.maxBarras) } : {}) };
}

/** Traduce un error de Python a un mensaje legible (solo la parte del código del usuario). */
export function mensajeError(e: unknown): string {
  const txt = e instanceof Error ? e.message : String(e);
  const lineas = txt.split('\n');
  const propias = lineas.filter((l) => l.includes('estrategia.py') || /^\w*Error/.test(l.trim()));
  return (propias.length ? propias : lineas.slice(-3)).join('\n').trim();
}

/** `antiFuturo: false` solo para la señal en vivo de un bot: su código ya pasó esa prueba en el Juez. */
export function ejecutarEstrategia(py: PyodideMinimo, codigo: string, filas: readonly FilaFeatures[], aviso?: (texto: string) => void, o: { antiFuturo?: boolean } = {}): ResultadoEjecucion {
  py.runPython(ARNES);
  py.globals.set('_athenai_codigo', codigo);
  py.globals.set('_athenai_filas', JSON.stringify(filasParaPython(filas)));
  const cargado = JSON.parse(String(py.runPython('_athenai_cargar(_athenai_codigo, _athenai_filas)'))) as { combos: Combo[]; gestion: unknown; forma: string };
  aviso?.(`El motor reconoció tu código como: ${FORMAS[cargado.forma] ?? cargado.forma}.`);
  const { combos } = cargado;
  const gestion = leerGestion(cargado.gestion);
  if (combos.length > MAX_COMBOS) throw new Error(`PARAMETROS genera ${combos.length} combinaciones; el máximo es ${MAX_COMBOS} (más variantes = más riesgo de sobreajuste)`);
  const correr = (p: Combo, hasta = -1) => {
    py.globals.set('_athenai_p', JSON.stringify(p));
    return JSON.parse(String(py.runPython(`_athenai_correr(_athenai_p, ${hasta})`))) as unknown[];
  };
  const posiciones = combos.map((c, i) => {
    aviso?.(`Ejecutando variante ${i + 1}/${combos.length} ${JSON.stringify(c)}`);
    return normalizarPosiciones(correr(c), filas.length);
  });

  if (o.antiFuturo === false) return { combos, gestion, posiciones, antiFuturo: { ok: true, detalle: 'ya probado en el Juez', estatico: { violaciones: [], alertas: [] }, dinamico: { cortes: 0, recorte: true, alteracion: true, fila: null, prueba: null } } };
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
  return { combos, gestion, posiciones, antiFuturo };
}
