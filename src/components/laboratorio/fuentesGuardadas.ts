// Mercados con Features grabadas (por carpeta de fuente), ordenados por número de filas.
import { useEffect, useState } from 'react';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import type { Proveedor, ResumenSimbolo } from '@/motores/worker/protocolo';
import { mercadoIdSeguro } from '@/motores/mercado/mercadoId';

export type FuenteGuardada = { proveedor: Proveedor; simbolo: string; filas: number };

/** Clave de un mercado grabado: su market_id (única definición en motores/mercado/mercadoId.ts). */
export const claveFuente = (f: { proveedor: string; simbolo: string }): string => mercadoIdSeguro(f.proveedor, f.simbolo) ?? `${f.proveedor}:${f.simbolo}`;

export function useFuentesGuardadas(): FuenteGuardada[] {
  const [fuentes, setFuentes] = useState<FuenteGuardada[]>([]);
  useEffect(() => {
    motorOrderFlow.resumenAlmacen().then(
      (r) => {
        const xs: FuenteGuardada[] = [];
        for (const [p, lista] of Object.entries(r) as [Proveedor, ResumenSimbolo[]][]) for (const s of lista) if (s.filas > 0) xs.push({ proveedor: p, simbolo: s.simbolo, filas: s.filas });
        setFuentes(xs.sort((a, b) => b.filas - a.filas));
      },
      () => setFuentes([]),
    );
  }, []);
  return fuentes;
}
