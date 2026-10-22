// Motor 9 · Anti-futuro (look-ahead bias). Funciones puras; la ejecución en Python está en python.ts.
//
// Convención de la plataforma: la estrategia decide la posición con la fila i (barra ya CERRADA) y esa posición
// rige desde la barra i + 1. Es la regla «Señal(t) = f(Datos[0 : t−1])»: la orden de la barra t solo conoce
// hasta la t − 1.
//
// Paso 1 · Análisis del código (estático): SOLO alertas (índices hacia adelante, shift negativo, ventanas
//   centradas, estadísticas sobre todas las velas). Con el código libre, un patrón así puede ser honesto.
// Paso 2 · Causalidad en ejecución (dinámica), en 12 cortes t y en TODAS las variantes (la primera en los 12, las
//   demás en 4), cada corrida en un Python limpio y antes de la corrida completa (python.ts):
//   recorte:    se quitan las velas ≥ t;
//   alteración: se cambian al azar TODOS los valores (OHLC, volumen, delta y Features) de las velas ≥ t.
//   En los dos casos, las posiciones de las velas < t deben ser idénticas. Si cambian, usaba el futuro.
// Paso 3 · Veredicto: cualquier fallo dinámico → RECHAZADA por look-ahead bias.
import { crearAleatorio } from '@/lib/random';

export const CORTES_ANTIFUTURO = [0.27, 0.33, 0.39, 0.45, 0.51, 0.57, 0.63, 0.69, 0.75, 0.81, 0.87, 0.93];

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
  // Solo alertas: con el código libre, «filas[-1]» o «filas[i + 1]» pueden ser honestos (la historia hasta la vela
  // actual, o la posición de la vela siguiente). Quien decide es la prueba dinámica, que no se puede engañar.
  const alertas: string[] = [];
  limpiar(codigo).split('\n').forEach((l, k) => {
    const n = k + 1;
    const adelante = l.match(/\w+\s*\[\s*(\w+)\s*\+\s*(\w+)\s*\]/);
    if (adelante) alertas.push(`Línea ${n}: «${adelante[0]}» puede leer una vela posterior.`);
    if (/\.shift\s*\(\s*-/.test(l)) alertas.push(`Línea ${n}: shift negativo mueve datos del futuro al presente.`);
    if (/center\s*=\s*True/.test(l)) alertas.push(`Línea ${n}: una ventana centrada usa velas posteriores.`);
    const global = l.match(/\b(max|min|sum|mean|median|stdev|pstdev|sorted|statistics\.\w+)\s*\(\s*\[?[^)]*\bfor\s+\w+\s+in\s+\w+\b/);
    if (global) alertas.push(`Línea ${n}: «${global[1]}(… for … in …)» usa todas las velas a la vez (posible normalización con el futuro).`);
  });
  return { violaciones: [], alertas };
}

/** Copia de las filas con TODO cambiado al azar desde la fila `desde` (OHLC, volumen, delta y Features). */
export function alterarDesde<T extends { close: number; open?: number; high?: number; low?: number; volumen?: number; delta?: number; valores: Record<string, number | null> }>(filas: readonly T[], desde: number, semilla = 99): T[] {
  const az = crearAleatorio(semilla);
  const ruido = (v: number) => v * (1 + (az() - 0.5)) + (az() - 0.5);
  const precio = (v: number | undefined) => (v === undefined ? undefined : Math.max(1e-9, v * (1 + 0.2 * (az() - 0.5))));
  return filas.map((f, i) => {
    if (i < desde) return f;
    const valores: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(f.valores)) valores[k] = v === null ? null : ruido(v);
    const x = { ...f, close: precio(f.close)!, open: precio(f.open), high: precio(f.high), low: precio(f.low), volumen: f.volumen === undefined ? undefined : Math.abs(ruido(f.volumen)), delta: f.delta === undefined ? undefined : ruido(f.delta), valores };
    for (const k of ['open', 'high', 'low', 'volumen', 'delta'] as const) if (x[k] === undefined) delete x[k];
    return x;
  });
}

/** Primera fila (< hasta) en que dos series de posiciones difieren, o −1. */
export function primeraDiferencia(a: readonly number[], b: readonly number[], hasta: number): number {
  for (let i = 0; i < hasta; i += 1) if (a[i] !== b[i]) return i;
  return -1;
}
