// Features "fuera de lo normal": z de la última fila frente a las barras previas (solo pasado).
import { DEFINICIONES_FEATURES, type FilaFeatures } from '../nucleo/features';

export interface FeatureExtrema {
  clave: string;
  nombre: string;
  valor: number;
  /** (valor − media) / desviación de las barras previas. */
  z: number;
  /** Fracción de barras previas con valor ≤ al actual (0–1). */
  percentil: number;
  /** Últimos valores (para el minigráfico). */
  serie: number[];
}

/** Indicadores (0/1), categorías o acumulados: su z no dice nada útil. */
const EXCLUIDAS = new Set(['hueco', 'ventana_evento', 'oi_cuadrante', 'oi_flush', 'cvd_sesion']);
const NOMBRE = new Map(DEFINICIONES_FEATURES.map((d) => [d.clave, d.nombre]));

export function featuresExtremas(filas: readonly FilaFeatures[], n = 3, ventana = 200, minimo = 30): FeatureExtrema[] {
  if (filas.length < minimo + 1) return [];
  const ultima = filas[filas.length - 1];
  const previas = filas.slice(-ventana - 1, -1);
  const salida: FeatureExtrema[] = [];
  for (const [clave, v] of Object.entries(ultima.valores)) {
    if (EXCLUIDAS.has(clave) || v === null || !Number.isFinite(v)) continue;
    const xs = previas.map((f) => f.valores[clave]).filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x));
    if (xs.length < minimo) continue;
    const media = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - media) ** 2, 0) / xs.length);
    if (sd <= 1e-12) continue;
    const serie = filas
      .slice(-40)
      .map((f) => f.valores[clave])
      .filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x));
    salida.push({ clave, nombre: NOMBRE.get(clave) ?? clave, valor: v, z: (v - media) / sd, percentil: xs.filter((x) => x <= v).length / xs.length, serie });
  }
  return salida.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, n);
}
