/** Matemática pura del mapa de liquidez (sin DOM ni canvas). */

/** Percentil `p` (0..1) por interpolación lineal. Ignora valores no finitos o negativos. Devuelve 0 si no hay datos. */
export function percentile(values: ArrayLike<number>, p: number, scratch?: number[]): number {
  // `scratch` (opcional): array reutilizable del llamador → sin asignar una copia por llamada en bucles de render.
  const clean: number[] = scratch ?? [];
  clean.length = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (Number.isFinite(v) && v >= 0) clean.push(v);
  }
  if (clean.length === 0) return 0;
  clean.sort((a, b) => a - b);
  const q = Math.min(1, Math.max(0, p));
  const pos = q * (clean.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return clean[lo] + (clean[hi] - clean[lo]) * (pos - lo);
}
