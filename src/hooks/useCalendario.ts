import { useEffect, useState } from 'react';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import { eventoEnVentana, proximoEvento, type EventoCalendario } from '@/motores/nucleo/calendario';

/** Calendario de eventos fuertes con el evento en curso (ventana de no operar) y el próximo. */
export function useCalendario() {
  const [eventos, setEventos] = useState<EventoCalendario[]>(motorOrderFlow.calendario);
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => motorOrderFlow.suscribirCalendario(setEventos), []);
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const altos = eventos.filter((e) => e.impacto === 'alto');
  return { eventos, enCurso: eventoEnVentana(altos, ahora), proximo: proximoEvento(eventos, ahora), ahora };
}

/** "en 3 d 4 h", "en 25 min", "ahora". */
export function faltaPara(t: number, ahora: number): string {
  const min = Math.round((t - ahora) / 60_000);
  if (Math.abs(min) < 1) return 'ahora';
  if (min < 0) return `hace ${-min} min`;
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `en ${h} h ${min % 60} min`;
  return `en ${Math.floor(h / 24)} d ${h % 24} h`;
}
