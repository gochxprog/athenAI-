// Tema «Quant Desk» para los gráficos del Juez (Recharts): fondo zinc-950, rejilla tenue, acentos solo con significado.
export const COLOR = {
  rejilla: '#27272a', // zinc-800
  eje: '#71717a', // zinc-500
  texto: '#a1a1aa', // zinc-400
  linea: '#e4e4e7', // zinc-200
  is: '#71717a', // zinc-500: entrenamiento
  oos: '#f4f4f5', // zinc-100: fuera de muestra
  positivo: '#34d399', // emerald-400 (PnL +)
  negativo: '#fb7185', // rose-400 (PnL −)
  aprobado: '#22d3ee', // cyan-400 (estado del Juez)
  reserva: '#fbbf24', // amber-400
} as const;

export const EJE = { stroke: COLOR.rejilla, tick: { fill: COLOR.eje, fontSize: 10, fontFamily: '"JetBrains Mono", ui-monospace, monospace' }, tickLine: false, axisLine: false } as const;

const nf = (d: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
export const numero = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : nf(d).format(v));
export const porcentaje = (v: number | null | undefined, d = 1, signo = true) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${signo && v > 0 ? '+' : ''}${nf(d).format(v * 100)}%`);
/** Porcentaje corto para los ejes: 1 decimal si es pequeño, «k%» si pasa de 1000%. */
export const pctEje = (v: number) => {
  const a = Math.abs(v);
  if (a >= 10) return `${v > 0 ? '+' : '−'}${nf(1).format(a * 0.1)}k%`;
  return porcentaje(v, a < 0.1 ? 1 : 0);
};
export const dinero = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${nf(d).format(Math.abs(v))}`);
export const fechaCorta = (t: number) => new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
export const fechaHora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Reduce una serie a ~n puntos (manteniendo el último) para que Recharts dibuje rápido. */
export function reducir<T>(xs: readonly T[], n = 600): T[] {
  if (xs.length <= n) return [...xs];
  const out: T[] = [];
  for (let k = 0; k < n; k += 1) out.push(xs[Math.round((k / (n - 1)) * (xs.length - 1))]);
  return out;
}

/** Histograma: cuenta valores en `cubos` intervalos iguales. */
export function histograma(valores: readonly number[], cubos = 30, rango?: [number, number]) {
  if (!valores.length) return [];
  const lo = rango?.[0] ?? Math.min(...valores);
  const hi = rango?.[1] ?? Math.max(...valores);
  const ancho = (hi - lo) / cubos || 1;
  const c = Array.from({ length: cubos }, (_, i) => ({ desde: lo + i * ancho, hasta: lo + (i + 1) * ancho, centro: lo + (i + 0.5) * ancho, n: 0 }));
  for (const v of valores) c[Math.max(0, Math.min(cubos - 1, Math.floor((v - lo) / ancho)))].n += 1;
  return c;
}
