/** PRNG determinista (mulberry32) para que los datos DEMO sean estables entre renders. */
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
export function serieEquity(semilla: number, pasos: number, inicio: number, deriva: number, vol: number) {
  const rand = crearAleatorio(semilla);
  const out: number[] = [inicio];
  for (let i = 1; i < pasos; i++) out.push(out[i - 1] * (1 + deriva + normal(rand) * vol));
  return out;
}

export function percentil(ordenados: number[], p: number) {
  const idx = Math.min(ordenados.length - 1, Math.max(0, Math.round((ordenados.length - 1) * p)));
  return ordenados[idx];
}
