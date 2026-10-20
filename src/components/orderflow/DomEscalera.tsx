import { useMemo } from 'react';
import type { EstadoGrafico } from '@/motores/nucleo/pipeline';
import { num } from '@/lib/format';

const FILAS_POR_LADO = 13;
const fmtQ = (v: number) => (v === 0 ? '' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

/**
 * DOM (Level 2): escalera de precios agrupada a 1 USD con liquidez pasiva (bid/ask), tendencia del nivel
 * (▲ stacking / ▼ pulling, del OrderBookEngine de Urus), volumen agresor ejecutado en los últimos 10 s
 * y desequilibrio entre niveles contiguos (≥ 3:1).
 */
export default function DomEscalera({ estado }: { estado: EstadoGrafico | null }) {
  const filas = useMemo(() => {
    const libro = estado?.libro;
    if (!libro) return [];
    const golpes = new Map(libro.golpes.map((g) => [Math.round(g.p), g]));
    const asks = libro.asks.slice(0, FILAS_POR_LADO).reverse();
    const bids = libro.bids.slice(0, FILAS_POR_LADO);
    const max = Math.max(1, ...asks.map((a) => a[1]), ...bids.map((b) => b[1]));
    const maxG = Math.max(0.001, ...libro.golpes.map((g) => Math.max(g.compra, g.venta)));
    const fila = (p: number, tam: number, tendencia: number, lado: 'ask' | 'bid', vecino: number | undefined) => {
      const g = golpes.get(Math.round(p));
      const ratio = vecino && vecino > 0 ? tam / vecino : null;
      return { p, tam, tendencia, lado, compra: g?.compra ?? 0, venta: g?.venta ?? 0, pct: tam / max, pctCompra: (g?.compra ?? 0) / maxG, pctVenta: (g?.venta ?? 0) / maxG, imb: ratio !== null && ratio >= 3 };
    };
    return [
      ...asks.map((a, i) => fila(a[0], a[1], a[2], 'ask', asks[i + 1]?.[1])),
      ...bids.map((b, i) => fila(b[0], b[1], b[2], 'bid', bids[i + 1]?.[1])),
    ];
  }, [estado?.libro]);

  const libro = estado?.libro;
  const m = estado?.metricas;

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-b border-borde-suave px-3 py-2.5 font-mono text-[10px]">
        <Dato k="Spread" v={libro?.spread != null ? num(libro.spread, 1) : '—'} />
        <Dato k="OBI 10" v={libro?.obi10 != null ? `${libro.obi10 > 0 ? '+' : ''}${num(libro.obi10, 2)}` : '—'} />
        <Dato k="MicroPrice" v={libro?.microPrice != null ? num(libro.microPrice, 1) : '—'} />
        <Dato k="Imbalance" v={libro?.imbalance != null ? `${libro.imbalance > 0 ? '+' : ''}${num(libro.imbalance, 2)}` : '—'} />
        <Dato k="Trades/s" v={m ? num(m.tradesPorSeg, 0) : '—'} />
        <Dato k="BTC/s" v={m ? num(m.volumenPorSeg, 2) : '—'} />
        <Dato k="Compra/s" v={m ? num(m.compraPorSeg, 2) : '—'} />
        <Dato k="Venta/s" v={m ? num(m.ventaPorSeg, 2) : '—'} />
      </div>
      <div className="grid grid-cols-[1fr_1fr_64px_1fr_1fr] border-b border-borde-suave px-1 py-1.5 text-center text-[9px] uppercase tracking-[0.12em] text-plata-500">
        <span>Venta 10s</span>
        <span>Bid</span>
        <span>Precio</span>
        <span>Ask</span>
        <span>Compra 10s</span>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[10.5px]">
        {filas.length === 0 && <p className="p-4 text-center text-plata-500">Sin libro todavía</p>}
        {filas.map((f, i) => {
          const mejor = (f.lado === 'ask' && i === FILAS_POR_LADO - 1) || (f.lado === 'bid' && i === FILAS_POR_LADO);
          return (
            <div key={`${f.lado}${f.p}`} className={`grid grid-cols-[1fr_1fr_64px_1fr_1fr] items-center px-1 ${mejor ? 'bg-white/[0.05]' : ''} ${f.lado === 'bid' && i === FILAS_POR_LADO ? 'border-t border-plata-500' : ''}`}>
              <Celda pct={f.pctVenta} valor={fmtQ(f.venta)} derecha />
              {f.lado === 'bid' ? <Celda pct={f.pct} valor={fmtQ(f.tam)} derecha fuerte={f.imb} tendencia={f.tendencia} /> : <span />}
              <span className={`py-[3px] text-center ${mejor ? 'text-white' : 'text-plata-300'}`}>{num(f.p, 0)}</span>
              {f.lado === 'ask' ? <Celda pct={f.pct} valor={fmtQ(f.tam)} fuerte={f.imb} tendencia={f.tendencia} /> : <span />}
              <Celda pct={f.pctCompra} valor={fmtQ(f.compra)} />
            </div>
          );
        })}
      </div>
      <p className="border-t border-borde-suave px-3 py-1.5 text-[9.5px] leading-snug text-plata-500">▲ stacking · ▼ pulling · borde = nivel ≥ 3× el siguiente</p>
    </div>
  );
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-plata-500">{k}</span>
      <span className="text-plata-100">{v}</span>
    </div>
  );
}

function Celda({ pct, valor, derecha = false, fuerte = false, tendencia = 0 }: { pct: number; valor: string; derecha?: boolean; fuerte?: boolean; tendencia?: number }) {
  return (
    <span className={`relative my-[1px] block h-[17px] ${fuerte ? 'outline outline-1 -outline-offset-1 outline-white/80' : ''}`}>
      <span className={`absolute inset-y-0 ${derecha ? 'right-0' : 'left-0'} bg-white/[0.16]`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      <span className={`relative flex h-full items-center gap-1 px-1 ${derecha ? 'justify-end' : 'justify-start'} ${fuerte ? 'text-white' : 'text-plata-200'}`}>
        {tendencia === 1 && <span className="text-[8px] text-white">▲</span>}
        {tendencia === -1 && <span className="text-[8px] text-plata-500">▼</span>}
        {valor}
      </span>
    </span>
  );
}
