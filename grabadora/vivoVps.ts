// Precio en vivo de cada mercado (último trade, mejor bid y ask), juntado cada 100 ms: lo reciben la web por
// /api/vivo (Server-Sent Events) y los bots, que vigilan stop y objetivo con él (no 1 vez por segundo).
// Binance manda trades y libro cada 100 ms: juntar a 100 ms no pierde nada y acota los mensajes a 10/s.

export interface Tick {
  /** Hora del exchange (ms). */
  t: number;
  p: number | null;
  b: number | null;
  a: number | null;
}

export const CADA_MS = 100;
/** Conexiones abiertas como mucho (cada pestaña abierta es una). */
export const MAX_OYENTES = 50;

export interface ApiVivo {
  ultimo(simbolo: string): Tick | null;
  /** Devuelve la función para dejar de escuchar, o null si ya hay demasiadas conexiones. */
  escuchar(simbolo: string, f: (t: Tick) => void): (() => void) | null;
}

export function crearVivo(alTick?: (simbolo: string, t: Tick) => void) {
  const ultimos = new Map<string, Tick>();
  const oyentes = new Map<string, Set<(t: Tick) => void>>();
  const cambiados = new Set<string>();
  let total = 0;
  const reloj = setInterval(() => {
    for (const s of cambiados) {
      const t = ultimos.get(s)!;
      alTick?.(s, t);
      oyentes.get(s)?.forEach((f) => f(t));
    }
    cambiados.clear();
  }, CADA_MS);
  return {
    actualizar(simbolo: string, t: Tick) {
      const u = ultimos.get(simbolo);
      if (u && u.p === t.p && u.b === t.b && u.a === t.a) return;
      ultimos.set(simbolo, t);
      cambiados.add(simbolo);
    },
    ultimo: (simbolo: string) => ultimos.get(simbolo) ?? null,
    escuchar(simbolo: string, f: (t: Tick) => void) {
      if (total >= MAX_OYENTES) return null;
      const set = oyentes.get(simbolo) ?? new Set();
      oyentes.set(simbolo, set);
      set.add(f);
      total += 1;
      return () => {
        if (set.delete(f)) total -= 1;
      };
    },
    detener: () => clearInterval(reloj),
  };
}
