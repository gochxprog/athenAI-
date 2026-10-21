// Motor 9 · Anti-futuro (look-ahead bias). Funciones puras; la ejecución en Python está en python.ts.
//
// Convención de la plataforma: la estrategia decide la posición con la fila i (barra ya CERRADA) y esa posición
// rige desde la barra i + 1. Es la regla «Señal(t) = f(Datos[0 : t−1])»: la orden de la barra t solo conoce
// hasta la t − 1.
//
// Paso 1 · Análisis del código (estático):
//   violación: índice hacia adelante sobre las filas (filas[i + 1], filas[i + k]) o la última fila del conjunto
//              (filas[-1], filas[len(filas) − 1]) usada para decidir;
//   alerta:    estadísticas sobre TODAS las filas (max/min/sum/mean/sorted… de «for f in filas»): normalización
//              global que incluye el futuro. No rechaza sola: la prueba dinámica lo confirma o lo descarta.
// Paso 2 · Causalidad en ejecución (dinámica), en 8 cortes t:
//   recorte:    se quitan las filas ≥ t;
//   alteración: se cambian al azar todos los valores de las filas ≥ t.
//   En los dos casos, las posiciones de las filas < t deben ser idénticas. Si cambian, usaba el futuro.
// Paso 3 · Veredicto: cualquier violación estática o fallo dinámico → RECHAZADA por look-ahead bias.
import { crearAleatorio } from '@/lib/random';

export const CORTES_ANTIFUTURO = [0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86];

export interface AnalisisCodigo {
  violaciones: string[];
  alertas: string[];
}

export interface ResultadoAntiFuturo {
  ok: boolean;
  detalle: string;
  estatico: AnalisisCodigo;
  dinamico: { cortes: number; recorte: boolean; alteracion: boolean; fila: number | null; prueba: 'recorte' | 'alteración' | null };
}

/** Quita comentarios y textos entre comillas (para no confundir un ejemplo con código). */
function limpiar(codigo: string): string {
  return codigo
    .replace(/("""|''')[\s\S]*?\1/g, '')
    .replace(/#.*$/gm, '')
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
}

export function analizarCodigo(codigo: string): AnalisisCodigo {
  const c = limpiar(codigo);
  const violaciones: string[] = [];
  const alertas: string[] = [];
  const lineas = c.split('\n');
  lineas.forEach((l, k) => {
    const n = k + 1;
    const adelante = l.match(/filas\s*\[\s*(\w+)\s*\+\s*(\w+)\s*\]/);
    if (adelante) violaciones.push(`Línea ${n}: «${adelante[0]}» lee una fila posterior a la actual.`);
    const ultima = l.match(/filas\s*\[\s*(-\s*1|len\s*\(\s*filas\s*\)\s*-\s*1)\s*\]/);
    if (ultima) violaciones.push(`Línea ${n}: «${ultima[0]}» es la última fila de todos los datos (el futuro para las filas anteriores).`);
    if (/\.shift\s*\(\s*-/.test(l)) violaciones.push(`Línea ${n}: shift negativo mueve datos del futuro al presente.`);
    const global = l.match(/\b(max|min|sum|mean|median|stdev|pstdev|sorted|statistics\.\w+)\s*\(\s*\[?[^)]*\bfor\s+\w+\s+in\s+filas\b/);
    if (global) alertas.push(`Línea ${n}: «${global[1]}(… for … in filas)» usa todas las filas a la vez (posible normalización con el futuro).`);
  });
  return { violaciones, alertas };
}

/** Copia de las filas con valores cambiados al azar desde la fila `desde` (misma longitud). */
export function alterarDesde<T extends { close: number; valores: Record<string, number | null> }>(filas: readonly T[], desde: number, semilla = 99): T[] {
  const az = crearAleatorio(semilla);
  return filas.map((f, i) => {
    if (i < desde) return f;
    const ruido = (v: number) => v * (1 + (az() - 0.5)) + (az() - 0.5);
    const valores: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(f.valores)) valores[k] = v === null ? null : ruido(v);
    return { ...f, close: Math.max(1e-9, f.close * (1 + 0.2 * (az() - 0.5))), valores };
  });
}

/** Primera fila (< hasta) en que dos series de posiciones difieren, o −1. */
export function primeraDiferencia(a: readonly number[], b: readonly number[], hasta: number): number {
  for (let i = 0; i < hasta; i += 1) if (a[i] !== b[i]) return i;
  return -1;
}
