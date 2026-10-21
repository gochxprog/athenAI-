// Controles anti-fuga para la fase de machine learning. AQUÍ NO HAY NINGÚN MODELO: solo lo que debe cumplir un
// dataset antes de entrenar y cómo dividirlo en el tiempo sin que el futuro se cuele (docs/AUDITORIA_FUGAS.md §7).
//
// Dataset = CSV del Etiquetador de UN mercado (market_id): una fila por evento t₀ con sus Features en t₀ y su
// etiqueta (que mira hacia delante hasta evento_fin, a propósito: es la «respuesta»).
//
// 1. Columnas: solo las Features (y el lado y la σ del evento, conocidos en t₀) pueden ser entradas del modelo.
//    Las columnas de la RESPUESTA (evento_fin, barrera, etiqueta, meta, retorno, barras) nunca.
// 2. Partición walk-forward PURGADA con embargo: se entrena solo con eventos anteriores cuyo resultado terminó
//    (evento_fin) antes de que empiece el tramo de prueba menos el embargo. Nunca se baraja.
// 3. Verificación: un solo mercado, orden cronológico sin repetidos, evento_fin > evento_inicio, ninguna Feature
//    con nombre de respuesta y ninguna Feature casi idéntica a la etiqueta (|correlación| ≥ 0,95 = fuga casi segura).

/** Columnas que identifican la fila (no son entradas). */
export const COLUMNAS_IDENTIDAD = ['market_id', 'evento_inicio', 'evento_precio'] as const;
/** Columnas de la respuesta: miran al futuro. JAMÁS pueden ser entradas del modelo. */
export const COLUMNAS_RESPUESTA = ['evento_fin', 'evento_barrera', 'etiqueta', 'meta', 'evento_retorno', 'evento_barras'] as const;
/** Conocidas en t₀ (lado de la señal y volatilidad pasada): pueden ser entradas. */
export const COLUMNAS_CONTEXTO = ['evento_lado', 'evento_sigma'] as const;

const NO_ENTRADAS = new Set<string>([...COLUMNAS_IDENTIDAD, ...COLUMNAS_RESPUESTA]);
export const CORRELACION_FUGA = 0.95;

/** Columnas que el modelo puede usar como entrada: todo menos identidad y respuesta. */
export function columnasEntrada(cabecera: readonly string[]): string[] {
  return cabecera.filter((c) => !NO_ENTRADAS.has(c));
}

export interface FilaDataset {
  [columna: string]: string;
}

export function leerCsv(csv: string): { cabecera: string[]; filas: FilaDataset[] } {
  const [cab, ...lineas] = csv.trim().split('\n');
  const cabecera = (cab ?? '').split(',');
  return { cabecera, filas: lineas.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cabecera[i], v]))) };
}

function correlacion(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length;
  if (n < 10) return null;
  const mx = x.reduce((a, v) => a + v, 0) / n;
  const my = y.reduce((a, v) => a + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export interface Verificacion {
  ok: boolean;
  mercado: string | null;
  filas: number;
  entradas: string[];
  problemas: string[];
}

/** Revisa un dataset del Etiquetador antes de entrenar. `ok` = ningún problema. */
export function verificarDataset(csv: string): Verificacion {
  const { cabecera, filas } = leerCsv(csv);
  const problemas: string[] = [];
  for (const c of ['market_id', 'evento_inicio', 'evento_fin', 'etiqueta']) if (!cabecera.includes(c)) problemas.push(`Falta la columna ${c}.`);
  const mercados = [...new Set(filas.map((f) => f.market_id))];
  if (mercados.length > 1) problemas.push(`Mezcla ${mercados.length} mercados (${mercados.join(', ')}): un dataset = un mercado.`);
  const t0 = filas.map((f) => Date.parse(f.evento_inicio));
  const t1 = filas.map((f) => Date.parse(f.evento_fin));
  for (let i = 0; i < filas.length; i += 1) {
    if (!Number.isFinite(t0[i]) || !Number.isFinite(t1[i])) {
      problemas.push(`Fila ${i + 1}: fechas no válidas.`);
      break;
    }
    if (t1[i] <= t0[i]) {
      problemas.push(`Fila ${i + 1}: evento_fin no es posterior a evento_inicio.`);
      break;
    }
    if (i > 0 && t0[i] <= t0[i - 1]) {
      problemas.push(`Fila ${i + 1}: no está en orden cronológico o está repetida.`);
      break;
    }
  }
  const entradas = columnasEntrada(cabecera);
  // Una Feature casi idéntica a la etiqueta solo puede salir de mirar el futuro.
  const y = filas.map((f) => Number(f.etiqueta));
  for (const c of entradas) {
    const pares = filas.map((f, i) => [Number(f[c]), y[i]] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    const r = correlacion(pares.map((p) => p[0]), pares.map((p) => p[1]));
    if (r !== null && Math.abs(r) >= CORRELACION_FUGA) problemas.push(`La columna «${c}» es casi igual a la etiqueta (correlación ${r.toFixed(3)}): posible fuga del futuro.`);
  }
  return { ok: problemas.length === 0, mercado: mercados.length === 1 ? mercados[0] : null, filas: filas.length, entradas, problemas };
}


export interface Muestra {
  /** Momento de la decisión (cierre de t₀), ms. */
  inicio: number;
  /** Momento en que se conoce la respuesta (evento_fin), ms. */
  fin: number;
}

export interface Particion {
  entreno: number[];
  prueba: number[];
}

/**
 * Walk-forward purgado: el primer `fraccionInicial` solo entrena; el resto se corta en `tramos` bloques de prueba
 * consecutivos. Para cada bloque se entrena con los eventos ANTERIORES cuyo resultado se conoció antes de que
 * empiece la prueba menos el embargo: fin + embargoMs < inicio del primer evento de prueba (purga de solapes).
 * Las muestras deben venir en orden cronológico de inicio.
 */
export function walkForwardPurgado(m: readonly Muestra[], o: { tramos: number; fraccionInicial?: number; embargoMs?: number }): Particion[] {
  for (let i = 1; i < m.length; i += 1) if (m[i].inicio < m[i - 1].inicio) throw new Error('Las muestras deben estar en orden cronológico.');
  const tramos = Math.max(1, Math.floor(o.tramos));
  const embargo = Math.max(0, o.embargoMs ?? 0);
  const desde = Math.floor(m.length * Math.min(0.9, Math.max(0.1, o.fraccionInicial ?? 0.3)));
  const largo = Math.floor((m.length - desde) / tramos);
  const out: Particion[] = [];
  if (largo < 1) return out;
  for (let k = 0; k < tramos; k += 1) {
    const a = desde + k * largo;
    const b = k === tramos - 1 ? m.length : a + largo;
    const inicioPrueba = m[a].inicio;
    const entreno: number[] = [];
    for (let i = 0; i < a; i += 1) if (m[i].fin + embargo < inicioPrueba) entreno.push(i);
    out.push({ entreno, prueba: Array.from({ length: b - a }, (_, j) => a + j) });
  }
  return out;
}
