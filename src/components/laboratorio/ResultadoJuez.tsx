import { Check, Minus, X } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import AbanicoTrayectorias from '@/components/charts/AbanicoTrayectorias';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import type { Metricas } from '@/motores/juez/backtest';
import { conSigno, num } from '@/lib/format';

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : conSigno(v * 100, d, '%'));
const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

/** Línea simple en SVG (monocroma). */
function Linea({ datos, alto = 160, base }: { datos: number[]; alto?: number; base?: number }) {
  if (datos.length < 2) return null;
  const W = 1000;
  const min = Math.min(...datos, base ?? Infinity);
  const max = Math.max(...datos, base ?? -Infinity);
  const y = (v: number) => alto - 6 - ((v - min) / (max - min || 1)) * (alto - 12);
  const paso = Math.max(1, Math.floor(datos.length / 800));
  const pts = datos.filter((_, i) => i % paso === 0 || i === datos.length - 1);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${alto}`} preserveAspectRatio="none" className="h-40 w-full">
      {base !== undefined && <line x1={0} x2={W} y1={y(base)} y2={y(base)} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke="#fff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Histograma con marcas verticales (percentiles o el valor real). */
function Histograma({ valores, marcas }: { valores: number[]; marcas: { v: number; etiqueta: string; fuerte?: boolean }[] }) {
  if (!valores.length) return null;
  const todos = [...valores, ...marcas.map((m) => m.v)];
  const min = Math.min(...todos);
  const max = Math.max(...todos);
  const n = 30;
  const cubos = new Array(n).fill(0);
  for (const v of valores) cubos[Math.min(n - 1, Math.floor(((v - min) / (max - min || 1)) * n))] += 1;
  const top = Math.max(...cubos);
  const x = (v: number) => ((v - min) / (max - min || 1)) * 100;
  return (
    <div className="relative h-36 pt-5">
      <div className="flex h-full items-end gap-px">
        {cubos.map((c, i) => (
          <div key={i} className="flex-1 rounded-t-[1px] bg-plata-500/70" style={{ height: `${(c / top) * 100}%` }} />
        ))}
      </div>
      {marcas.map((m) => (
        <div key={m.etiqueta} className="absolute bottom-0 top-0" style={{ left: `${x(m.v)}%` }}>
          <div className={`h-full w-px ${m.fuerte ? 'bg-white' : 'bg-plata-300/70'}`} />
          <span className={`absolute top-0 whitespace-nowrap font-mono text-[9.5px] ${x(m.v) > 75 ? 'right-1' : x(m.v) < 25 ? 'left-1' : '-translate-x-1/2'} ${m.fuerte ? 'text-white' : 'text-plata-400'}`}>{m.etiqueta}</span>
        </div>
      ))}
    </div>
  );
}

function Fila({ k, oos, ins }: { k: string; oos: string; ins: string }) {
  return (
    <tr className="border-t border-borde-suave">
      <td className="py-1.5 text-plata-300">{k}</td>
      <td className="cifra py-1.5 text-right text-white">{oos}</td>
      <td className="cifra py-1.5 text-right text-plata-500">{ins}</td>
    </tr>
  );
}

const filasMetricas = (o: Metricas, i: Metricas): [string, string, string][] => [
  ['Retorno total', pct(o.retornoTotal), pct(i.retornoTotal)],
  ['Sharpe anualizado', o.sharpe === null ? '—' : num(o.sharpe, 2), i.sharpe === null ? '—' : num(i.sharpe, 2)],
  ['Drawdown máximo', pct(-o.maxDrawdown), pct(-i.maxDrawdown)],
  ['% de aciertos', o.aciertos === null ? '—' : `${num(o.aciertos * 100, 1)} %`, i.aciertos === null ? '—' : `${num(i.aciertos * 100, 1)} %`],
  ['Factor de beneficio', o.factorBeneficio === null ? '—' : num(o.factorBeneficio, 2), i.factorBeneficio === null ? '—' : num(i.factorBeneficio, 2)],
  ['Operaciones', num(o.operaciones), num(i.operaciones)],
  ['Retorno medio por operación', pct(o.retornoMedioOperacion, 3), pct(i.retornoMedioOperacion, 3)],
  ['Tiempo en mercado', `${num(o.exposicion * 100, 0)} %`, `${num(i.exposicion * 100, 0)} %`],
];

export default function ResultadoJuezVista({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const aprobada = j.veredicto === 'APROBADA';
  return (
    <div className="space-y-4" data-resultado-juez={j.veredicto}>
      <div className={`rounded-xl border p-4 ${aprobada ? 'border-white bg-white text-black' : 'border-borde'}`}>
        <p className={`text-[10px] uppercase tracking-[0.16em] ${aprobada ? 'text-black/60' : 'text-plata-500'}`}>Veredicto del Juez</p>
        <p className={`mt-1 text-2xl font-light ${aprobada ? '' : 'text-white'}`}>{j.veredicto}</p>
        <p className={`mt-1 text-sm ${aprobada ? '' : 'text-plata-200'}`}>{j.resumen}</p>
        <p className={`mt-2 text-[10.5px] ${aprobada ? 'text-black/60' : 'text-plata-500'}`}>
          {num(r.filas)} dollar bars ({fecha(r.desde)} → {fecha(r.hasta)}) · fuera de muestra desde {fecha(r.inicioOosT)} · {r.combos.length} {r.combos.length === 1 ? 'variante' : 'variantes'} · {j.ensayos} probadas en total · {num(r.segundos, 1)} s
        </p>
      </div>

      <Panel titulo="Reglas del Juez" cuerpo="overflow-x-auto px-4 py-2">
        <table className="w-full min-w-[720px] text-left text-xs">
          <tbody>
            {j.reglas.map((g) => (
              <tr key={g.nombre} className="border-b border-borde-suave last:border-0" data-regla={g.ok === null ? 'na' : g.ok ? 'ok' : 'falla'}>
                <td className="w-6 py-2">{g.ok === null ? <Minus size={13} className="text-plata-600" /> : g.ok ? <Check size={13} className="text-white" /> : <X size={13} className="text-plata-400" />}</td>
                <td className="py-2 text-plata-100">{g.nombre}</td>
                <td className="cifra py-2 text-white">{g.valor}</td>
                <td className="py-2 text-plata-500">{g.umbral}</td>
                <td className="py-2 text-[10.5px] text-plata-500">{g.explicacion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel titulo="Capital fuera de muestra (Walk-Forward)" accion={<span className="text-[10px] text-plata-500">solo tramos que la estrategia no vio</span>}>
          <Linea datos={j.equityOos} base={1} />
          <table className="mt-3 w-full text-left text-[11px]">
            <thead>
              <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
                <th className="py-1 font-normal">Tramo</th>
                <th className="py-1 font-normal">Parámetros elegidos (con datos anteriores)</th>
                <th className="py-1 text-right font-normal">Retorno</th>
                <th className="py-1 text-right font-normal">Operaciones</th>
              </tr>
            </thead>
            <tbody>
              {j.tramos.map((t, i) => (
                <tr key={i} className="border-t border-borde-suave">
                  <td className="py-1 text-plata-300">{i + 1}</td>
                  <td className="py-1 font-mono text-[10.5px] text-plata-400">{JSON.stringify(r.combos[t.combo])}</td>
                  <td className="cifra py-1 text-right text-white">{pct(t.retorno)}</td>
                  <td className="cifra py-1 text-right text-plata-300">{t.operaciones}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel titulo="Métricas" cuerpo="px-4 py-2">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
                <th className="py-1 font-normal" />
                <th className="py-1 text-right font-normal">Fuera de muestra</th>
                <th className="py-1 text-right font-normal">Dentro (optimista)</th>
              </tr>
            </thead>
            <tbody>
              {filasMetricas(j.oos, j.dentroMuestra).map(([k, a, b]) => (
                <Fila key={k} k={k} oos={a} ins={b} />
              ))}
            </tbody>
          </table>
          <p className="py-2 text-[10.5px] text-plata-500">«Dentro» usa la mejor variante con toda la historia: siempre sale mejor de lo que es. Solo cuenta «fuera de muestra».</p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel titulo="Monte Carlo · 2.000 órdenes de las operaciones" accion={<span className="text-[10px] text-plata-500">retorno final</span>}>
          {j.monteCarlo ? (
            <>
              {j.monteCarlo.caminos?.length > 0 && (
                <div className="mb-3">
                  <AbanicoTrayectorias datos={{ caminos: j.monteCarlo.caminos, bandas: j.monteCarlo.bandas }} alto={200} />
                  <p className="mt-1 text-[10px] text-plata-500">Toca o pasa el ratón por una línea para ver sus métricas.</p>
                </div>
              )}
              <Histograma
                valores={j.monteCarlo.muestras}
                marcas={[
                  { v: j.monteCarlo.p5, etiqueta: `P5 ${pct(j.monteCarlo.p5)}` },
                  { v: j.monteCarlo.p50, etiqueta: `P50 ${pct(j.monteCarlo.p50)}`, fuerte: true },
                  { v: j.monteCarlo.p95, etiqueta: `P95 ${pct(j.monteCarlo.p95)}` },
                ]}
              />
              <p className="mt-2 text-[11px] text-plata-300">
                Peor caída esperable (P95): {pct(-j.monteCarlo.ddP95)} · probabilidad de una caída mayor del 25 %: {num(j.monteCarlo.probDd25 * 100, 1)} %
              </p>
            </>
          ) : (
            <p className="text-xs text-plata-500">Menos de 5 operaciones fuera de muestra.</p>
          )}
        </Panel>
        <Panel titulo="Luck test · 1.000 versiones al azar" accion={<span className="text-[10px] text-plata-500">misma exposición, desplazada en el tiempo</span>}>
          {j.suerte ? (
            <>
              <Histograma valores={j.suerte.simulaciones} marcas={[{ v: j.suerte.real, etiqueta: `Tu estrategia ${pct(j.suerte.real)}`, fuerte: true }]} />
              <p className="mt-2 text-[11px] text-plata-300">
                p = {num(j.suerte.p, 3)}: {j.suerte.p <= 0.05 ? 'el azar casi nunca lo iguala.' : `el azar la iguala o supera en ${num(j.suerte.p * 100, 0)} de cada 100 intentos.`}
              </p>
            </>
          ) : (
            <p className="text-xs text-plata-500">Menos de 5 operaciones fuera de muestra.</p>
          )}
        </Panel>
      </div>

      <Panel titulo="Robustez" cuerpo="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Costos ×2', pct(j.robustez.costosDobles)],
          ['Tramos positivos', `${num(j.robustez.tramosPositivos * 100, 0)} %`],
          ['Parámetros vecinos que ganan', j.robustez.vecinosPositivos === null ? '—' : `${num(j.robustez.vecinosPositivos * 100, 0)} %`],
          ['Deflated Sharpe', j.deflatedSharpe === null ? '—' : num(j.deflatedSharpe, 3)],
          ['PBO (sobreajuste)', j.pbo === null ? '—' : `${num(j.pbo * 100, 0)} %`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-borde-suave p-3">
            <p className="etiqueta">{k}</p>
            <p className="cifra mt-1 text-lg font-light text-white">{v}</p>
          </div>
        ))}
        {j.robustez.otroMercado && (
          <div className="rounded-lg border border-borde-suave p-3 sm:col-span-2 xl:col-span-5">
            <p className="etiqueta">Otro mercado · {j.robustez.otroMercado.simbolo}</p>
            <p className="mt-1 text-xs text-plata-200">
              Retorno {pct(j.robustez.otroMercado.retornoTotal)} · Sharpe {j.robustez.otroMercado.sharpe === null ? '—' : num(j.robustez.otroMercado.sharpe, 2)} · {j.robustez.otroMercado.operaciones} operaciones · drawdown {pct(-j.robustez.otroMercado.maxDrawdown)}
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
