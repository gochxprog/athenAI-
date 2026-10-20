import { useEffect, useState } from 'react';
import { Database, Layers3 } from 'lucide-react';
import LienzoOrderFlow, { type CapasGrafico } from './LienzoOrderFlow';
import DomEscalera from './DomEscalera';
import { motorOrderFlow, type EstadoFeeds } from '@/motores/worker/motorCliente';
import type { EntradaRegistro, Proveedor } from '@/motores/worker/protocolo';
import { useNavegar } from '@/hooks/Navegacion';
import type { EstadoGrafico } from '@/motores/nucleo/pipeline';
import type { IdTemporalidad } from '@/motores/nucleo/tipos';
import Punto from '@/components/ui/Punto';

const TEMPORALIDADES: { id: IdTemporalidad; etiqueta: string }[] = [
  { id: '1m', etiqueta: '1m' },
  { id: '5m', etiqueta: '5m' },
  { id: '15m', etiqueta: '15m' },
  { id: 'dollar', etiqueta: 'Dollar Bars' },
  { id: 'volume', etiqueta: 'Volume Bars' },
];

const CAPAS: { clave: keyof CapasGrafico; etiqueta: string }[] = [
  { clave: 'cvd', etiqueta: 'CVD' },
  { clave: 'oi', etiqueta: 'OI' },
  { clave: 'absorcion', etiqueta: 'Absorción / Agotamiento' },
  { clave: 'heatmap', etiqueta: 'Heatmap' },
  { clave: 'lhm', etiqueta: 'LHM' },
  { clave: 'eventos', etiqueta: 'Big trades · Icebergs · Stop runs' },
];

const ESTADO_CONEXION: Record<string, string> = {
  conectando: 'Conectando',
  'en-vivo': 'En vivo',
  reconectando: 'Reconectando',
  'sin-datos': 'Sin datos',
  error: 'Error',
  detenido: 'Detenido',
};

/** Hook: estado del motor (Worker único de la app). */
export function useEstadoMotor() {
  const [estado, setEstado] = useState<EstadoGrafico | null>(null);
  const [msProceso, setMs] = useState(0);
  useEffect(
    () =>
      motorOrderFlow.suscribir((e, ms) => {
        setEstado(e);
        setMs(ms);
      }),
    [],
  );
  return { estado, msProceso };
}

/** Hook: feeds de la fuente activa y registro de cambios del Centro de datos. */
export function useFeeds() {
  const [x, setX] = useState<{ feeds: EstadoFeeds; registro: readonly EntradaRegistro[] }>({ feeds: motorOrderFlow.feeds, registro: motorOrderFlow.registro });
  useEffect(() => motorOrderFlow.suscribirFeeds((feeds, registro) => setX({ feeds, registro })), []);
  return x;
}

export const NOMBRE_PROVEEDOR: Record<Proveedor, string> = {
  binance: 'Binance Futures',
  rithmic: 'Rithmic',
  urus: 'Servidor Urus',
  simulacion: 'Simulación',
};

/**
 * Panel de gráficos de Order Flow: velas / Footprint por temporalidad, subpaneles CVD y OI,
 * overlays de absorción/agotamiento, LHM y eventos, más el DOM. Los datos vienen del Worker del motor,
 * que recibe la estructura de Urus (aggTrades + vista del libro + OI) de la fuente elegida en el Centro de datos.
 */
export default function OrderFlowChart({ estado }: { estado: EstadoGrafico | null }) {
  const [temporalidad, setTemporalidad] = useState<IdTemporalidad>(estado?.temporalidad ?? '1m');
  const [capas, setCapas] = useState<CapasGrafico>({ footprint: false, heatmap: false, cvd: true, oi: true, absorcion: true, lhm: true, eventos: true });
  const { feeds } = useFeeds();
  const navegar = useNavegar();
  const visibleFeed = feeds.feeds.find((f) => f.simbolo === feeds.visible) ?? feeds.feeds[0];

  useEffect(() => {
    motorOrderFlow.vista(capas.footprint ? 140 : 260, capas.footprint, capas.footprint ? 70 : 0, capas.heatmap);
  }, [capas.footprint, capas.heatmap]);

  const cambiarTemporalidad = (id: IdTemporalidad) => {
    setTemporalidad(id);
    motorOrderFlow.temporalidad(id);
  };

  const conexion = estado?.conexion ?? 'conectando';

  return (
    <div className="flex h-full flex-col">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2 border-b border-borde-suave px-3 py-2.5">
        <div className="flex rounded-lg border border-borde p-0.5" role="group" aria-label="Temporalidad">
          {TEMPORALIDADES.map((t) => (
            <button key={t.id} onClick={() => cambiarTemporalidad(t.id)} className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${temporalidad === t.id ? 'bg-white text-black' : 'text-plata-300 hover:text-white'}`}>
              {t.etiqueta}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCapas((c) => ({ ...c, footprint: !c.footprint }))}
          aria-pressed={capas.footprint}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${capas.footprint ? 'border-white bg-white text-black' : 'border-borde text-plata-200 hover:border-plata-400'}`}
        >
          <Layers3 size={12} /> Footprint View
        </button>
        <span className="mx-1 hidden h-5 w-px bg-borde md:block" />
        {CAPAS.map((c) => (
          <button
            key={c.clave}
            onClick={() => setCapas((x) => ({ ...x, [c.clave]: !x[c.clave] }))}
            aria-pressed={capas[c.clave]}
            className={`rounded-md border px-2 py-1 text-[10.5px] transition-colors ${capas[c.clave] ? 'border-plata-300 text-white' : 'border-borde text-plata-500 line-through decoration-plata-600 hover:text-plata-300'}`}
          >
            {c.etiqueta}
          </button>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-etiqueta text-plata-300" title={estado?.detalleConexion}>
            <Punto estado={conexion === 'en-vivo' ? 'activo' : conexion === 'detenido' || conexion === 'error' ? 'detenido' : 'espera'} />
            {ESTADO_CONEXION[conexion] ?? conexion}
          </span>
          {feeds.feeds.length > 1 && (
            <div className="flex rounded-lg border border-borde p-0.5" role="group" aria-label="Activo">
              {feeds.feeds.map((f) => (
                <button key={f.simbolo} onClick={() => motorOrderFlow.ver(f.simbolo)} className={`rounded-md px-2 py-1 font-mono text-[10.5px] ${feeds.visible === f.simbolo ? 'bg-white text-black' : 'text-plata-300 hover:text-white'}`}>
                  {f.simbolo}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => navegar('datos')} className="flex items-center gap-1.5 rounded-lg border border-borde px-2.5 py-1 text-[10.5px] text-plata-200 hover:border-plata-400 hover:text-white" title="Cambiar fuente y activos en el Centro de datos">
            <Database size={11} /> {visibleFeed ? NOMBRE_PROVEEDOR[visibleFeed.proveedor] : 'Centro de datos'}
            {feeds.feeds.length === 1 && <span className="font-mono text-plata-400">· {feeds.feeds[0].simbolo}</span>}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative h-[460px] min-h-0 lg:h-auto">
          <LienzoOrderFlow estado={estado} capas={capas} />
          <span className="pointer-events-none absolute bottom-7 left-3 text-[9.5px] text-plata-600">Rueda: zoom · arrastrar: desplazar · doble clic: volver al vivo</span>
        </div>
        <div className="min-h-[420px] border-t border-borde-suave lg:min-h-0 lg:border-l lg:border-t-0">
          <DomEscalera estado={estado} />
        </div>
      </div>
    </div>
  );
}
