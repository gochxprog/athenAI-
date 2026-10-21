// Agrupación del DOM en pantalla: junta niveles del libro en escalones más grandes (×5, ×10…) para ver más lejos.
// Solo para dibujar: el motor del libro y las Features usan siempre su vista original.
import type { LibroGrafico } from '@/motores/nucleo/pipeline';

export const AGRUPACIONES = [1, 5, 10, 25, 100] as const;

export interface NivelDom {
  p: number;
  tam: number;
  /** 1 = la liquidez crece (stacking), −1 = se retira (pulling), 0 = mixto o quieto. */
  tendencia: number;
}

/**
 * Agrupa por escalones de `paso × factor`. Como el resto del sistema: un ask se redondea hacia arriba y un bid hacia
 * abajo (el escalón nunca cruza el spread). Devuelve asks de menor a mayor precio y bids de mayor a menor.
 */
export function agruparLibro(libro: Pick<LibroGrafico, 'bids' | 'asks' | 'paso'>, factor: number): { asks: NivelDom[]; bids: NivelDom[]; paso: number } {
  const paso = libro.paso * Math.max(1, factor);
  const juntar = (lado: readonly [number, number, number][], arriba: boolean) => {
    const m = new Map<number, { tam: number; sube: boolean; baja: boolean }>();
    for (const [p, q, t] of lado) {
      const k = arriba ? Math.ceil(p / paso - 1e-9) : Math.floor(p / paso + 1e-9);
      const x = m.get(k) ?? { tam: 0, sube: false, baja: false };
      x.tam += q;
      if (t > 0) x.sube = true;
      if (t < 0) x.baja = true;
      m.set(k, x);
    }
    return [...m].map(([k, x]) => ({ p: Number((k * paso).toPrecision(15)), tam: x.tam, tendencia: x.sube && !x.baja ? 1 : x.baja && !x.sube ? -1 : 0 }));
  };
  return {
    asks: juntar(libro.asks, true).sort((a, b) => a.p - b.p),
    bids: juntar(libro.bids, false).sort((a, b) => b.p - a.p),
    paso,
  };
}

/** Escalón de un precio (para casar los golpes con su nivel). */
export const escalon = (p: number, paso: number, arriba: boolean) => Number(((arriba ? Math.ceil(p / paso - 1e-9) : Math.floor(p / paso + 1e-9)) * paso).toPrecision(15));
