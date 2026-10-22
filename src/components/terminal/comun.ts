// Piezas comunes de la Terminal: formato, nombres de estado y hooks del motor de Paper (VPS o navegador).
import { useEffect, useState } from 'react';
import { motorPaper } from '@/motores/paper/iniciar';
import type { EstadoBot, OperacionPaper } from '@/motores/paper/ejecutor';
import { conSigno } from '@/lib/format';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import { grabadora } from '@/motores/grabadora/cliente';

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

/** Filas de Features grabadas de un mercado: la carpeta con más historia (la del VPS o la de este navegador). */
export function useFilasGrabadas(simbolo: string | undefined): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!simbolo) return;
    let vivo = true;
    const leer = () =>
      motorOrderFlow.resumenAlmacen().then(
        (r) => vivo && setN(Math.max(0, ...(['grabadora', 'binance'] as const).map((p) => r[p]?.find((x) => x.simbolo === simbolo)?.filas ?? 0))),
        () => undefined,
      );
    void leer();
    const id = setInterval(leer, 60_000);
    const fuera = grabadora.suscribir(() => !grabadora.estado.enCurso && void leer());
    return () => {
      vivo = false;
      clearInterval(id);
      fuera();
    };
  }, [simbolo]);
  return n;
}
