// Precio en vivo del VPS (/api/vivo, Server-Sent Events, cada 100 ms): una sola conexión por mercado para toda la
// app, aunque lo usen el gráfico, la cabecera y el ticket a la vez. El gráfico se pinta sin pasar por React.
import { useEffect, useState } from 'react';

/** t = hora del exchange (ms) · p = último trade · b / a = mejor bid / ask. */
export interface Tick {
  t: number;
  p: number | null;
  b: number | null;
  a: number | null;
}

const canales = new Map<string, { fuente: EventSource; oyentes: Set<(t: Tick) => void>; ultimo: Tick | null }>();

/** Escucha el precio vivo de un mercado; devuelve la función para dejar de escuchar. */
export function escucharVivo(simbolo: string, f: (t: Tick) => void): () => void {
  let c = canales.get(simbolo);
  if (!c) {
    const fuente = new EventSource(`/api/vivo?simbolo=${encodeURIComponent(simbolo)}`);
    const nuevo = { fuente, oyentes: new Set<(t: Tick) => void>(), ultimo: null as Tick | null };
    fuente.onmessage = (e) => {
      nuevo.ultimo = JSON.parse(e.data as string) as Tick;
      nuevo.oyentes.forEach((o) => o(nuevo.ultimo!));
    };
    canales.set(simbolo, (c = nuevo));
  }
  c.oyentes.add(f);
  if (c.ultimo) f(c.ultimo);
  return () => {
    c.oyentes.delete(f);
    if (c.oyentes.size) return;
    c.fuente.close();
    canales.delete(simbolo);
  };
}

/** El último tick para mostrarlo en pantalla (como mucho `cadaMs`: el texto no necesita 10 repintados por segundo). */
export function useVivo(simbolo: string, cadaMs = 250): Tick | null {
  const [tick, setTick] = useState<Tick | null>(null);
  useEffect(() => {
    setTick(null);
    let ultimo: Tick | null = null;
    const reloj = setInterval(() => ultimo && (setTick(ultimo), (ultimo = null)), cadaMs);
    const dejar = escucharVivo(simbolo, (t) => (ultimo = t));
    return () => (dejar(), clearInterval(reloj));
  }, [simbolo, cadaMs]);
  return tick;
}
