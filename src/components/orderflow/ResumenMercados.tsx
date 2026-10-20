import Sparkline from '@/components/charts/Sparkline';
import Punto from '@/components/ui/Punto';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import type { EstadoFeed } from '@/motores/worker/protocolo';
import { conSigno, decimalesDe, num } from '@/lib/format';
import { NOMBRE_PROVEEDOR, useFeeds } from './OrderFlowChart';
import { faltaPara, useCalendario } from '@/hooks/useCalendario';

const ESTADO: Record<string, string> = {
  conectando: 'Conectando',
  'en-vivo': 'En vivo',
  reconectando: 'Reconectando',
  'sin-datos': 'Sin datos',
  error: 'Error',
  detenido: 'Detenido',
};

export const NOMBRE_REGIMEN: Record<'rango' | 'tendencia' | 'raro', string> = { rango: 'Rango', tendencia: 'Tendencia', raro: 'Día raro' };

/** Texto corto de lo que falta para la memoria ("312/600 barras"). */
const progreso = (f: EstadoFeed) => {
  const m = f.memoria;
  if (!m) return 'Calculando…';
  if (m.error) return 'Error al calcular';
  const x = m.faltan?.match(/régimen: (\d+\/\d+)/);
  return x ? `Faltan datos · ${x[1]} barras` : 'Calculando…';
};

const usdK = (v: number) => (v >= 1e6 ? `${num(v / 1e6, 1)} M` : v >= 1e3 ? `${num(v / 1e3, 0)} k` : num(v, 0));

/**
 * Panel Multi-Asset: una tarjeta por mercado con lo esencial de los motores de Order Flow.
 * Al pulsar una tarjeta el gráfico central pasa a ese mercado; los demás siguen calculándose en segundo plano.
 */
export default function ResumenMercados({ alElegir }: { alElegir?: (simbolo: string) => void }) {
  const { feeds } = useFeeds();
  const { proximo, enCurso, ahora } = useCalendario();
  if (!feeds.feeds.length) return null;
  const evento = enCurso ?? proximo;
  return (
    <div className="space-y-2">
      {evento && (
        <p className={`text-[10.5px] ${enCurso ? 'text-white' : 'text-plata-500'}`} data-proximo-evento>
          {enCurso ? `Ventana de no operar: ${enCurso.nombre}` : `Próximo evento fuerte: ${evento.nombre} · ${faltaPara(evento.t, ahora)}`}
        </p>
      )}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-resumen-mercados>
      {feeds.feeds.map((f) => (
        <Tarjeta
          key={f.simbolo}
          f={f}
          activa={feeds.visible === f.simbolo}
          onClick={() => {
            motorOrderFlow.ver(f.simbolo);
            alElegir?.(f.simbolo);
          }}
        />
      ))}
    </div>
    </div>
  );
}

function Tarjeta({ f, activa, onClick }: { f: EstadoFeed; activa: boolean; onClick: () => void }) {
  const r = f.resumen;
  const dp = decimalesDe(f.tickSize);
  const base = f.simbolo.replace(/(USDT|USDC|BUSD|USD)$/, '') || f.simbolo;
  const cambio = r.precio !== null && r.aperturaSesion ? (r.precio / r.aperturaSesion - 1) * 100 : null;
  const dist = (p: number | null) => (p !== null && r.precio ? `${conSigno((p / r.precio - 1) * 100, 2, '%')}` : '—');
  const filas: [string, string][] = [
    ['CVD sesión', `${conSigno(r.cvdSesion, 2)} ${base}`],
    ['CVD velocidad', f.cvdVelocidad === null ? '—' : `${conSigno(f.cvdVelocidad, 2)} /min`],
    ['ΔOI 15 min', r.oiDeltaPct === null ? '—' : conSigno(r.oiDeltaPct, 2, '%')],
    ['Delta ratio', r.deltaRatio === null ? '—' : conSigno(r.deltaRatio, 2)],
    ['Absorción', r.absorcion ? `${r.absorcion.lado === 'bid' ? 'bid' : 'ask'} ${num(r.absorcion.score, 0)}` : '—'],
    ['Spike absorción', r.absorcionSpike === null ? '—' : `${num(r.absorcionSpike, 1)}×`],
    ['Agotamiento', r.agotamiento ? `${r.agotamiento.lado === 'bullish' ? 'alcista' : 'bajista'} ${num(r.agotamiento.score, 0)}` : '—'],
    ['Imbalances C / V', `${r.imbCompra} / ${r.imbVenta}${r.stackedCompra + r.stackedVenta ? ` · stk ${r.stackedCompra}/${r.stackedVenta}` : ''}`],
    ['Big trades 5 min', `${usdK(r.bigCompraUsd)} / ${usdK(r.bigVentaUsd)}`],
    ['Liquidaciones 5 min', `L ${usdK(r.liqLargosUsd)} · S ${usdK(r.liqCortosUsd)}`],
    ['Pool arriba', r.poolArriba ? `${num(r.poolArriba.p, dp)} (${dist(r.poolArriba.p)})` : '—'],
    ['Pool abajo', r.poolAbajo ? `${num(r.poolAbajo.p, dp)} (${dist(r.poolAbajo.p)})` : '—'],
  ];
  return (
    <button
      onClick={onClick}
      data-tarjeta={f.simbolo}
      className={`panel flex flex-col p-3 text-left transition-colors ${activa ? 'border-white' : 'hover:border-plata-400'}`}
      aria-pressed={activa}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-white">{f.simbolo}</span>
        <span className="text-[9.5px] text-plata-500">{NOMBRE_PROVEEDOR[f.proveedor]}</span>
        {f.memoria?.memoria?.distinto.aviso && (
          <span className="rounded border border-white bg-white px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-black" title={f.memoria.memoria.distinto.motivo}>
            Hoy es distinto
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.12em] text-plata-300" title={f.detalle}>
          <Punto estado={f.conexion === 'en-vivo' ? 'activo' : f.conexion === 'error' || f.conexion === 'detenido' ? 'detenido' : 'espera'} />
          {ESTADO[f.conexion] ?? f.conexion}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="cifra text-xl font-light text-white">{r.precio === null ? '—' : num(r.precio, dp)}</span>
        {cambio !== null && <span className="font-mono text-[10px] text-plata-400">{conSigno(cambio, 2, '%')} hoy</span>}
        <span className="ml-auto font-mono text-[9.5px] text-plata-500">{num(f.filas)} filas</span>
      </div>
      <Sparkline datos={f.historial.length > 1 ? f.historial : [0, 0]} alto={28} className="mt-1" base={r.vwap ?? undefined} />
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {filas.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 border-b border-borde-suave pb-0.5">
            <dt className="truncate text-[9.5px] text-plata-500">{k}</dt>
            <dd className="cifra truncate text-[10.5px] text-plata-100">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[9.5px]">
        <div className="rounded border border-borde-suave px-2 py-1">
          <span className="block uppercase tracking-[0.12em] text-plata-600">Régimen</span>
          {f.memoria?.regimen ? (
            <span className="text-white" data-regimen={f.memoria.regimen.actual}>
              {NOMBRE_REGIMEN[f.memoria.regimen.actual]} · {num(f.memoria.regimen.probabilidades[f.memoria.regimen.actual] * 100, 0)} %
              <span className="text-plata-500"> · {f.memoria.regimen.barrasEnRegimen} b</span>
            </span>
          ) : (
            <span className="text-plata-400">{progreso(f)}</span>
          )}
        </div>
        <div className="rounded border border-borde-suave px-2 py-1">
          <span className="block uppercase tracking-[0.12em] text-plata-600">Veredicto del Juez</span>
          <span className="text-plata-400">Sin modelo validado</span>
        </div>
      </div>
    </button>
  );
}
