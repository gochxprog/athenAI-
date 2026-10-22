import { useEffect, useRef, useState } from 'react';
import { Database, Layers3, Maximize2, Minimize2 } from 'lucide-react';
import LienzoOrderFlow, { type CapasGrafico, type MarcasGrafico } from './LienzoOrderFlow';
import DomEscalera from './DomEscalera';
import { motorOrderFlow, type EstadoFeeds } from '@/motores/worker/motorCliente';
import type { EntradaRegistro, Proveedor } from '@/motores/worker/protocolo';
import { useNavegar } from '@/hooks/Navegacion';
import type { EstadoGrafico } from '@/motores/nucleo/pipeline';
import type { IdTemporalidad } from '@/motores/nucleo/tipos';
import Punto from '@/components/ui/Punto';
import { useHistorial } from './historialGrafico';

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
  grabadora: 'Grabadora 24/7 (VPS)',
};

/**
 * Panel de gráficos de Order Flow: velas / Footprint por temporalidad, subpaneles CVD y OI,
 * overlays de absorción/agotamiento, LHM y eventos, más el DOM. Los datos vienen del Worker del motor,
 * que recibe aggTrades + vista del libro + OI) de la fuente elegida en el Centro de datos.
 */
export default function OrderFlowChart({ estado, marcas }: { estado: EstadoGrafico | null; marcas?: MarcasGrafico | null }) {
  const [temporalidad, setTemporalidad] = useState<IdTemporalidad>(estado?.temporalidad ?? '1m');
  const [capas, setCapas] = useState<CapasGrafico>({ footprint: false, heatmap: false, cvd: true, oi: true, absorcion: true, lhm: true, eventos: true });
  const { feeds } = useFeeds();
  const navegar = useNavegar();
  const visibleFeed = feeds.feeds.find((f) => f.simbolo === feeds.visible) ?? feeds.feeds[0];
  const historial = useHistorial(estado?.simbolo ?? visibleFeed?.simbolo, visibleFeed?.proveedor, temporalidad);
  const [completa, setCompleta] = useState(false);
  const marco = useRef<HTMLDivElement>(null);

  // Pantalla completa: la del navegador si existe (y en horizontal en el móvil); si no, el panel ocupa toda la ventana.
  const alternarCompleta = async () => {
    if (completa) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setCompleta(false);
      return;
    }
    setCompleta(true);
    try {
      await marco.current?.requestFullscreen?.();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape');
    } catch {
      // Sin API de pantalla completa (iPhone) u orientación bloqueada: basta con ocupar la ventana.
    }
  };
  useEffect(() => {
    const salir = () => {
      if (!document.fullscreenElement) setCompleta(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setCompleta(false);
    document.addEventListener('fullscreenchange', salir);
    window.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('fullscreenchange', salir);
      window.removeEventListener('keydown', tecla);
    };
  }, []);

  useEffect(() => {
    motorOrderFlow.vista(capas.footprint ? 140 : 260, capas.footprint, capas.footprint ? 70 : 0, capas.heatmap);
  }, [capas.footprint, capas.heatmap]);

  const cambiarTemporalidad = (id: IdTemporalidad) => {
    setTemporalidad(id);
    motorOrderFlow.temporalidad(id);
  };

  const conexion = estado?.conexion ?? 'conectando';

  return (
    <div ref={marco} className={`flex flex-col bg-black ${completa ? 'fixed inset-0 z-[70] h-[100dvh]' : 'h-full'}`} data-pantalla-completa={completa}>
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
          <button onClick={alternarCompleta} aria-label={completa ? 'Salir de pantalla completa' : 'Pantalla completa'} title={completa ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'} className="flex items-center gap-1.5 rounded-lg border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:border-plata-400 hover:text-white">
            {completa ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button onClick={() => navegar('datos')} className="flex items-center gap-1.5 rounded-lg border border-borde px-2.5 py-1 text-[10.5px] text-plata-200 hover:border-plata-400 hover:text-white" title="Cambiar fuente y activos en el Centro de datos">
            <Database size={11} /> {visibleFeed ? NOMBRE_PROVEEDOR[visibleFeed.proveedor] : 'Centro de datos'}
            {feeds.feeds.length === 1 && <span className="font-mono text-plata-400">· {feeds.feeds[0].simbolo}</span>}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className={`relative min-h-0 ${completa ? 'h-full' : 'h-[460px] lg:h-auto'}`}>
          <LienzoOrderFlow estado={estado} capas={capas} historial={historial.barras} alBordeIzquierdo={historial.pedirMas} marcas={marcas} />
          <span className="pointer-events-none absolute bottom-7 left-3 text-[9.5px] text-plata-600" data-historial={historial.barras.length}>
            {historial.cargando ? 'Cargando historial… · ' : historial.nota ? `${historial.nota} · ` : historial.barras.length ? `${historial.barras.length.toLocaleString('es-ES')} velas de historial · ` : ''}
            Arrastrar: mover · dos dedos o rueda: zoom · eje de precio: estirar · doble toque: volver al vivo
          </span>
        </div>
        <div className={`border-t border-borde-suave lg:min-h-0 lg:border-l lg:border-t-0 ${completa ? 'hidden lg:block' : 'h-[420px] lg:h-auto'}`}>
          <DomEscalera estado={estado} />
        </div>
      </div>
    </div>
  );
}
