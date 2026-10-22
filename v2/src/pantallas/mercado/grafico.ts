// Lo que comparten los gráficos de velas de Mercado y de la Terminal: las velas del VPS (historia + grabado, y la
// vela que se forma con lo último grabado) y las marcas de las operaciones (entradas, salidas, stop y objetivo).
import { useEffect, useMemo, useState } from 'react';
import { armarVelas, type Serie } from '@/motores/laboratorio/velas';
import type { FilaFeatures } from '@/motores/nucleo/features';
import type { Bot, OperacionPaper } from '@/motores/paper/ejecutor';
import { tieneObjetivo } from '@/motores/paper/manual';
import { pedir } from '../../api';
import { usd } from '../../formato';
import { useVps } from '../../vps';
import type { Linea, Marca, VelaG } from './Velas';

export const SERIES_G = ['1m', '5m', '15m', '1h', '4h'] as const satisfies readonly Exclude<Serie, 'dollar'>[];
export type SerieG = (typeof SERIES_G)[number];

/** Velas de un mercado (cada 2 min del VPS) y las vivas (cada 5 s, con las filas recién grabadas). */
export function useVelasVps(simbolo: string, serie: SerieG) {
  const v = useVps();
  const [velas, setVelas] = useState<VelaG[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let vivo = true;
    setVelas([]);
    const cargar = () =>
      pedir<{ velas: VelaG[] }>(`/api/velas?simbolo=${simbolo}&serie=${serie}&n=600`).then(
        (x) => vivo && (setVelas(x.velas), setError('')),
        (e: Error) => vivo && setError(e.message),
      );
    void cargar();
    const id = setInterval(cargar, 120_000);
    return () => ((vivo = false), clearInterval(id));
  }, [simbolo, serie]);
  const vivas = useMemo<VelaG[]>(() => armarVelas((v.filas[simbolo] ?? []) as unknown as FilaFeatures[], serie).map((x) => [x.inicio, x.open, x.high, x.low, x.close]), [v.filas, simbolo, serie]);
  return { velas, vivas, error };
}

/** Entradas y salidas cerradas (últimas 40) y, de cada posición abierta, su entrada, stop y objetivo. */
export function marcasYLineas(ops: OperacionPaper[], bots: Bot[], simbolo: string, ms: number): { marcas: Marca[]; lineas: Linea[] } {
  const balde = (t: number) => Math.floor(t / ms) * ms;
  const marcas: Marca[] = ops.filter((o) => o.simbolo === simbolo).slice(-40).flatMap((o) => [
    { t: balde(o.entradaT), lado: o.lado, tipo: 'entrada' as const, texto: o.lado > 0 ? 'L' : 'C' },
    { t: balde(o.salidaT), lado: o.lado, tipo: 'salida' as const, texto: usd(o.pnl).replace(' USD', ''), gana: o.pnl >= 0 },
  ]);
  const lineas: Linea[] = bots
    .filter((b) => b.simbolo === simbolo && b.posicion)
    .flatMap((b) => {
      const g = b.gestion?.posicion;
      return [
        { precio: b.posicion!.precioEntrada, titulo: `${b.nombre} ${b.posicion!.lado > 0 ? '▲' : '▼'}`, tipo: 'entrada' as const },
        ...(g ? [{ precio: g.stop, titulo: 'stop', tipo: 'stop' as const }] : []),
        ...(g && tieneObjetivo(g.objetivo) ? [{ precio: g.objetivo, titulo: 'objetivo', tipo: 'objetivo' as const }] : []),
      ];
    });
  return { marcas, lineas };
}
