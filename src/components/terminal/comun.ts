// Piezas comunes de la Terminal: formato, nombres de estado y hooks del motor de Paper (VPS o navegador).
import { useEffect, useState } from 'react';
import { motorPaper } from '@/motores/paper/iniciar';
import type { EstadoBot, OperacionPaper } from '@/motores/paper/ejecutor';
import { conSigno } from '@/lib/format';

export const pct = (v: number, d = 2) => conSigno(v * 100, d, '%');
export const usd = (v: number) => `${conSigno(v, 2)} USD`;
export const hora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const NOMBRE_ESTADO: Record<EstadoBot, string> = {
  activo: 'Activo',
  'sin-datos': 'Sin datos',
  'pausado-dia': 'Pausado hasta mañana',
  cuarentena: 'Cuarentena',
  'fuera-de-banda': 'Fuera de la banda del Juez',
  pausado: 'Pausado',
  apagado: 'Apagado',
};

/** Re-renderiza con cada revisión del motor de Paper (1 vez por segundo). */
export function useMotorPaper() {
  const [, setN] = useState(0);
  useEffect(() => motorPaper.suscribir(() => setN((n) => n + 1)), []);
  return motorPaper;
}

export function useOperaciones(total: number): OperacionPaper[] {
  const [ops, setOps] = useState<OperacionPaper[]>([]);
  useEffect(() => {
    let vivo = true;
    void motorPaper.operaciones().then((x) => vivo && setOps(x));
    return () => {
      vivo = false;
    };
  }, [total]);
  return ops;
}

export const ahoraSuscribir = (cb: () => void) => {
  const id = setInterval(cb, 1_000);
  return () => clearInterval(id);
};

