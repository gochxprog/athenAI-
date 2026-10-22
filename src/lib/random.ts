/** Generador pseudoaleatorio determinista (mulberry32): misma semilla → mismos números (Monte Carlo, Luck test). */
export function crearAleatorio(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normal estándar (Box–Muller). */
export function normal(rand: () => number) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function elegir<T>(rand: () => number, lista: readonly T[]): T {
  return lista[Math.floor(rand() * lista.length)];
}

/** Serie de equity con deriva y volatilidad por paso. */

export function percentil(ordenados: number[], p: number) {
  const idx = Math.min(ordenados.length - 1, Math.max(0, Math.round((ordenados.length - 1) * p)));
  return ordenados[idx];
}
