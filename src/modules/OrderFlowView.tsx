import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, BookOpen, Brain, Cpu, Download, ListTree, Table2 } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import Insignia from '@/components/ui/Insignia';
import OrderFlowChart, { NOMBRE_PROVEEDOR, useEstadoMotor, useFeeds } from '@/components/orderflow/OrderFlowChart';
import ResumenMercados from '@/components/orderflow/ResumenMercados';
import MemoriaMercado from '@/components/orderflow/MemoriaMercado';
import MotoresOrderFlow from '@/components/orderflow/MotoresOrderFlow';
import { descargarCsv, motorOrderFlow } from '@/motores/worker/motorCliente';
import { grabadora } from '@/motores/grabadora/cliente';
import { DEFINICIONES_FEATURES } from '@/motores/nucleo/features';
import type { EstadoGrafico } from '@/motores/nucleo/pipeline';
import type { TipoEvento } from '@/motores/nucleo/tipos';
import { decimalesDe, hora, num } from '@/lib/format';

type Pestana = 'eventos' | 'motores' | 'memoria' | 'features' | 'salud';

const NOMBRE_EVENTO: Record<TipoEvento, string> = {
  absorcion: 'Absorción',
  agotamiento: 'Agotamiento',
  iceberg: 'Iceberg',
  stoprun: 'Stop run',
  bigtrade: 'Big trade',
  'pool-barrido': 'Pool barrido',
  liquidacion: 'Liquidación',
};

export default function OrderFlowView() {
  const { estado, msProceso } = useEstadoMotor();
  const [pestana, setPestana] = useState<Pestana>('eventos');
  const { feeds } = useFeeds();
  const visibleFeed = feeds.feeds.find((f) => f.simbolo === feeds.visible) ?? feeds.feeds[0];
  const grabadas = useFilasGrabadas(visibleFeed?.simbolo);

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Order Flow"
        titulo="Gráficos de Order Flow"
        fuente={visibleFeed ? `${NOMBRE_PROVEEDOR[visibleFeed.proveedor].toUpperCase()} · ${visibleFeed.simbolo}` : 'SIN FUENTE'}
        descripcion="Velas o Footprint, CVD, Open Interest, absorción, agotamiento, pools de liquidez (LHM), big trades, icebergs y stop runs, con el DOM al lado. Calculado por los motores de athenAI en un proceso aparte; lo mismo que ves es lo que aprenden los modelos."
      >
        <Insignia variante="contorno">{estado ? `${num(grabadas ?? 0)} filas grabadas · ${num(estado.metricas.barrasCanonicas)} en esta sesión` : 'Arrancando motor…'}</Insignia>
      </Encabezado>

      <ResumenMercados />

      <Panel cuerpo="p-0" className="overflow-hidden">
        <div className="h-auto lg:h-[680px]">
          <OrderFlowChart estado={estado} />
        </div>
      </Panel>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-borde p-1">
        {(
          [
            ['eventos', 'Eventos detectados', ListTree],
            ['motores', 'Cómo funciona cada motor', BookOpen],
            ['memoria', 'Memoria del mercado', Brain],
            ['features', 'Features para el ML', Table2],
            ['salud', 'Salud del motor', Cpu],
          ] as const
        ).map(([id, titulo, Icono]) => (
          <button key={id} onClick={() => setPestana(id)} className={`relative flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs ${pestana === id ? 'text-black' : 'text-plata-300 hover:text-white'}`}>
            {pestana === id && <motion.span layoutId="pestana-of" className="absolute inset-0 rounded-lg bg-white" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
            <Icono size={13} className="relative" />
            <span className="relative">{titulo}</span>
          </button>
        ))}
      </div>

      {pestana === 'eventos' && <Eventos estado={estado} />}
      {pestana === 'motores' && <MotoresOrderFlow feed={visibleFeed} estado={estado} />}
      {pestana === 'memoria' && <MemoriaMercado />}
      {pestana === 'features' && <Features estado={estado} />}
      {pestana === 'salud' && <Salud estado={estado} msProceso={msProceso} />}
    </div>
  );
}

function Eventos({ estado }: { estado: EstadoGrafico | null }) {
  const eventos = estado?.eventos ?? [];
  return (
    <Panel titulo="Eventos de los motores" icono={Activity} accion={<span className="text-[10px] text-plata-500">hora del evento · hora en que el motor pudo confirmarlo</span>} cuerpo="max-h-[420px] overflow-y-auto px-4 py-2">
      {eventos.length === 0 && <p className="py-6 text-center text-xs text-plata-500">Aún no hay eventos.</p>}
      <table className="w-full text-left text-xs">
        <tbody>
          {eventos.map((e) => (
            <tr key={e.id} className="border-b border-borde-suave last:border-0">
              <td className="cifra w-20 py-2 text-plata-500">{hora(new Date(e.t))}</td>
              <td className="cifra w-20 py-2 text-plata-600">{hora(new Date(e.disponibleEn))}</td>
              <td className="w-28 py-2 text-plata-200">{NOMBRE_EVENTO[e.tipo]}</td>
              <td className="w-16 py-2 font-mono text-[10.5px] text-plata-400">{e.lado === 'compra' ? '+ compra' : '− venta'}</td>
              <td className="py-2 text-plata-300">{e.detalle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

const COLUMNAS_VISTA = ['delta_z', 'trades_rel', 'cvd_sesion_ratio', 'imb_compra_frac', 'imb_venta_frac', 'absorcion_ask', 'absorcion_bid', 'agotamiento_prev_alcista', 'agotamiento_prev_bajista', 'bigtrades_compra_frac', 'bigtrades_venta_frac', 'icebergs_bid', 'stoprun_alto', 'oi_delta_pct', 'obi_10', 'pool_ask_dist_atr'];

function Features({ estado }: { estado: EstadoGrafico | null }) {
  const [exportando, setExportando] = useState(false);
  const filas = estado?.features.ultimas ?? [];
  const { feeds } = useFeeds();
  const usd = feeds.feeds.find((f) => f.simbolo === feeds.visible)?.dollarBarUsd ?? 10_000_000;
  const exportar = async () => {
    setExportando(true);
    try {
      const { csv, simbolo, proveedor } = await motorOrderFlow.exportarFeatures();
      descargarCsv(csv, `athenai-${proveedor ?? 'motor'}-${simbolo ?? 'activo'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
    } finally {
      setExportando(false);
    }
  };
  const nombre = (k: string) => DEFINICIONES_FEATURES.find((d) => d.clave === k)?.nombre ?? k;
  return (
    <div className="space-y-4">
      <Panel
        titulo={`Features de ${estado?.simbolo ?? '—'} por dollar bar (${usd >= 1e6 ? `${num(usd / 1e6)} M` : `${num(usd / 1e3)} mil`} USD) · ${num(estado?.features.total ?? 0)} filas`}
        icono={Table2}
        accion={
          <button onClick={exportar} disabled={exportando} className="flex items-center gap-1.5 rounded-md border border-borde px-2.5 py-1 text-[11px] text-plata-200 hover:border-plata-400 hover:text-white disabled:opacity-40">
            <Download size={12} /> {exportando ? 'Exportando…' : 'Exportar CSV'}
          </button>
        }
        cuerpo="overflow-x-auto px-4 py-2"
      >
        <p className="mb-2 text-[10.5px] text-plata-500">
          Cada fila se escribe al cierre de su barra con información disponible hasta ese instante. El agotamiento entra en la fila siguiente porque el motor necesita la vela posterior para confirmarlo.
        </p>
        <table className="w-full min-w-[1100px] text-right font-mono text-[10.5px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-[0.1em] text-plata-500">
              <th className="py-2 text-left font-normal">Cierre</th>
              <th className="py-2 font-normal">Close</th>
              {COLUMNAS_VISTA.map((k) => (
                <th key={k} className="px-1.5 py-2 font-normal" title={nombre(k)}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.n} className="border-t border-borde-suave text-plata-200">
                <td className="py-1.5 text-left text-plata-400">{hora(new Date(f.cierre))}</td>
                <td className="py-1.5">{num(f.close, decimalesDe(estado?.tickSize ?? 0.1))}</td>
                {COLUMNAS_VISTA.map((k) => {
                  const v = f.valores[k];
                  return (
                    <td key={k} className={`px-1.5 py-1.5 ${v ? 'text-white' : 'text-plata-600'}`}>
                      {v === null || v === undefined ? '—' : Math.abs(v) >= 1000 ? num(v, 0) : num(v, 2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel titulo={`Catálogo · ${DEFINICIONES_FEATURES.length} Features`} cuerpo="grid gap-x-6 gap-y-2 p-4 md:grid-cols-2 xl:grid-cols-3">
        {DEFINICIONES_FEATURES.map((d) => (
          <div key={d.clave} className="border-b border-borde-suave pb-2">
            <p className="text-xs text-white">
              {d.nombre} <span className="font-mono text-[10px] text-plata-500">{d.clave}</span>
            </p>
            <p className="text-[10.5px] text-plata-400">{d.descripcion}</p>
            <p className="text-[10px] text-plata-600">
              {d.grupo} · {d.motor}
            </p>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function Salud({ estado, msProceso }: { estado: EstadoGrafico | null; msProceso: number }) {
  const m = estado?.memoria ?? {};
  const limites: Record<string, [string, number | null]> = {
    cinta: ['Trades en cinta (reconstrucción de barras)', 500_000],
    columnasLhm: ['Columnas del libro para LHM', 1_800],
    pools: ['Pools de liquidez vivos', 24],
    rachasPools: ['Rachas de persistencia de pools', null],
    eventos: ['Eventos en memoria', 600],
    cintaIceberg: ['Trades recientes para icebergs', 40_000],
    barrasStopRun: ['Barras de 5 s para stop runs (1 h + la barra en curso)', 721],
    barrasVista: ['Barras del gráfico', 600],
    barrasCanonicas: ['Dollar bars canónicas', 600],
    filasFeatures: ['Filas de Features en memoria', 20_000],
  };
  return (
    <Panel titulo="Salud del motor · todo acotado" icono={Cpu} accion={<span className="cifra text-[10px] text-plata-500">{num(msProceso, 1)} ms de cálculo cada 200 ms</span>}>
      <p className="mb-3 text-[11px] text-plata-400">
        El motor corre en un Web Worker y cada estructura tiene un límite fijo: la memoria no crece con las horas. Así el uso de memoria se mantiene plano aunque quede horas abierto.
      </p>
      <div className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
        {Object.entries(limites).map(([k, [nombre, limite]]) => {
          const v = m[k] ?? 0;
          return (
            <div key={k}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-plata-300">{nombre}</span>
                <span className="cifra text-white">
                  {num(v)}
                  {limite !== null && <span className="text-plata-500"> / {num(limite)}</span>}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-plata-300" style={{ width: `${limite ? Math.min(100, (v / limite) * 100) : 4}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Filas de Features grabadas de un mercado: la carpeta con más historia (la del VPS o la de este navegador). */
function useFilasGrabadas(simbolo: string | undefined): number | null {
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
