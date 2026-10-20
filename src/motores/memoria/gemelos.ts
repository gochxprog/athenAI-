// Memoria del mercado: "día gemelo" y aviso de "hoy es distinto".
//
// Cada ventana de 20 dollar bars se resume en una huella (dirección, volatilidad, ritmo, agresión, absorción,
// imbalances, OI, liquidaciones). Con todas las huellas grabadas:
//   - DÍA GEMELO: las ventanas del pasado más parecidas a la de ahora y qué pasó en las 20 barras siguientes.
//     No predice: es memoria de tu propia data.
//   - HOY ES DISTINTO: si la ventana de ahora está más lejos de todo lo grabado de lo que suele estar una ventana
//     cualquiera de su vecina más cercana (percentil ≥ 98), salta el aviso. Los días raros son los que queman cuentas.
import type { FilaFeatures } from '../nucleo/features';

export const VENTANA = 20;
export const HORIZONTE = 20;
export const MIN_VENTANAS = 300;
const PERCENTIL_AVISO = 0.98;
const MUESTRA_REFERENCIA = 400;

export interface Gemelo {
  /** Cierre de la última barra de la ventana parecida. */
  cierre: number;
  distancia: number;
  /** Lo que pasó en las 20 barras siguientes. */
  retorno: number;
  maxSubida: number;
  maxBajada: number;
}

export interface ResultadoMemoria {
  ventanas: number;
  gemelos: Gemelo[];
  /** Resumen de lo que pasó después en los gemelos. */
  resumen: { subieron: number; retornoMedio: number; retornoMediano: number } | null;
  distinto: { percentil: number; distancia: number; aviso: boolean; motivo: string };
}

type Fila = FilaFeatures & { sesion?: number };

const val = (f: Fila, k: string) => f.valores[k] ?? 0;

/** Huella de la ventana que termina en `fin` (inclusive). */
function huella(filas: readonly Fila[], fin: number): number[] {
  let suma = 0;
  let sumaAbs = 0;
  let sq = 0;
  const acc = new Array(8).fill(0);
  for (let i = fin - VENTANA + 1; i <= fin; i += 1) {
    const f = filas[i];
    const r = val(f, 'retorno');
    suma += r;
    sumaAbs += Math.abs(r);
    sq += r * r;
    acc[0] += Math.log(Math.max(val(f, 'rango_atr'), 1e-3));
    acc[1] += Math.log(Math.max(val(f, 'duracion_s'), 0.05));
    acc[2] += val(f, 'delta_ratio');
    acc[3] += (val(f, 'absorcion_ask') + val(f, 'absorcion_bid')) / 100;
    acc[4] += val(f, 'imb_compra') - val(f, 'imb_venta');
    acc[5] += val(f, 'oi_delta_pct');
    acc[6] += Math.log1p((val(f, 'liq_largos_usd') + val(f, 'liq_cortos_usd')) / 1e5);
    acc[7] += Math.log1p((val(f, 'bigtrades_compra_usd') + val(f, 'bigtrades_venta_usd')) / 1e5);
  }
  const sd = Math.sqrt(sq / VENTANA) || 1e-9;
  return [suma / (sd * Math.sqrt(VENTANA)), sumaAbs > 0 ? Math.abs(suma) / sumaAbs : 0, ...acc.map((v) => v / VENTANA)];
}

/** Una ventana es válida si no cruza huecos ni cambios de sesión. */
function ventanaValida(filas: readonly Fila[], fin: number): boolean {
  if (fin - VENTANA + 1 < 0) return false;
  const s = filas[fin].sesion;
  for (let i = fin - VENTANA + 1; i <= fin; i += 1) {
    if (filas[i].valores.hueco === 1 && i > fin - VENTANA + 1) return false;
    if (filas[i].sesion !== s) return false;
  }
  return true;
}

function futuroValido(filas: readonly Fila[], fin: number): boolean {
  if (fin + HORIZONTE >= filas.length) return false;
  const s = filas[fin].sesion;
  for (let i = fin + 1; i <= fin + HORIZONTE; i += 1) if (filas[i].valores.hueco === 1 || filas[i].sesion !== s) return false;
  return true;
}

const dist = (a: readonly number[], b: readonly number[]) => Math.sqrt(a.reduce((s, v, j) => s + (v - b[j]) ** 2, 0));

export function buscarMemoria(filas: readonly Fila[], opciones: { k?: number } = {}): ResultadoMemoria | null {
  const n = filas.length;
  const ultima = n - 1;
  if (!ventanaValida(filas, ultima)) return null;
  const fines: number[] = [];
  for (let e = VENTANA - 1; e < n; e += 1) if (ventanaValida(filas, e)) fines.push(e);
  if (fines.length < MIN_VENTANAS) return null;

  // Huellas estandarizadas (cada dimensión pesa lo mismo).
  const crudas = fines.map((e) => huella(filas, e));
  const d = crudas[0].length;
  const media = new Array(d).fill(0);
  for (const h of crudas) h.forEach((v, j) => (media[j] += v / crudas.length));
  const desv = new Array(d).fill(0);
  for (const h of crudas) h.forEach((v, j) => (desv[j] += (v - media[j]) ** 2 / crudas.length));
  for (let j = 0; j < d; j += 1) desv[j] = Math.sqrt(desv[j]) || 1;
  const h = crudas.map((x) => x.map((v, j) => (v - media[j]) / desv[j]));
  const actual = h[h.length - 1];

  // Vecina más cercana de cualquier ventana, excluyendo las que se solapan con ella.
  const vecinaMasCercana = (pos: number): number => {
    let min = Infinity;
    for (let q = 0; q < h.length; q += 1) {
      if (Math.abs(fines[q] - fines[pos]) < VENTANA) continue;
      const dd = dist(h[pos], h[q]);
      if (dd < min) min = dd;
    }
    return min;
  };

  const dActual = vecinaMasCercana(h.length - 1);
  // Distribución de referencia: distancia a la vecina más cercana de ventanas del pasado (muestra regular).
  const paso = Math.max(1, Math.floor((h.length - 1) / MUESTRA_REFERENCIA));
  const referencia: number[] = [];
  for (let p = 0; p < h.length - VENTANA; p += paso) {
    const dd = vecinaMasCercana(p);
    if (Number.isFinite(dd)) referencia.push(dd);
  }
  const percentil = referencia.length ? referencia.filter((x) => x < dActual).length / referencia.length : 0;
  const aviso = percentil >= PERCENTIL_AVISO;
  // Qué dimensión explica más la diferencia con la vecina más cercana.
  const NOMBRES = ['dirección', 'eficiencia', 'volatilidad', 'ritmo', 'agresión', 'absorción', 'imbalances', 'Open Interest', 'liquidaciones', 'big trades'];
  let mayor = 0;
  actual.forEach((v, j) => {
    if (Math.abs(v) > Math.abs(actual[mayor])) mayor = j;
  });
  const motivo = aviso
    ? `La última ventana de ${VENTANA} barras no se parece a nada de lo grabado (percentil ${(percentil * 100).toFixed(0)}). Lo más fuera de lo normal: ${NOMBRES[mayor]} (${actual[mayor] > 0 ? 'muy alto' : 'muy bajo'}).`
    : `Normal: lo de ahora tiene parecidos en lo grabado (percentil ${(percentil * 100).toFixed(0)}).`;

  // Gemelos: más cercanos con futuro conocido, sin solaparse con ahora ni entre sí.
  const candidatos = h
    .map((x, q) => ({ q, d: dist(actual, x) }))
    .filter(({ q }) => ultima - fines[q] >= VENTANA + HORIZONTE && futuroValido(filas, fines[q]))
    .sort((a, b) => a.d - b.d);
  const elegidos: { q: number; d: number }[] = [];
  for (const c of candidatos) {
    if (elegidos.length >= (opciones.k ?? 8)) break;
    if (elegidos.some((e) => Math.abs(fines[e.q] - fines[c.q]) < VENTANA)) continue;
    elegidos.push(c);
  }
  const gemelos: Gemelo[] = elegidos.map(({ q, d: dd }) => {
    const e = fines[q];
    const base = filas[e].close;
    let maxS = -Infinity;
    let maxB = Infinity;
    for (let i = e + 1; i <= e + HORIZONTE; i += 1) {
      maxS = Math.max(maxS, filas[i].close / base - 1);
      maxB = Math.min(maxB, filas[i].close / base - 1);
    }
    return { cierre: filas[e].cierre, distancia: dd, retorno: filas[e + HORIZONTE].close / base - 1, maxSubida: maxS, maxBajada: maxB };
  });
  const rets = gemelos.map((g) => g.retorno).sort((a, b) => a - b);
  const resumen = gemelos.length
    ? { subieron: gemelos.filter((g) => g.retorno > 0).length, retornoMedio: rets.reduce((a, v) => a + v, 0) / rets.length, retornoMediano: rets[Math.floor(rets.length / 2)] }
    : null;
  return { ventanas: fines.length, gemelos, resumen, distinto: { percentil, distancia: dActual, aviso, motivo } };
}
