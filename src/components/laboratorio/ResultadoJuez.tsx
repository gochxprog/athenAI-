import { Check, Download, Minus, X } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import AbanicoTrayectorias from '@/components/charts/AbanicoTrayectorias';
import type { OperacionConHora, RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import type { Metricas } from '@/motores/juez/backtest';
import { NOMBRE_OBJETIVO } from '@/motores/juez/walkForward';
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

function descargarOperaciones(ops: OperacionConHora[]): void {
  const filas = ops.map((o) => [new Date(o.entradaT).toISOString(), new Date(o.salidaT).toISOString(), o.lado > 0 ? 'largo' : 'corto', o.barras, o.retorno].join(','));
  const url = URL.createObjectURL(new Blob([['entrada,salida,lado,barras,retorno', ...filas].join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'operaciones-fuera-de-muestra.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Motor 1 · Backtest: curva, drawdown, operaciones y cómo se calcula. */
function SeccionBacktest({ r }: { r: RespuestaLaboratorio }) {
  const eq = r.resultado.equityOos;
  let pico = -Infinity;
  const dd = eq.map((e) => {
    pico = Math.max(pico, e);
    return e / pico - 1;
  });
  const ops = r.operaciones ?? [];
  const c = r.costos;
  const porOps = ops.reduce((a, o) => a * (1 + o.retorno), 1) - 1;
  return (
    <Panel titulo="Motor 1 · Backtest" accion={<span className="text-[10px] text-plata-500">fuera de muestra · {num(ops.length)} operaciones</span>} cuerpo="space-y-4 p-4" >
      <Explicacion
        que="repetir tu estrategia sobre el pasado, barra por barra, como si hubieras operado de verdad, pagando comisiones y funding."
        sirve="saber cuánto habría ganado o perdido y ver cada operación que habría hecho."
        mirar="que la curva suba de forma pareja (no por una sola operación) y que el drawdown (la caída) sea algo que aguantarías."
      />
      <p className="text-[10.5px] text-plata-400" data-costos>
        Costos automáticos de Binance: comisión {c ? num(c.comisionPb, 1) : '—'} pb + deslizamiento {c ? num(c.deslizamientoPb, 1) : '—'} pb por lado ·{' '}
        {r.fundingIncluido ? 'funding incluido (cada 8 h)' : 'funding no incluido: estos datos se grabaron antes de guardar el funding'}
      </p>
      <div data-seccion-backtest>
        <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Capital (empieza en 1)</p>
        <Linea datos={eq} base={1} />
        <p className="mb-1 mt-2 text-[10px] uppercase tracking-[0.14em] text-plata-500">Drawdown (caída desde el máximo)</p>
        <Linea datos={dd} base={0} alto={90} />
        <p className="mt-2 text-[10.5px] text-plata-400" data-cuadre>
          Cuadre: capital final {pct((eq[eq.length - 1] ?? 1) - 1, 2)} · producto de las operaciones {pct(porOps, 2)}
        </p>
      </div>
      {ops.length > 0 && (
        <div className="overflow-x-auto">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Operaciones (últimas 50)</p>
            <button onClick={() => descargarOperaciones(ops)} className="flex items-center gap-1 rounded-md border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:text-white">
              <Download size={11} /> CSV ({num(ops.length)})
            </button>
          </div>
          <table className="w-full min-w-[560px] text-left text-[11px]" data-operaciones>
            <thead>
              <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
                <th className="py-1 font-normal">Entrada</th>
                <th className="py-1 font-normal">Salida</th>
                <th className="py-1 font-normal">Lado</th>
                <th className="py-1 text-right font-normal">Barras</th>
                <th className="py-1 text-right font-normal">Retorno neto</th>
              </tr>
            </thead>
            <tbody>
              {ops.slice(-50).reverse().map((o, i) => (
                <tr key={i} className="border-t border-borde-suave">
                  <td className="py-1 text-plata-300">{fecha(o.entradaT)}</td>
                  <td className="py-1 text-plata-300">{fecha(o.salidaT)}</td>
                  <td className="py-1 text-plata-200">{o.lado > 0 ? 'Largo' : 'Corto'}</td>
                  <td className="cifra py-1 text-right text-plata-300">{o.barras}</td>
                  <td className="cifra py-1 text-right text-white">{pct(o.retorno, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300" data-formulas>
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>La posición que decides al cierre de una barra (p) rige en la barra siguiente: retorno = p × (cierre siguiente / cierre − 1).</li>
          <li>
            Cada cambio de posición paga {c ? `${num(c.comisionPb + c.deslizamientoPb, 1)} pb por lado (comisión ${num(c.comisionPb, 1)} + deslizamiento ${num(c.deslizamientoPb, 1)})` : 'comisión + deslizamiento por lado'}: abrir o cerrar es 1 lado, girar de largo a corto son 2.
          </li>
          <li>Retorno neto de la barra = (1 + retorno de precio) × (1 − costo)^lados − 1. Capital = producto de (1 + retorno neto).</li>
          <li>Nunca se mantiene una posición a través de un hueco de datos, y al final de cada tramo se cierra todo.</li>
          <li>Todo es multiplicativo: el capital final cuadra exacto con el producto de las operaciones.</li>
          <li>Funding: si la operación sigue abierta a las 00:00, 08:00 o 16:00 UTC, se paga (largo) o cobra (corto) la tasa vigente: × (1 − posición × tasa).</li>
        </ul>
      </details>
    </Panel>
  );
}

const n2 = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : v === Infinity ? '∞' : num(v, d));
const pctN = (v: number | null | undefined, d = 1) => (v === undefined ? '—' : pct(v, d));

/** [nombre, fuera de muestra, dentro de muestra, qué significa] */
const filasMetricas = (o: Metricas, i: Metricas): [string, string, string, string][] => [
  ['Retorno total', pctN(o.retornoTotal), pctN(i.retornoTotal), 'Cuánto ganó o perdió en total.'],
  ['Retorno anual (CAGR)', pctN(o.cagr), pctN(i.cagr), 'Lo mismo, llevado a un año (necesita ≥ 3 meses de datos).'],
  ['Sharpe', n2(o.sharpe), n2(i.sharpe), 'Ganancia frente a lo que se movió. > 1 bueno, > 2 muy bueno.'],
  ['Sortino', n2(o.sortino), n2(i.sortino), 'Como el Sharpe, pero solo cuenta las caídas.'],
  ['Drawdown máximo', pctN(o.maxDrawdown === undefined ? undefined : -o.maxDrawdown), pctN(i.maxDrawdown === undefined ? undefined : -i.maxDrawdown), 'La peor caída desde un máximo.'],
  ['Calmar', n2(o.calmar), n2(i.calmar), 'Retorno anual ÷ peor caída. > 1 bueno.'],
  ['Peor racha bajo el máximo', o.duracionDrawdown ? `${num(o.duracionDrawdown.horas, 1)} h` : '—', i.duracionDrawdown ? `${num(i.duracionDrawdown.horas, 1)} h` : '—', 'Tiempo más largo sin recuperar el máximo.'],
  ['Operaciones', num(o.operaciones), num(i.operaciones), 'Cuántas veces entró y salió.'],
  ['% de aciertos', o.aciertos == null ? '—' : `${num(o.aciertos * 100, 1)} %`, i.aciertos == null ? '—' : `${num(i.aciertos * 100, 1)} %`, 'Operaciones ganadoras de cada 100.'],
  ['Factor de beneficio', n2(o.factorBeneficio), n2(i.factorBeneficio), 'Lo ganado ÷ lo perdido. > 1,3 bueno.'],
  ['Esperanza por operación', pctN(o.retornoMedioOperacion, 3), pctN(i.retornoMedioOperacion, 3), 'Lo que deja de media cada operación. Debe ser > 0.'],
  ['Ganancia media / pérdida media', `${pctN(o.gananciaMedia, 2)} / ${pctN(o.perdidaMedia, 2)}`, `${pctN(i.gananciaMedia, 2)} / ${pctN(i.perdidaMedia, 2)}`, 'Cuánto deja una ganadora y cuánto quita una perdedora.'],
  ['Racha perdedora máxima', o.rachaPerdedora === undefined ? '—' : num(o.rachaPerdedora), i.rachaPerdedora === undefined ? '—' : num(i.rachaPerdedora), 'Pérdidas seguidas: prepárate para aguantarlas.'],
  ['Tiempo en mercado', `${num(o.exposicion * 100, 0)} %`, `${num(i.exposicion * 100, 0)} %`, 'Parte del tiempo con una operación abierta.'],
];

/** Recuadro en lenguaje simple: qué es, para qué sirve y qué mirar. */
function Explicacion({ que, sirve, mirar }: { que: string; sirve: string; mirar: string }) {
  return (
    <div className="rounded-lg border border-borde-suave bg-white/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-plata-200" data-explicacion>
      <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Explicación simple</p>
      <p><span className="text-white">Qué es:</span> {que}</p>
      <p><span className="text-white">Para qué te sirve:</span> {sirve}</p>
      <p><span className="text-white">Qué mirar:</span> {mirar}</p>
    </div>
  );
}

const fechaCorta = (t: number | undefined) => (t ? new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const TEXTO_CLASE: Record<string, string> = { excelente: 'Excelente', aceptable: 'Aceptable', débil: 'Débil', sobreajuste: 'Alerta de sobreajuste' };

/** Motor 3 · Walk-Forward: ventanas IS → OOS, θ* por ventana y eficiencia (WFE). */
function SeccionWalkForward({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const w = j.wfo;
  const n = r.filas;
  const x = (i: number) => `${(i / n) * 100}%`;
  const ancho = (a: number, b: number) => `${(Math.max(0, b - a) / n) * 100}%`;
  return (
    <Panel titulo="Motor 3 · Walk-Forward" accion={<span className="text-[10px] text-plata-500">{j.tramos.length} ventanas · objetivo {w ? NOMBRE_OBJETIVO[w.objetivo] : 'Sharpe'}</span>} cuerpo="space-y-4 p-4">
      <Explicacion
        que="entrenar la estrategia con un tramo del pasado (IS), probarla en el tramo siguiente que nunca vio (OOS), y repetirlo avanzando en el tiempo."
        sirve="descubrir si la estrategia aprendió algo real o solo memorizó el pasado. Lo que vale es cómo le va en los tramos que no vio."
        mirar="la eficiencia WFE (≥ 0,5 aceptable, ≥ 0,7 excelente, < 0,3 sobreajuste) y que la mayoría de ventanas OOS ganen."
      />
      {w && (
        <div className="flex flex-wrap items-end gap-6" data-wfe={w.wfe ?? 'null'}>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Eficiencia (WFE)</p>
            <p className="cifra text-3xl font-light text-white">{w.wfe === null ? '—' : num(w.wfe, 2)}</p>
            <p className="text-[11px] text-plata-300">{w.clase ? TEXTO_CLASE[w.clase] : 'El entrenamiento no gana: no hay ventaja que conservar'}</p>
          </div>
          <p className="max-w-md text-[11px] text-plata-400">
            IS de {num(w.lIs)} barras, OOS de {num(w.lOos)}, avanza {num(w.lOos)} cada vez · {num(w.embargo)} barras de separación (embargo) entre cada IS y su OOS.
          </p>
        </div>
      )}
      <div className="space-y-1.5" data-ventanas-wfo>
        {j.tramos.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] text-plata-500">Ventana {i + 1}</span>
            <div className="relative h-3 flex-1 rounded-sm bg-white/[0.04]">
              <div className="absolute inset-y-0 rounded-sm bg-plata-500/50" style={{ left: x(t.isDesde ?? 0), width: ancho(t.isDesde ?? 0, t.isHasta ?? 0) }} title="IS (entrenamiento)" />
              <div className="absolute inset-y-0 rounded-sm bg-white" style={{ left: x(t.oosDesde ?? t.desde), width: ancho(t.oosDesde ?? t.desde, t.oosHasta ?? t.hasta) }} title="OOS (validación ciega)" />
            </div>
          </div>
        ))}
        <p className="flex gap-4 pl-16 text-[10px] text-plata-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-plata-500/50" /> IS · entrena</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-white" /> OOS · prueba ciega</span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[11px]">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
              <th className="py-1 font-normal">#</th>
              <th className="py-1 font-normal">OOS (prueba ciega)</th>
              <th className="py-1 font-normal">Parámetros elegidos (θ*)</th>
              <th className="py-1 text-right font-normal">Objetivo IS</th>
              <th className="py-1 text-right font-normal">Anual IS</th>
              <th className="py-1 text-right font-normal">Anual OOS</th>
              <th className="py-1 text-right font-normal">Retorno OOS</th>
              <th className="py-1 text-right font-normal">Ops</th>
            </tr>
          </thead>
          <tbody>
            {j.tramos.map((t, i) => {
              const vt = r.ventanasT?.[i];
              return (
                <tr key={i} className="border-t border-borde-suave">
                  <td className="py-1 text-plata-300">{i + 1}</td>
                  <td className="py-1 text-plata-400">{fechaCorta(vt?.oosDesdeT)} → {fechaCorta(vt?.oosHastaT)}</td>
                  <td className="py-1 font-mono text-[10.5px] text-plata-400">{JSON.stringify(r.combos[t.combo])}</td>
                  <td className="cifra py-1 text-right text-plata-300">{t.objetivoIs === undefined ? '—' : n2(t.objetivoIs, 3)}</td>
                  <td className="cifra py-1 text-right text-plata-300">{pctN(t.anualIs, 0)}</td>
                  <td className="cifra py-1 text-right text-white">{pctN(t.anualOos, 0)}</td>
                  <td className="cifra py-1 text-right text-white">{pct(t.retorno)}</td>
                  <td className="cifra py-1 text-right text-plata-300">{t.operaciones}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Curva OOS unida (todas las pruebas ciegas seguidas)</p>
        <Linea datos={j.equityOos} base={1} />
      </div>
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Tamaños automáticos: 5 ventanas con IS:OOS = 4:1 → L_OOS = barras ÷ 9, L_IS = 4 × L_OOS. Paso = L_OOS.</li>
          <li>En cada IS: θ* = la variante con mayor objetivo ({w ? NOMBRE_OBJETIVO[w.objetivo] : 'Sharpe'}; tasa libre de riesgo 0). Solo usa barras del IS.</li>
          <li>θ* se congela y se aplica al OOS siguiente. Prohibido reajustar con esos datos.</li>
          <li>Embargo: las {w ? w.embargo : 20} últimas barras antes de cada OOS no se usan para elegir, para que el final del IS no se filtre en el OOS.</li>
          <li>Anualizado = media del retorno por barra × barras por año.</li>
          <li>WFE = media(anualizado OOS) ÷ media(anualizado IS). ≥ 0,7 excelente · ≥ 0,5 aceptable · 0,3–0,5 débil · &lt; 0,3 sobreajuste.</li>
          <li>Retornos compuestos (producto), no sumados: +50 % y −50 % es −25 %, no 0 %.</li>
        </ul>
      </details>
    </Panel>
  );
}

/** Motor 2 · Métricas: fuera de muestra (lo que cuenta) frente a dentro (optimista). */
function SeccionMetricas({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  return (
    <Panel titulo="Motor 2 · Métricas" cuerpo="space-y-3 p-4">
      <Explicacion
        que="los números que resumen cómo fue el Backtest: cuánto ganó, cuánto sufrió y qué tan seguido acertó."
        sirve="comparar estrategias con la misma vara y saber qué esperar: por ejemplo, cuántas pérdidas seguidas te tocará aguantar."
        mirar="la columna «Fuera de muestra» (datos que la estrategia no vio). Esperanza > 0, Sharpe > 1 y un drawdown que puedas soportar."
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs" data-metricas>
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
              <th className="py-1 font-normal">Métrica</th>
              <th className="py-1 text-right font-normal">Fuera de muestra</th>
              <th className="py-1 text-right font-normal">Dentro</th>
              <th className="py-1 pl-4 font-normal">Qué significa</th>
            </tr>
          </thead>
          <tbody>
            {filasMetricas(j.oos, j.dentroMuestra).map(([k, a, b, q]) => (
              <tr key={k} className="border-t border-borde-suave">
                <td className="py-1.5 text-plata-300">{k}</td>
                <td className="cifra py-1.5 text-right text-white">{a}</td>
                <td className="cifra py-1.5 text-right text-plata-500">{b}</td>
                <td className="py-1.5 pl-4 text-[10.5px] text-plata-500">{q}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] text-plata-500">«Dentro» usa la mejor variante con toda la historia: siempre sale mejor de lo que es. Solo cuenta «fuera de muestra».</p>
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Barras por año = 365,25 días ÷ tiempo típico (mediana) entre barras. Los días sin grabar no lo cambian.</li>
          <li>Retorno anual (CAGR) = (1 + retorno total)^(1 / años) − 1, con años = barras ÷ barras por año. Solo con 3 meses o más de datos: con menos, llevarlo a un año da cifras sin sentido.</li>
          <li>Sharpe = media de los retornos por barra ÷ su desviación × √(barras por año).</li>
          <li>Sortino = media ÷ √(media de las caídas al cuadrado) × √(barras por año).</li>
          <li>Drawdown = caída desde el máximo anterior; Calmar = CAGR ÷ drawdown máximo.</li>
          <li>Factor de beneficio = suma de ganancias ÷ suma de pérdidas (∞ si no hubo pérdidas).</li>
          <li>Esperanza = retorno medio por operación. Racha = máximo de perdedoras seguidas.</li>
        </ul>
      </details>
    </Panel>
  );
}

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

      <SeccionBacktest r={r} />
      <SeccionMetricas r={r} />
      <SeccionWalkForward r={r} />

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
