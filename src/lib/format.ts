const pad = (n: number) => String(n).padStart(2, '0');

export const hora = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const fechaLarga = (d: Date) =>
  d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

/** Número con separadores españoles y agrupación siempre activa (1.284, 84.712,50). */
export function num(v: number, decimales = 0) {
  return v.toLocaleString('es-ES', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
    useGrouping: 'always' as unknown as boolean,
  });
}

export const usd = (v: number, decimales = 2) => `${v < 0 ? '−' : ''}$${num(Math.abs(v), decimales)}`;

/** Con signo explícito (+ / −), útil porque el estado nunca se codifica con color. */
export function conSigno(v: number, decimales = 0, sufijo = '') {
  const s = v > 0 ? '+' : v < 0 ? '−' : '±';
  return `${s}${num(Math.abs(v), decimales)}${sufijo}`;
}

export const pct = (v: number, decimales = 1) => `${num(v * 100, decimales)}%`;


/** Decimales necesarios para mostrar un paso de precio (0,1 → 1 · 0,25 → 2 · 1 → 0). */
export function decimalesDe(paso: number): number {
  if (!(paso > 0)) return 2;
  for (let d = 0; d <= 8; d += 1) if (Math.abs(Math.round(paso * 10 ** d) - paso * 10 ** d) < 1e-6) return d;
  return 8;
}
