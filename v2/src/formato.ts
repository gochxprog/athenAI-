// Formatos de números de la v2 (español): cifras, porcentajes con signo y USD con signo.
export const num = (v: number, d = 2) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${num(v * 100, d)} %`);
export const usd = (v: number) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v))} USD`;
