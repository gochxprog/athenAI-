import { Brain, GitCompareArrows, History, RefreshCw, TriangleAlert } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import type { EstadoFeed } from '@/motores/worker/protocolo';
import type { NombreRegimen } from '@/motores/memoria/regimen';
import { conSigno, hora, num } from '@/lib/format';
import { NOMBRE_REGIMEN } from './ResumenMercados';
import { useFeeds } from './OrderFlowChart';

// Monocromo: tendencia = blanco, rango = gris, día raro = contorno.
const ESTILO_REGIMEN: Record<NombreRegimen, string> = {
  tendencia: 'bg-white',
  rango: 'bg-plata-500',
  raro: 'border border-white bg-transparent',
};

const pctTxt = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : conSigno(v * 100, d, '%'));

/** Memoria del mercado del activo visible: régimen, "hoy es distinto" y día gemelo (Bloque B). */
export default function MemoriaMercado() {
  const { feeds } = useFeeds();
  const f: EstadoFeed | undefined = feeds.feeds.find((x) => x.simbolo === feeds.visible) ?? feeds.feeds[0];
  if (!f) return <p className="py-6 text-center text-xs text-plata-500">Sin fuente de datos.</p>;
  const m = f.memoria;
  const r = m?.regimen;
  const mem = m?.memoria;

  return (
    <div className="space-y-4" data-memoria={f.simbolo}>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-plata-400">
        <span>
          {f.simbolo} · {m ? `${num(m.filas)} filas analizadas · ${hora(new Date(m.calculadoEn))}` : 'calculando…'} · se recalcula cada 2 min
        </span>
        <button onClick={() => motorOrderFlow.recalcularMemoria()} className="flex items-center gap-1 rounded-md border border-borde px-2 py-0.5 text-plata-200 hover:border-plata-400 hover:text-white">
          <RefreshCw size={11} /> Recalcular ahora
        </button>
        {m?.faltan && <span className="text-plata-300">{m.faltan}. Deja grabando el mercado (la carpeta de la fuente guarda cada barra).</span>}
        {m?.error && <span className="text-plata-300">Error: {m.error}</span>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel titulo="Régimen del mercado · HMM de 3 estados" icono={Brain} accion={<span className="text-[10px] text-plata-500">aprendido solo de tu data · sin mirar al futuro</span>}>
          {!r && <p className="text-xs text-plata-400">Necesita al menos 600 dollar bars grabadas para aprender los regímenes.</p>}
          {r && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-2xl font-light text-white" data-regimen-actual={r.actual}>
                  {NOMBRE_REGIMEN[r.actual]}
                </span>
                <span className="font-mono text-[11px] text-plata-400">
                  {r.barrasEnRegimen} barras seguidas · {num(r.barras)} barras de historia
                </span>
              </div>
              <div className="space-y-1.5">
                {(['tendencia', 'rango', 'raro'] as NombreRegimen[]).map((k) => (
                  <div key={k} className="flex items-center gap-2 text-[11px]">
                    <span className="w-20 text-plata-300">{NOMBRE_REGIMEN[k]}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-plata-200" style={{ width: `${r.probabilidades[k] * 100}%` }} />
                    </div>
                    <span className="cifra w-12 text-right text-plata-100">{num(r.probabilidades[k] * 100, 0)} %</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="etiqueta mb-1.5">Últimas {r.historia.length} barras</p>
                <div className="flex h-5 gap-px">
                  {r.historia.map((h, i) => (
                    <span key={i} className={`flex-1 rounded-[1px] ${ESTILO_REGIMEN[h]}`} title={NOMBRE_REGIMEN[h]} />
                  ))}
                </div>
                <div className="mt-1.5 flex gap-3 text-[10px] text-plata-500">
                  {(['tendencia', 'rango', 'raro'] as NombreRegimen[]).map((k) => (
                    <span key={k} className="flex items-center gap-1">
                      <span className={`inline-block h-2 w-2 rounded-[1px] ${ESTILO_REGIMEN[k]}`} /> {NOMBRE_REGIMEN[k]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-borde-suave p-3">
                <p className="etiqueta">¿Sirve? Validación fuera de muestra</p>
                <p className={`mt-1 text-xs ${r.validacion.util ? 'text-white' : 'text-plata-300'}`}>{r.validacion.conclusion}</p>
                <table className="mt-2 w-full text-left text-[10.5px]">
                  <thead>
                    <tr className="text-[9px] uppercase tracking-[0.12em] text-plata-500">
                      <th className="py-1 font-normal">Régimen detectado</th>
                      <th className="py-1 text-right font-normal">% del tiempo</th>
                      <th className="py-1 text-right font-normal">Dirección siguiente</th>
                      <th className="py-1 text-right font-normal">Volatilidad siguiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['tendencia', 'rango', 'raro'] as NombreRegimen[]).map((k) => (
                      <tr key={k} className="border-t border-borde-suave">
                        <td className="py-1 text-plata-200">{NOMBRE_REGIMEN[k]}</td>
                        <td className="cifra py-1 text-right text-plata-300">{num(r.validacion.reparto[k] * 100, 0)} %</td>
                        <td className="cifra py-1 text-right text-plata-100">{r.validacion.eficienciaFutura[k] === null ? '—' : num(r.validacion.eficienciaFutura[k]!, 2)}</td>
                        <td className="cifra py-1 text-right text-plata-100">{r.validacion.volatilidadFutura[k] === null ? '—' : `${num(r.validacion.volatilidadFutura[k]!, 2)}× ATR`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[10px] text-plata-500">
                  Entrena con el 70 % más antiguo ({num(r.validacion.barrasEntreno)} barras) y prueba en el 30 % siguiente ({num(r.validacion.barrasPrueba)}). «Dirección siguiente»: eficiencia de las 10 barras posteriores (1 = va en línea recta, 0 = va y vuelve). Los regímenes duran ≈ {num(r.validacion.persistencia, 1)} barras.
                </p>
              </div>
            </div>
          )}
        </Panel>

        <Panel titulo="¿Hoy es distinto?" icono={TriangleAlert} accion={<span className="text-[10px] text-plata-500">ventana de 20 barras frente a todo lo grabado</span>}>
          {!mem && <p className="text-xs text-plata-400">Necesita al menos 320 dollar bars grabadas sin huecos.</p>}
          {mem && (
            <div className="space-y-3" data-distinto={mem.distinto.aviso ? 'si' : 'no'}>
              <div className={`rounded-lg border p-3 ${mem.distinto.aviso ? 'border-white bg-white text-black' : 'border-borde-suave'}`}>
                <p className={`text-[10px] uppercase tracking-[0.14em] ${mem.distinto.aviso ? 'text-black/60' : 'text-plata-500'}`}>{mem.distinto.aviso ? 'Aviso de riesgo' : 'Sin aviso'}</p>
                <p className={`mt-1 text-sm ${mem.distinto.aviso ? 'font-medium' : 'text-white'}`}>{mem.distinto.motivo}</p>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-plata-500">
                  <span>Parecido a lo grabado</span>
                  <span>Nunca visto</span>
                </div>
                <div className="relative h-2 rounded-full bg-white/[0.06]">
                  <div className="absolute inset-y-0 left-[98%] w-px bg-plata-400" title="Umbral de aviso (percentil 98)" />
                  <div className="absolute -top-1 h-4 w-1 rounded-sm bg-white" style={{ left: `calc(${mem.distinto.percentil * 100}% - 2px)` }} />
                </div>
                <p className="mt-1 text-right font-mono text-[10px] text-plata-400">percentil {num(mem.distinto.percentil * 100, 0)} · {num(mem.ventanas)} ventanas comparadas</p>
              </div>
              <p className="text-[10.5px] leading-relaxed text-plata-500">Los días que no se parecen a nada de lo grabado son los que queman cuentas. Con el aviso activo, el Guardián (Bloque E) reducirá o pausará a los bots.</p>
            </div>
          )}
        </Panel>
      </div>

      <CruceEntreMercados />

      <Panel titulo="Día gemelo · los momentos más parecidos a ahora y qué pasó después" icono={History} cuerpo="overflow-x-auto px-4 py-2">
        {!mem && <p className="py-4 text-center text-xs text-plata-500">Aún no hay suficiente historia grabada.</p>}
        {mem && !mem.gemelos.length && <p className="py-4 text-center text-xs text-plata-500">Aún no hay ventanas parecidas con 20 barras de futuro conocido.</p>}
        {mem && mem.gemelos.length > 0 && (
          <>
            {mem.resumen && (
              <p className="py-2 text-xs text-plata-200">
                En {mem.resumen.subieron} de {mem.gemelos.length} gemelos el precio subió en las 20 barras siguientes · retorno mediano {pctTxt(mem.resumen.retornoMediano)} · medio {pctTxt(mem.resumen.retornoMedio)}.{' '}
                <span className="text-plata-500">Es memoria, no predicción: el Juez decidirá si esto sirve para operar.</span>
              </p>
            )}
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
                  <th className="py-2 font-normal">Momento parecido</th>
                  <th className="py-2 text-right font-normal">Distancia</th>
                  <th className="py-2 text-right font-normal">Retorno 20 barras después</th>
                  <th className="py-2 text-right font-normal">Máx. subida</th>
                  <th className="py-2 text-right font-normal">Máx. bajada</th>
                </tr>
              </thead>
              <tbody>
                {mem.gemelos.map((g) => (
                  <tr key={g.cierre} className="border-t border-borde-suave" data-gemelo>
                    <td className="cifra py-1.5 text-plata-300">{new Date(g.cierre).toLocaleString('es-ES')}</td>
                    <td className="cifra py-1.5 text-right text-plata-400">{num(g.distancia, 2)}</td>
                    <td className="cifra py-1.5 text-right text-white">{pctTxt(g.retorno)}</td>
                    <td className="cifra py-1.5 text-right text-plata-200">{pctTxt(g.maxSubida)}</td>
                    <td className="cifra py-1.5 text-right text-plata-200">{pctTxt(g.maxBajada)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>
    </div>
  );
}

/** Correlación y régimen de cada par de mercados (por ejemplo BTC frente a XAU). */
function CruceEntreMercados() {
  const { feeds } = useFeeds();
  const regimen = (s: string) => feeds.feeds.find((f) => f.simbolo === s)?.memoria?.regimen?.actual ?? null;
  return (
    <Panel titulo="Cruce entre mercados" icono={GitCompareArrows} accion={<span className="text-[10px] text-plata-500">retornos de 5 min · últimas 24 h</span>} cuerpo="overflow-x-auto px-4 py-2">
      {feeds.feeds.length < 2 && <p className="py-3 text-xs text-plata-500">Asigna al menos dos mercados en el Centro de datos (por ejemplo BTCUSDT y XAUUSDT, o BTC de Binance y GC de Rithmic).</p>}
      {feeds.feeds.length >= 2 && !feeds.cruces.length && <p className="py-3 text-xs text-plata-500">Calculando con lo grabado…</p>}
      {feeds.cruces.length > 0 && (
        <table className="w-full min-w-[560px] text-left text-xs" data-cruces>
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
              <th className="py-2 font-normal">Par</th>
              <th className="py-2 text-right font-normal">Correlación</th>
              <th className="py-2 text-right font-normal">Puntos</th>
              <th className="py-2 font-normal pl-4">Régimen</th>
              <th className="py-2 font-normal">Coinciden</th>
            </tr>
          </thead>
          <tbody>
            {feeds.cruces.map((c) => {
              const ra = regimen(c.a);
              const rb = regimen(c.b);
              return (
                <tr key={`${c.a}-${c.b}`} className="border-t border-borde-suave">
                  <td className="py-1.5 font-mono text-white">
                    {c.a} · {c.b}
                  </td>
                  <td className="cifra py-1.5 text-right text-plata-100">{c.correlacion === null ? '—' : conSigno(c.correlacion, 2)}</td>
                  <td className="cifra py-1.5 text-right text-plata-500">{num(c.puntos)}</td>
                  <td className="py-1.5 pl-4 text-plata-300">
                    {ra ? NOMBRE_REGIMEN[ra] : '—'} / {rb ? NOMBRE_REGIMEN[rb] : '—'}
                  </td>
                  <td className="py-1.5 text-plata-200">{ra && rb ? (ra === rb ? 'sí' : 'no') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="py-2 text-[10.5px] text-plata-500">
        Un patrón que se repite en dos mercados poco correlacionados (como BTC y el oro) vale más que uno que solo sale en uno: el Juez (Bloque C) lo usará como prueba de robustez. Con correlación alta, los dos mercados cuentan casi como una sola apuesta.
      </p>
    </Panel>
  );
}
