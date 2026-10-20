const pad = (n) => String(n).padStart(2, '0');

/** HH:MM:SS en 24h, hora local. */
export function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "20 de octubre de 2026" */
export function formatLongDate(date) {
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
