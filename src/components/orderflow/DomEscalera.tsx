import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EstadoGrafico } from '@/motores/nucleo/pipeline';
import { decimalesDe, num } from '@/lib/format';
import { AGRUPACIONES, agruparLibro, escalon } from './agruparLibro';

/** Alto de cada fila (17 px + 1 px arriba y abajo): para centrar el spread al desplazarse. */
const ALTO_FILA = 19;
const fmtQ = (v: number) => (v === 0 ? '' : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

/**
 * DOM (Level 2): escalera de precios con TODOS los niveles de la vista del libro (hasta 200 por lado, ≈ 1,2 pb cada
 * uno; 1 USD en BTC), con desplazamiento y agrupación (×5, ×10…) para ver más lejos. Liquidez pasiva (bid/ask),
 * tendencia del nivel (▲ stacking / ▼ pulling), volumen agresor de los últimos 10 s y desequilibrio entre niveles
 * contiguos (≥ 3:1). Solo pantalla: el motor del libro y las Features usan su vista original.
 */
export default function DomEscalera({ estado }: { estado: EstadoGrafico | null }) {
  const [factor, setFactor] = useState<number>(1);
  const [seguir, setSeguir] = useState(true);
  const lista = useRef<HTMLDivElement>(null);
  const programado = useRef(false);

  const { filas, nAsks, paso } = useMemo(() => {
    const libro = estado?.libro;
    if (!libro) return { filas: [], nAsks: 0, paso: 1 };
    const g = agruparLibro(libro, factor);
    const compras = new Map<number, number>();
    const ventas = new Map<number, number>();
    for (const x of libro.golpes) {
      // Una compra agresiva golpea un ask (escalón hacia arriba); una venta, un bid (hacia abajo).
      if (x.compra) compras.set(escalon(x.p, g.paso, true), (compras.get(escalon(x.p, g.paso, true)) ?? 0) + x.compra);
      if (x.venta) ventas.set(escalon(x.p, g.paso, false), (ventas.get(escalon(x.p, g.paso, false)) ?? 0) + x.venta);
    }
    const asks = [...g.asks].reverse();
    const max = Math.max(1, ...g.asks.map((a) => a.tam), ...g.bids.map((b) => b.tam));
    const maxG = Math.max(0.001, ...compras.values(), ...ventas.values());
    const fila = (p: number, tam: number, tendencia: number, lado: 'ask' | 'bid', vecino: number | undefined) => {
      const compra = compras.get(p) ?? 0;
      const venta = ventas.get(p) ?? 0;
      const ratio = vecino && vecino > 0 ? tam / vecino : null;
      return { p, tam, tendencia, lado, compra, venta, pct: tam / max, pctCompra: compra / maxG, pctVenta: venta / maxG, imb: ratio !== null && ratio >= 3 };
    };
    return {
      filas: [...asks.map((a, i) => fila(a.p, a.tam, a.tendencia, 'ask', asks[i + 1]?.tam)), ...g.bids.map((b, i) => fila(b.p, b.tam, b.tendencia, 'bid', g.bids[i + 1]?.tam))],
      nAsks: asks.length,
      paso: g.paso,
    };
  }, [estado?.libro, factor]);

  // Mientras se «sigue» el precio, el spread queda en el centro; al desplazarse a mano se deja de seguir.
  useLayoutEffect(() => {
    const el = lista.current;
    if (!el || !seguir || !filas.length) return;
    const objetivo = Math.max(0, nAsks * ALTO_FILA - el.clientHeight / 2);
    if (Math.abs(el.scrollTop - objetivo) > 1) {
      programado.current = true;
      el.scrollTop = objetivo;
    }
  }, [filas, nAsks, seguir]);
  useEffect(() => setSeguir(true), [factor, estado?.simbolo]);

  const libro = estado?.libro;
  const m = estado?.metricas;
  const dp = decimalesDe(paso);
  const dt = decimalesDe(estado?.tickSize ?? 0.1);
  const base = (estado?.simbolo ?? 'BTCUSDT').replace(/(USDT|USDC|BUSD|USD)$/, '') || 'Vol';

  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-b border-borde-suave px-3 py-2.5 font-mono text-[10px]">
        <Dato k="Spread" v={libro?.spread != null ? num(libro.spread, dt) : '—'} />
        <Dato k="OBI 10" v={libro?.obi10 != null ? `${libro.obi10 > 0 ? '+' : ''}${num(libro.obi10, 2)}` : '—'} />
        <Dato k="MicroPrice" v={libro?.microPrice != null ? num(libro.microPrice, dt + 1) : '—'} />
        <Dato k="Imbalance" v={libro?.imbalance != null ? `${libro.imbalance > 0 ? '+' : ''}${num(libro.imbalance, 2)}` : '—'} />
        <Dato k="Trades/s" v={m ? num(m.tradesPorSeg, 0) : '—'} />
        <Dato k={`${base}/s`} v={m ? num(m.volumenPorSeg, 2) : '—'} />
        <Dato k="Compra/s" v={m ? num(m.compraPorSeg, 2) : '—'} />
        <Dato k="Venta/s" v={m ? num(m.ventaPorSeg, 2) : '—'} />
      </div>
      <div className="flex items-center gap-1 border-b border-borde-suave px-2 py-1.5 text-[9.5px] text-plata-400">
        <span className="mr-1 uppercase tracking-[0.12em]">Agrupar</span>
        {AGRUPACIONES.map((f) => (
          <button key={f} onClick={() => setFactor(f)} aria-pressed={factor === f} data-agrupar={f} className={`rounded px-1.5 py-0.5 font-mono ${factor === f ? 'bg-white text-black' : 'text-plata-300 hover:text-white'}`}>
            {libro ? num(libro.paso * f, decimalesDe(libro.paso * f)) : `×${f}`}
          </button>
        ))}
        <button onClick={() => setSeguir(true)} disabled={seguir} className="ml-auto rounded border border-borde px-1.5 py-0.5 text-plata-200 disabled:opacity-30" data-centrar-dom>
          Centrar
        </button>
      </div>
      <div className="grid grid-cols-[1fr_1fr_64px_1fr_1fr] border-b border-borde-suave px-1 py-1.5 text-center text-[9px] uppercase tracking-[0.12em] text-plata-500">
        <span>Venta 10s</span>
        <span>Bid</span>
        <span>Precio</span>
        <span>Ask</span>
        <span>Compra 10s</span>
      </div>
      <div
        ref={lista}
        className="min-h-0 flex-1 overflow-y-auto font-mono text-[10.5px]"
        data-dom-niveles={filas.length}
        onScroll={() => {
          if (programado.current) programado.current = false;
          else setSeguir(false);
        }}
      >
        {filas.length === 0 && <p className="p-4 text-center text-plata-500">Sin libro todavía</p>}
        {filas.map((f, i) => {
          const mejor = (f.lado === 'ask' && i === nAsks - 1) || (f.lado === 'bid' && i === nAsks);
          return (
            <div key={`${f.lado}${f.p}`} className={`grid grid-cols-[1fr_1fr_64px_1fr_1fr] items-center px-1 ${mejor ? 'bg-white/[0.05]' : ''} ${f.lado === 'bid' && i === nAsks ? 'border-t border-plata-500' : ''}`}>
              <Celda pct={f.pctVenta} valor={fmtQ(f.venta)} derecha />
              {f.lado === 'bid' ? <Celda pct={f.pct} valor={fmtQ(f.tam)} derecha fuerte={f.imb} tendencia={f.tendencia} /> : <span />}
              <span className={`py-[3px] text-center ${mejor ? 'text-white' : 'text-plata-300'}`}>{num(f.p, dp)}</span>
              {f.lado === 'ask' ? <Celda pct={f.pct} valor={fmtQ(f.tam)} fuerte={f.imb} tendencia={f.tendencia} /> : <span />}
              <Celda pct={f.pctCompra} valor={fmtQ(f.compra)} />
            </div>
          );
        })}
      </div>
      <p className="border-t border-borde-suave px-3 py-1.5 text-[9.5px] leading-snug text-plata-500">{Math.floor(filas.length / 2)} niveles por lado · ▲ stacking · ▼ pulling · borde = nivel ≥ 3× el siguiente</p>
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
