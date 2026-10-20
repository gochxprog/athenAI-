const pad = (n: number) => String(n).padStart(2, '0');

export const hora = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const horaCorta = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

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

export function haceTiempo(min: number) {
  if (min < 1) return 'hace segundos';
  if (min < 60) return `hace ${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `hace ${h} h ${m} min` : `hace ${h} h`;
}
