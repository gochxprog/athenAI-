// Ticket a mano de la Terminal (Paper): lado, riesgo en % de la cuenta, stop (ATR o precio), objetivo (RR) y gestión.
// La vista previa dibuja la «regla de R»: dónde quedan el stop, la entrada y el objetivo, y cuánto vale 1R.
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useFeeds } from '@/components/orderflow/OrderFlowChart';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import { mercadoDe, CAPITAL_MANUAL, idManual } from '@/motores/paper/motorPaper';
import { mercadoIdSeguro } from '@/motores/mercado/mercadoId';
import { previaOrden, RIESGO_MAXIMO, type OrdenManual } from '@/motores/paper/manual';
import { NOMBRE_GESTION, type ModoGestion } from '@/motores/juez/salidas';
import { num } from '@/lib/format';
import { useMotorPaper } from './comun';

const RIESGOS = [0.0025, 0.005, 0.01, 0.02];
const ATRS = [1, 1.5, 2, 3];
const RRS: (number | null)[] = [1.5, 2, 3, 5, null];
const GESTIONES: ModoGestion[] = ['fija', 'be1R', 'escalonada'];
const CORTO: Record<ModoGestion, string> = { fija: 'Fija', be1R: 'BE a 1R', escalonada: 'Escalonada' };

function Chips<T>({ valores, valor, texto, alElegir, nombre }: { valores: T[]; valor: T; texto: (v: T) => string; alElegir: (v: T) => void; nombre: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={nombre}>
      {valores.map((v) => (
        <button key={texto(v)} role="radio" aria-checked={v === valor} onClick={() => alElegir(v)} className={`rounded-md border px-2 py-1 font-mono text-[10.5px] transition-colors ${v === valor ? 'border-white bg-white text-black' : 'border-borde text-plata-300 hover:border-plata-400 hover:text-white'}`}>
          {texto(v)}
        </button>
      ))}
    </div>
  );
}

export default function Ticket() {
  const motor = useMotorPaper();
  const { feeds } = useFeeds();
  const feed = feeds.feeds.find((f) => f.simbolo === feeds.visible) ?? feeds.feeds[0];
  const [lado, setLado] = useState<1 | -1>(1);
  const [riesgo, setRiesgo] = useState(0.005);
  const [modoTam, setModoTam] = useState<'riesgo' | 'lotaje'>('riesgo');
  const [lotaje, setLotaje] = useState('0.01');
  const [modoStop, setModoStop] = useState<'atr' | 'precio'>('atr');
  const [k, setK] = useState(1.5);
  const [stopPrecio, setStopPrecio] = useState('');
  const [rr, setRr] = useState<number | null>(2);
  const [gestion, setGestion] = useState<ModoGestion>('escalonada');
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const m = feed ? mercadoDe(feed, Date.now()) : null;
  const mercado = feed ? mercadoIdSeguro(feed.proveedor, feed.simbolo) : null;
  const cuenta = mercado ? motor.bots.find((b) => b.id === idManual(mercado)) : undefined;
  const capital = cuenta?.capital ?? CAPITAL_MANUAL;
  const cantidadLotaje = Number(lotaje.replace(',', '.'));
  const orden: OrdenManual = { lado, riesgoPct: riesgo, gestion, ...(modoTam === 'lotaje' ? { cantidad: cantidadLotaje > 0 ? cantidadLotaje : 0 } : {}), ...(modoStop === 'atr' ? { stopAtr: k } : { stopPrecio: Number(stopPrecio) || undefined }), ...(rr ? { rr } : {}) };
  const pre = previaOrden(capital, m, orden);
  const abierta = !!cuenta?.posicion;
  const base = feed?.simbolo.replace(/USDT$|USDC$/, '') ?? '';
  const lotes = base === 'BTC' ? [0.001, 0.005, 0.01, 0.05] : base === 'ETH' ? [0.01, 0.05, 0.1, 0.5] : [0.1, 0.5, 1, 5];
  const nocional = pre ? pre.cantidad * pre.entrada : 0;
  const riesgoCuenta = pre && capital > 0 ? pre.riesgoUsd / capital : 0;
  const excede = !!pre && (nocional > capital || riesgoCuenta > RIESGO_MAXIMO);

  const enviar = async () => {
    if (!feed) return;
    setEnviando(true);
    setEstado(null);
    try {
      await motor.ordenManual({ ...orden, proveedor: feed.proveedor, simbolo: feed.simbolo });
      setEstado({ ok: true, texto: `${lado > 0 ? 'Largo' : 'Corto'} abierto en ${feed.simbolo}.` });
    } catch (e) {
      setEstado({ ok: false, texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-4" data-ticket>
      <div className="flex items-center justify-between">
        <p className="etiqueta">Orden a mano · Paper</p>
        <p className="cifra text-[10.5px] text-plata-400">cuenta {num(capital, 2)} USD</p>
      </div>
      {feeds.feeds.length > 1 && <Chips nombre="Mercado" valores={feeds.feeds.map((f) => f.simbolo)} valor={feed?.simbolo ?? ''} texto={(s) => s} alElegir={(s) => motorOrderFlow.ver(s)} />}

      <div className="relative grid grid-cols-2 gap-1 rounded-xl border border-borde p-1" role="radiogroup" aria-label="Lado">
        {([1, -1] as const).map((l) => (
          <button key={l} role="radio" aria-checked={lado === l} onClick={() => setLado(l)} className={`relative rounded-lg py-2.5 text-xs font-medium transition-colors ${lado === l ? 'text-black' : 'text-plata-300 hover:text-white'}`} data-lado={l}>
            {lado === l && <motion.span layoutId="ticket-lado" className="absolute inset-0 rounded-lg bg-white" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative">
              {l === 1 ? '▲ Comprar' : '▼ Vender'} <span className="cifra font-light opacity-70">{l === 1 ? num(m?.ask ?? m?.precio ?? 0, 2) : num(m?.bid ?? m?.precio ?? 0, 2)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="etiqueta">Tamaño</p>
          <div className="flex rounded-md border border-borde p-0.5 text-[10px]" role="radiogroup" aria-label="Modo de tamaño">
            {(['riesgo', 'lotaje'] as const).map((x) => (
              <button key={x} role="radio" aria-checked={modoTam === x} onClick={() => setModoTam(x)} className={`rounded px-2 py-0.5 ${modoTam === x ? 'bg-white text-black' : 'text-plata-300 hover:text-white'}`} data-modo-tamano={x}>
                {x === 'riesgo' ? 'Por riesgo %' : 'Lotaje'}
              </button>
            ))}
          </div>
        </div>
        {modoTam === 'riesgo' ? (
          <Chips nombre="Riesgo" valores={RIESGOS} valor={riesgo} texto={(v) => `${num(v * 100, v < 0.01 ? 2 : 0)} %`} alElegir={setRiesgo} />
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input type="number" min={0} step="any" value={lotaje} onChange={(e) => setLotaje(e.target.value)} aria-label="Lotaje" className="w-full rounded-md border border-borde bg-black px-2.5 py-1.5 font-mono text-[11px] text-plata-100 outline-none focus:border-plata-400" data-lotaje />
              <span className="font-mono text-[11px] text-plata-400">{base}</span>
            </div>
            <Chips nombre="Lotes rápidos" valores={lotes} valor={cantidadLotaje} texto={(v) => String(v).replace('.', ',')} alElegir={(v) => setLotaje(String(v))} />
          </div>
        )}
        {pre && (
          <p className={`cifra text-[10px] ${excede ? 'text-white' : 'text-plata-500'}`} data-tamano-resumen>
            {num(pre.cantidad, 4)} {base} · {num(nocional, 0)} USD · arriesga {num(riesgoCuenta * 100, 2)} % de la cuenta
            {excede ? (nocional > capital ? ' · no cabe sin apalancamiento' : ` · supera el ${RIESGO_MAXIMO * 100} %`) : ''}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="etiqueta">Stop</p>
          <button onClick={() => setModoStop(modoStop === 'atr' ? 'precio' : 'atr')} className="text-[10px] text-plata-400 underline-offset-2 hover:text-white hover:underline">
            {modoStop === 'atr' ? 'poner precio' : 'usar ATR'}
          </button>
        </div>
        {modoStop === 'atr' ? (
          <Chips nombre="Stop en ATR" valores={ATRS} valor={k} texto={(v) => `${num(v, 1)}×ATR`} alElegir={setK} />
        ) : (
          <input type="number" value={stopPrecio} onChange={(e) => setStopPrecio(e.target.value)} placeholder="precio del stop" aria-label="Precio del stop" className="w-full rounded-md border border-borde bg-black px-2.5 py-1.5 font-mono text-[11px] text-plata-100 outline-none focus:border-plata-400" />
        )}
      </div>
      <div className="space-y-1.5">
        <p className="etiqueta">Objetivo</p>
        <Chips nombre="Objetivo" valores={RRS} valor={rr} texto={(v) => (v ? `1:${num(v, v % 1 ? 1 : 0)}` : 'libre')} alElegir={setRr} />
      </div>
      <div className="space-y-1.5">
        <p className="etiqueta">Gestión del stop</p>
        <Chips nombre="Gestión" valores={GESTIONES} valor={gestion} texto={(v) => CORTO[v]} alElegir={setGestion} />
        <p className="text-[10px] text-plata-500">{NOMBRE_GESTION[gestion]}</p>
      </div>

      <ReglaR pre={pre} lado={lado} />

      <button onClick={enviar} disabled={!pre || excede || enviando || abierta || motor.apagado} className="w-full rounded-xl bg-white py-2.5 text-xs font-medium text-black transition-opacity disabled:opacity-30" data-enviar-orden>
        {abierta ? 'Ya tienes una posición en este mercado' : enviando ? 'Enviando…' : `${lado > 0 ? 'Comprar' : 'Vender'} ${pre ? num(pre.cantidad, 4) : ''} ${feed?.simbolo.replace('USDT', '') ?? ''}`}
      </button>
      {estado && <p className={`text-[11px] ${estado.ok ? 'text-white' : 'text-plata-300'}`}>{estado.texto}</p>}
      <p className="text-[10px] leading-relaxed text-plata-500">Sin dinero real. Riesgo máximo {RIESGO_MAXIMO * 100} % por operación y sin apalancamiento. El stop se vigila cada segundo con el lado del libro por el que saldrías.</p>
    </div>
  );
}

/** La «regla de R»: objetivo, entrada y stop a escala, con sus distancias en R y en dólares. */
function ReglaR({ pre, lado }: { pre: ReturnType<typeof previaOrden>; lado: 1 | -1 }) {
  if (!pre) return <div className="rounded-xl border border-dashed border-borde px-3 py-6 text-center text-[11px] text-plata-500">Elige un stop válido (con ATR hace falta el mercado en vivo).</div>;
  const objetivoR = pre.rr ?? 3;
  const total = objetivoR + 1;
  // Posición vertical (0 arriba). Largo: objetivo arriba; corto: objetivo abajo.
  const y = (r: number) => (lado === 1 ? (objetivoR - r) / total : (r + 1) / total) * 100;
  const marcas = [
    { r: objetivoR, k: pre.rr ? 'Objetivo' : 'Sin objetivo', p: pre.objetivo, v: pre.objetivoUsd, fuerte: true },
    { r: 0, k: 'Entrada', p: pre.entrada, v: null, fuerte: true },
    { r: -1, k: 'Stop', p: pre.stop, v: -pre.riesgoUsd, fuerte: false },
  ];
  return (
    <div className="relative grid grid-cols-[34px_1fr] gap-3 rounded-xl border border-borde-suave bg-white/[0.015] p-3" data-regla-r>
      <div className="relative h-36">
        <div className="absolute inset-y-0 left-1/2 w-px bg-gradient-to-b from-white/50 via-white/15 to-white/40" />
        {Array.from({ length: Math.floor(objetivoR) + 2 }, (_, i) => i - 1).map((r) => (
          <div key={r} className="absolute left-1/2 h-px w-2 -translate-x-1/2 bg-white/25" style={{ top: `${y(r)}%` }} />
        ))}
        <motion.div className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-white/80" initial={false} animate={{ top: `${Math.min(y(0), y(objetivoR))}%`, height: `${Math.abs(y(objetivoR) - y(0))}%` }} transition={{ type: 'spring', stiffness: 200, damping: 26 }} />
        <motion.div className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-plata-600" initial={false} animate={{ top: `${Math.min(y(0), y(-1))}%`, height: `${Math.abs(y(-1) - y(0))}%` }} transition={{ type: 'spring', stiffness: 200, damping: 26 }} />
      </div>
      <div className="relative h-36">
        {marcas.map((x) => (
          <motion.div key={x.k} className="absolute inset-x-0 -translate-y-1/2" initial={false} animate={{ top: `${y(x.r)}%` }} transition={{ type: 'spring', stiffness: 200, damping: 26 }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-[10px] uppercase tracking-[0.14em] ${x.fuerte ? 'text-plata-200' : 'text-plata-500'}`}>
                {x.k} <span className="cifra normal-case tracking-normal text-plata-500">{x.r > 0 ? `+${num(x.r, 1)}R` : x.r < 0 ? '−1R' : ''}</span>
              </span>
              <span className="cifra text-[11px] text-white">{x.p !== null ? num(x.p, 2) : '—'}</span>
            </div>
            {x.v !== null && <p className={`cifra text-right text-[10px] ${x.v >= 0 ? 'text-plata-200' : 'text-plata-500'}`}>{x.v >= 0 ? '+' : '−'}{num(Math.abs(x.v), 2)} USD</p>}
          </motion.div>
        ))}
      </div>
      {pre.recortada && <p className="col-span-2 text-[10px] text-plata-400">El tamaño se recortó: sin apalancamiento no cabe más (riesgo real {num(pre.riesgoUsd, 2)} USD).</p>}
    </div>
  );
}
