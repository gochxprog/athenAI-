import { useState } from 'react';
import { Check, Download, Minus, X } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import AbanicoTrayectorias from '@/components/charts/AbanicoTrayectorias';
import type { OperacionConHora, RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import type { Metricas } from '@/motores/juez/backtest';
import { NOMBRE_OBJETIVO } from '@/motores/juez/walkForward';
import { ALFA_LUCK, NOMBRE_METODO_LUCK, NOMBRE_METRICA_LUCK } from '@/motores/juez/luckTest';
import { conSigno, num } from '@/lib/format';
import { Explicacion, Histograma, Linea } from './graficos';

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : conSigno(v * 100, d, '%'));
const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });



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

/** Porcentaje sin signo (probabilidades y umbrales). */
const pctSin = (v: number, d = 1) => `${num(v * 100, d)} %`;
const usdTxt = (v: number) => `${Math.round(v).toLocaleString('es-ES')} USD`;

/** Motor 4 · Monte Carlo: miles de órdenes distintas de las mismas operaciones. */
function SeccionMonteCarlo({ r }: { r: RespuestaLaboratorio }) {
  const mc = r.resultado.monteCarlo;
  if (!mc) return (
    <Panel titulo="Motor 4 · Monte Carlo" cuerpo="p-4">
      <p className="text-xs text-plata-500">Hacen falta al menos 5 operaciones fuera de muestra.</p>
    </Panel>
  );
  const cap = mc.capitalInicial ?? 10_000;
  const ruina = mc.probRuina ?? 0;
  return (
    <Panel titulo="Motor 4 · Monte Carlo" accion={<span className="text-[10px] text-plata-500">{num(mc.simulaciones ?? 2000)} simulaciones · {mc.metodo === 'shuffle' ? 'sin reemplazo (shuffle)' : 'con reemplazo (bootstrap)'} · {num(mc.operaciones ?? 0)} operaciones</span>} cuerpo="space-y-4 p-4">
      <Explicacion
        que="tomar tus operaciones y barajarlas miles de veces para ver otros órdenes posibles. El backtest es solo uno de esos órdenes."
        sirve="saber cuánto podrías llegar a perder si las pérdidas te llegan seguidas, y la probabilidad de quemar la cuenta."
        mirar={`la probabilidad de ruina (caer ${pctSin(mc.umbralRuina ?? 0.3, 0)} o más): debe ser ≤ 5 %. Y la peor caída probable (DD P95): ¿la aguantarías?`}
      />
      {mc.alertaOrden && (
        <p className="rounded-lg border border-white/40 px-3 py-2 text-[11.5px] text-white" data-alerta-mc>
          ⚠ La peor caída probable ({pct(-mc.ddP95)}) es más del doble que la del backtest ({pct(-(mc.ddOriginal ?? 0))}). Si las pérdidas se agrupan, dolerá mucho más de lo que muestra el backtest.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-mc>
        {[
          ['Probabilidad de ruina', pctSin(ruina, 1), `caídas ≥ ${pctSin(mc.umbralRuina ?? 0.3, 0)} · máx. 5 %`],
          ['Peor caída probable (DD P95)', pct(-mc.ddP95), `backtest: ${pct(-(mc.ddOriginal ?? 0))}`],
          ['Resultado pesimista (P5)', pct(mc.p5), `${usdTxt(cap)} → ${usdTxt(cap * (1 + mc.p5))}`],
          ['Resultado típico (P50)', pct(mc.p50), `${usdTxt(cap)} → ${usdTxt(cap * (1 + mc.p50))}`],
        ].map(([k, v, nota]) => (
          <div key={k} className="rounded-lg border border-borde-suave px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.12em] text-plata-500">{k}</p>
            <p className="cifra text-xl font-light text-white">{v}</p>
            <p className="text-[10.5px] text-plata-400">{nota}</p>
          </div>
        ))}
      </div>
      {mc.caminos?.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">60 curvas simuladas y bandas P5 · P50 · P95</p>
          <AbanicoTrayectorias datos={{ caminos: mc.caminos, bandas: mc.bandas }} alto={200} />
          <p className="mt-1 text-[10px] text-plata-500">Toca o pasa el ratón por una línea para ver sus métricas.</p>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Retorno final de cada simulación</p>
          <Histograma
            valores={mc.muestras}
            marcas={[
              { v: mc.p5, etiqueta: `P5 ${pct(mc.p5)}` },
              { v: mc.p50, etiqueta: `P50 ${pct(mc.p50)}`, fuerte: true },
              { v: mc.p95, etiqueta: `P95 ${pct(mc.p95)}` },
            ]}
          />
        </div>
        {mc.muestrasDd?.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Caída máxima de cada simulación</p>
            <Histograma
              valores={mc.muestrasDd}
              marcas={[
                { v: mc.ddP95, etiqueta: `DD P95 ${pct(mc.ddP95)}`, fuerte: true },
                { v: mc.umbralRuina, etiqueta: `Ruina ${pctSin(mc.umbralRuina, 0)}` },
              ]}
            />
          </div>
        )}
      </div>
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Entrada: el retorno de cada operación fuera de muestra (T₁ … T_N).</li>
          <li>Bootstrap (con reemplazo): se eligen N operaciones al azar, cada una con probabilidad 1/N; una puede repetirse. Shuffle (sin reemplazo): las mismas operaciones en otro orden.</li>
          <li>Capital(k, i) = Capital(k, i − 1) × (1 + T(k, i)), empezando en {usdTxt(cap)}.</li>
          <li>Drawdown(k, t) = (Pico − Capital) ÷ Pico; MaxDD(k) = el mayor de la simulación.</li>
          <li>Probabilidad de ruina = simulaciones con MaxDD ≥ {pctSin(mc.umbralRuina ?? 0.3, 0)} ÷ {num(mc.simulaciones ?? 2000)}. Si pasa del 5 %, el Juez rechaza.</li>
          <li>Percentiles con interpolación lineal: P5 pesimista (el 95 % de las veces sale mejor), P50 mediana, P95 optimista.</li>
          <li>Alerta si el DD P95 es más del doble que el drawdown de las operaciones en su orden real.</li>
        </ul>
      </details>
    </Panel>
  );
}

/** Motor 5 · Luck test: ¿habilidad o suerte? */
function SeccionLuck({ r }: { r: RespuestaLaboratorio }) {
  const l = r.resultado.suerte;
  if (!l) return (
    <Panel titulo="Motor 5 · Luck test" cuerpo="p-4">
      <p className="text-xs text-plata-500">Hacen falta al menos 5 operaciones fuera de muestra.</p>
    </Panel>
  );
  const metrica = l.metrica ?? 'retorno';
  const fmt = (v: number) => (metrica === 'sharpe' ? num(v, 3) : pct(v, metrica === 'esperanza' ? 3 : 1));
  const N = l.permutaciones ?? 1000;
  const aprueba = l.p < ALFA_LUCK;
  return (
    <Panel titulo="Motor 5 · Luck test" accion={<span className="text-[10px] text-plata-500">{NOMBRE_METODO_LUCK[l.metodo ?? 'permutacion']} · {NOMBRE_METRICA_LUCK[metrica]} · {num(N)} escenarios</span>} cuerpo="space-y-4 p-4">
      <Explicacion
        que="crear cientos de mercados falsos (los mismos movimientos del precio en otro orden) o de entradas tiradas a la moneda, y ver si tu estrategia les gana."
        sirve="separar habilidad de suerte. Si el azar consigue lo mismo que tu estrategia con frecuencia, sus ganancias pudieron ser casualidad."
        mirar="el valor p: menor que 0,05 quiere decir que el azar la iguala menos de 1 de cada 20 veces (aprobado)."
      />
      <div className="flex flex-wrap items-end gap-6" data-luck={l.p}>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Valor p</p>
          <p className="cifra text-3xl font-light text-white">{num(l.p, 3)}</p>
          <p className="text-[11px] text-plata-300">{aprueba ? 'Aprobado: ventaja real' : 'Rechazado: puede ser suerte'}</p>
        </div>
        <p className="max-w-md text-[11.5px] text-plata-300">
          {l.superiores === undefined ? '' : `${num(l.superiores)} de ${num(N)} versiones al azar igualaron o superaron a tu estrategia (${NOMBRE_METRICA_LUCK[metrica]} ${fmt(l.real)}).`}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">Lo que logra el azar (distribución nula) y tu estrategia</p>
        <Histograma valores={l.simulaciones} marcas={[{ v: l.real, etiqueta: `Tu estrategia ${fmt(l.real)}`, fuerte: true }]} />
      </div>
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Hipótesis nula: «la estrategia no tiene habilidad». Se usa lo que hizo fuera de muestra.</li>
          <li>Permutación de retornos: se barajan sin reemplazo los movimientos de cada barra del mercado y se arma un precio falso; tus posiciones quedan igual.</li>
          <li>Entradas aleatorias: el mismo número de operaciones y con las mismas duraciones, pero el lado (compra o venta) sale de una moneda (p = 0,5) y el momento es al azar.</li>
          <li>Cada escenario pasa por el mismo Backtest (comisiones, funding y huecos) y se mide la {NOMBRE_METRICA_LUCK[metrica]}.</li>
          <li>p = (escenarios con métrica ≥ la tuya + 1) ÷ (escenarios + 1). El +1 evita decir «p = 0», que significaría «imposible que sea suerte», algo que nunca se puede asegurar.</li>
          <li>p &lt; 0,05 → aprobado. p ≥ 0,05 → el Juez rechaza por posible suerte.</li>
        </ul>
      </details>
    </Panel>
  );
}

const ESTADO_ROB: Record<string, string> = { aprobado: 'Aprobado en robustez', alerta: 'Alerta: falla 1 prueba crítica', rechazado: 'Rechazado por robustez' };

function Prueba({ titulo, ok, valor, detalle }: { titulo: string; ok: boolean | null; valor: string; detalle: string }) {
  return (
    <div className="rounded-lg border border-borde-suave p-3" data-prueba-robustez={ok === null ? 'na' : ok ? 'ok' : 'falla'}>
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-plata-500">
        {ok === null ? <Minus size={11} /> : ok ? <Check size={11} className="text-white" /> : <X size={11} />} {titulo}
      </p>
      <p className="cifra mt-1 text-lg font-light text-white">{valor}</p>
      <p className="text-[10.5px] text-plata-400">{detalle}</p>
    </div>
  );
}

/** Motor 6 · Robustez: costos ×2, parámetros vecinos, otro mercado y estabilidad por regímenes. */
function SeccionRobustez({ r }: { r: RespuestaLaboratorio }) {
  const rb = r.resultado.robustez;
  if (!rb?.costos2x) return null;
  const { costos2x: c2, vecinos: v, otroMercado: o, estabilidad: e } = rb;
  return (
    <Panel titulo="Motor 6 · Robustez" accion={<span className="text-[10px] text-plata-500">{ESTADO_ROB[rb.estado]}</span>} cuerpo="space-y-4 p-4">
      <Explicacion
        que="pruebas de estrés: el doble de comisiones, cambiar un poco los parámetros, otro mercado y distintos momentos del mercado (sube, baja, calmado, nervioso)."
        sirve="descartar estrategias que solo funcionan en condiciones perfectas o con una configuración exacta (una «isla»)."
        mirar="que pase las 3 pruebas críticas (costos ×2, vecinos y estabilidad). Con 1 fallo sale una alerta; con 2 o más se rechaza."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-robustez={rb.estado}>
        <Prueba titulo="Costos ×2" ok={c2.ok} valor={pct(c2.retorno)} detalle={`Profit Factor ${n2(c2.factorBeneficio)} (mín. 1,2) · retorno > 0`} />
        <Prueba titulo="Parámetros vecinos" ok={v.ok} valor={v.proporcion === null ? '—' : pctSin(v.proporcion, 0)} detalle={v.proporcion === null ? 'Pon 3 o más valores por parámetro en PARAMETROS para medirlo' : `aceptables (mín. 70 %)${v.isla ? ' · ⚠ isla de optimización' : ''}`} />
        <Prueba titulo="Estabilidad por regímenes" ok={e.ok} valor={pctSin(e.consistencia, 0)} detalle={`sub-periodos que ganan (mín. 60 %) · el mejor aporta ${e.concentracion === null ? '—' : pctSin(e.concentracion, 0)} (máx. 90 %)`} />
        <Prueba titulo={`Otro mercado${o ? ` · ${o.simbolo}` : ''}`} ok={o ? o.ok : null} valor={o ? pct(o.retornoTotal) : 'no probado'} detalle={o ? `caída ${pct(-o.maxDrawdown)} · ${o.operaciones} operaciones` : 'No hay otro mercado grabado en la carpeta (se elige solo)'} />
      </div>
      {v.lista.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Vecinos de los parámetros elegidos antes del primer tramo fuera de muestra {JSON.stringify(r.combos[r.resultado.robustez.vecinos.base ?? r.resultado.dentroMuestra.combo])} · medidos fuera de muestra</p>
          <table className="w-full min-w-[520px] text-left text-[11px]">
            <thead>
              <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
                <th className="py-1 font-normal">Cambio</th>
                <th className="py-1 text-right font-normal">Retorno</th>
                <th className="py-1 text-right font-normal">Sharpe</th>
                <th className="py-1 text-right font-normal">Caída del Sharpe</th>
                <th className="py-1 text-right font-normal">¿Aceptable?</th>
              </tr>
            </thead>
            <tbody>
              {v.lista.map((x) => (
                <tr key={x.cambio} className="border-t border-borde-suave">
                  <td className="py-1 font-mono text-[10.5px] text-plata-300">{x.cambio}</td>
                  <td className="cifra py-1 text-right text-white">{pct(x.retorno)}</td>
                  <td className="cifra py-1 text-right text-plata-300">{n2(x.sharpe)}</td>
                  <td className="cifra py-1 text-right text-plata-300">{x.caida === null ? '—' : pctSin(x.caida, 0)}</td>
                  <td className="py-1 text-right text-plata-200">{x.aceptable ? 'Sí' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {e.subperiodos.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Resultado en cada sub-periodo y su régimen</p>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10" data-subperiodos>
            {e.subperiodos.map((s, i) => (
              <div key={i} className={`rounded-md border px-1.5 py-1 text-center ${s.retorno > 0 ? 'border-white/50' : 'border-borde-suave'}`}>
                <p className="cifra text-[11px] text-white">{pct(s.retorno)}</p>
                <p className="text-[9px] text-plata-500">{s.direccion === 'sube' ? '↑ sube' : '↓ baja'}</p>
                <p className="text-[9px] text-plata-500">vol. {s.volatilidad}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Costos ×2: los mismos parámetros elegidos en cada ventana del Walk-Forward, con comisión × 2 y deslizamiento × 2. Pasa con Profit Factor &gt; 1,2 y retorno &gt; 0.</li>
          <li>Vecinos: los mejores parámetros se eligen SOLO con los datos anteriores al primer tramo fuera de muestra, y ellos y sus vecinos se miden en el tramo fuera de muestra (sin fuga de información). Cada parámetro se mueve un paso de tu rejilla (arriba y abajo) dejando los demás igual. Aceptable = gana. Pasa si ≥ 70 % son aceptables. Si el Sharpe cae de media más de un 50 %: «isla de optimización».</li>
          <li>Otro mercado: los mismos parámetros, sin reoptimizar. No debe destruir capital: retorno &gt; −10 % y caída ≤ 2 × la del original (mínimo 10 %).</li>
          <li>Estabilidad: el tramo fuera de muestra se corta en 10 sub-periodos; cada uno se clasifica por dirección (sube o baja) y volatilidad (alta o baja frente a la mediana). Pasa si gana en ≥ 60 % y ningún sub-periodo aporta ≥ 90 % de las ganancias.</li>
          <li>Pruebas críticas: costos ×2, vecinos y estabilidad. 0 fallos: aprobado; 1: alerta; 2 o más: rechazado.</li>
        </ul>
      </details>
    </Panel>
  );
}

/** Motores 7 y 8 · Sobreajuste: Deflated Sharpe y PBO. */
function SeccionSobreajuste({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const d = j.dsrDetalle;
  const p = j.pboDetalle;
  const dato = (k: string, v: string) => (
    <div key={k} className="flex justify-between gap-2 border-t border-borde-suave py-1 text-[11px]">
      <span className="text-plata-400">{k}</span>
      <span className="cifra text-plata-100">{v}</span>
    </div>
  );
  return (
    <Panel titulo="Motores 7 y 8 · Sobreajuste" accion={<span className="text-[10px] text-plata-500">{num(j.ensayos)} variantes probadas en total con esta idea</span>} cuerpo="grid gap-6 p-4 xl:grid-cols-2">
      <div className="space-y-3" data-dsr={d?.dsr ?? 'null'}>
        <p className="text-[11px] uppercase tracking-[0.14em] text-white">Motor 7 · Deflated Sharpe</p>
        <Explicacion
          que="si pruebas muchas versiones de una idea, alguna sale con buen Sharpe por pura suerte. Este motor calcula el Sharpe que el azar daría con ese número de pruebas y mira si el tuyo lo supera de verdad."
          sirve="saber si tu Sharpe es real o fruto de haber probado demasiadas versiones."
          mirar="el DSR debe ser 0,95 o más (95 % de confianza)."
        />
        {d ? (
          <>
            <div>
              <p className="cifra text-3xl font-light text-white">{num(d.dsr, 3)}</p>
              <p className="text-[11px] text-plata-300">{d.dsr >= 0.95 ? 'Aprobado: el Sharpe es genuino' : 'Rechazado: puede ser efecto de probar muchas variantes'}</p>
            </div>
            <div>
              {dato('Sharpe observado (por barra, fuera de muestra) · SR_obs', num(d.srObs, 4))}
              {dato('Sharpe que el azar logra con N pruebas · SR*', num(d.srEstrella, 4))}
              {dato('Variantes probadas · N', num(d.n))}
              {dato('Barras · T', num(d.t))}
              {dato('Asimetría · γ₃', num(d.asimetria, 3))}
              {dato('Curtosis · γ₄ (3 = normal)', num(d.curtosis, 3))}
              {dato(`Varianza de los Sharpe · Var_SR (${d.origenVarSr === 'variantes' ? 'de tus variantes' : 'una sola variante: 1/T'})`, d.varSr.toExponential(3))}
              {dato('Desviación del Sharpe · σ_SR', num(d.sigma, 5))}
            </div>
          </>
        ) : (
          <p className="text-xs text-plata-500">Sin datos suficientes fuera de muestra.</p>
        )}
        <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
          <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>SR* = √Var_SR × ((1 − γ) × Z⁻¹(1 − 1/N) + γ × Z⁻¹(1 − 1/(N × e))), con γ = 0,5772 (Euler-Mascheroni) y Z⁻¹ el cuantil de la normal.</li>
            <li>σ_SR = √((1 − γ₃ × SR_obs + ((γ₄ − 1) ÷ 4) × SR_obs²) ÷ (T − 1)).</li>
            <li>DSR = Φ((SR_obs − SR*) ÷ σ_SR), con Φ la normal acumulada. Aprueba si ≥ 0,95.</li>
            <li>N cuenta todas las variantes que has probado con esta idea, también en pruebas anteriores.</li>
          </ul>
        </details>
      </div>
      <div className="space-y-3" data-pbo={p?.pbo ?? 'null'}>
        <p className="text-[11px] uppercase tracking-[0.14em] text-white">Motor 8 · PBO (probabilidad de sobreajuste)</p>
        <Explicacion
          que="corta la historia en 16 trozos y prueba todas las formas de usar la mitad para elegir la mejor variante y la otra mitad para comprobarla (12.870 combinaciones)."
          sirve="saber si elegir «la mejor» fue una lotería: si la elegida suele quedar por debajo de la mitad fuera, el proceso de optimizar está engañándote."
          mirar="el PBO debe ser menor que 5 %. (En la literatura se alarma desde el 50 %; tu especificación pide 5 %, que es muy exigente.)"
        />
        {p ? (
          <>
            <div>
              <p className="cifra text-3xl font-light text-white">{pctSin(p.pbo, 1)}</p>
              <p className="text-[11px] text-plata-300">
                {num(p.malas)} de {num(p.combinaciones)} combinaciones eligieron una variante que fuera quedó por debajo de la mediana.
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-plata-500">λ = logit(ω) de cada combinación (izquierda de 0 = sobreajuste)</p>
              <Histograma valores={p.lambdas} marcas={[{ v: 0, etiqueta: 'λ = 0 (mediana)', fuerte: true }]} />
            </div>
          </>
        ) : (
          <p className="text-xs text-plata-500">No aplica: hay una sola variante. Pon varios valores en PARAMETROS para medirlo.</p>
        )}
        <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
          <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>La serie de cada variante se divide en S = 16 bloques. Combinaciones = 16! ÷ (8! × 8!) = 12.870.</li>
            <li>En cada combinación, la mitad de los bloques es entrenamiento (IS) y la otra mitad prueba (OOS).</li>
            <li>Se elige la variante con mayor rendimiento acumulado en el IS (suma de log-retornos).</li>
            <li>ω = su puesto en el OOS ÷ (N + 1); λ = ln(ω ÷ (1 − ω)).</li>
            <li>PBO = combinaciones con ω &lt; 0,5 ÷ 12.870. Aprueba si &lt; 5 %.</li>
          </ul>
        </details>
      </div>
    </Panel>
  );
}

const TEXTO_VEREDICTO: Record<string, string> = { APROBADA: 'APROBADA para Paper Trading', 'APROBADA CON RESERVA': 'APROBADA CON RESERVA (cuarentena)', RECHAZADA: 'RECHAZADA', 'DATOS INSUFICIENTES': 'DATOS INSUFICIENTES' };

/** Motor 9 · Anti-futuro: análisis del código y prueba de causalidad. */
function SeccionAntiFuturo({ r }: { r: RespuestaLaboratorio }) {
  const a = r.resultado.antiFuturo;
  return (
    <Panel titulo="Motor 9 · Anti-futuro" accion={<span className="text-[10px] text-plata-500">{a ? (a.ok ? 'causal: aprobado' : 'fuga de datos: rechazado') : 'no comprobado'}</span>} cuerpo="space-y-4 p-4">
      <Explicacion
        que="revisa que tu estrategia decida solo con lo que ya pasó. Lee tu código buscando accesos a filas futuras y luego la ejecuta quitando y cambiando los datos posteriores."
        sirve="cazar el error más peligroso: un backtest que gana porque, sin querer, «ve» el futuro. En vivo eso es imposible y la estrategia se hunde."
        mirar="que diga «causal». Cualquier fuga rechaza la estrategia, sin importar lo que gane."
      />
      {a ? (
        <div className="grid gap-3 sm:grid-cols-3" data-antifuturo={a.ok ? 'ok' : 'falla'}>
          <Prueba titulo="Análisis del código" ok={!(a.estatico?.violaciones.length ?? 0)} valor={a.estatico ? (a.estatico.violaciones.length ? `${a.estatico.violaciones.length} fuga(s)` : 'sin fugas') : '—'} detalle={a.estatico?.violaciones[0] ?? (a.estatico?.alertas[0] ? `Aviso: ${a.estatico.alertas[0]}` : 'no lee filas posteriores ni la última fila de todos los datos')} />
          <Prueba titulo="Datos recortados" ok={a.dinamico ? a.dinamico.recorte : a.ok} valor={a.dinamico ? (a.dinamico.recorte ? 'idénticas' : 'cambian') : '—'} detalle={`posiciones pasadas al quitar las filas posteriores en ${a.dinamico?.cortes ?? 8} puntos`} />
          <Prueba titulo="Datos alterados" ok={a.dinamico ? a.dinamico.alteracion : null} valor={a.dinamico ? (a.dinamico.alteracion ? 'idénticas' : 'cambian') : '—'} detalle={a.dinamico?.prueba ? `la fila ${a.dinamico.fila} cambia: usa el futuro` : 'posiciones pasadas al cambiar al azar las filas posteriores'} />
        </div>
      ) : (
        <p className="text-xs text-plata-500">No se comprobó.</p>
      )}
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Regla: Señal(t) = f(Datos[0 : t − 1]). En la plataforma, la posición que decides con la fila i (barra ya cerrada) rige desde la barra i + 1: la orden solo conoce el pasado.</li>
          <li>Código: se buscan filas[i + k], filas[-1] o filas[len(filas) − 1] (fuga directa: rechaza) y estadísticas sobre todas las filas, como max(… for f in filas) (posible normalización con el futuro: aviso).</li>
          <li>Ejecución: en 8 cortes t se quitan las filas ≥ t y, aparte, se cambian al azar. Las posiciones de las filas &lt; t deben ser idénticas; si cambian, la estrategia usaba el futuro.</li>
          <li>Normaliza siempre con una ventana del pasado (rolling), nunca con todas las filas.</li>
        </ul>
      </details>
    </Panel>
  );
}

/** Motor 10 · Veredicto: puertas de cero tolerancia, puntuación y todas las reglas. */
function SeccionVeredicto({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const s = j.score;
  const partes: [string, number, number][] = s
    ? [
        ['Walk-Forward (WFE)', 25, s.partes.wfo],
        ['Costos ×2 y vecinos', 25, s.partes.costosVecinos],
        ['Deflated Sharpe y PBO', 30, s.partes.sobreajuste],
        ['Curva y Luck test', 20, s.partes.curva],
      ]
    : [];
  return (
    <Panel titulo="Motor 10 · Veredicto" accion={<span className="text-[10px] text-plata-500">{TEXTO_VEREDICTO[j.veredicto] ?? j.veredicto}</span>} cuerpo="space-y-4 p-4">
      <Explicacion
        que="el juez central. Primero mira las puertas de cero tolerancia: si falla una, se rechaza aunque gane mucho. Si las pasa todas, le pone una nota de 0 a 100."
        sirve="tener una sola decisión clara y el motivo exacto: rechazada (por qué), aprobada con reserva (cuarentena) o lista para Paper Trading."
        mirar="todas las puertas en ✓ y la nota: 75 o más = lista para Paper Trading; menos de 75 = con reserva."
      />
      {j.puertas && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Puertas de cero tolerancia</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-puertas>
            {j.puertas.map((p) => (
              <Prueba key={p.nombre} titulo={p.nombre} ok={p.ok} valor={p.valor} detalle={`se exige ${p.umbral}`} />
            ))}
          </div>
        </div>
      )}
      {s && (
        <div data-score={s.total}>
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Puntuación · {num(s.total, 0)} de 100 (se piden 75)</p>
          <div className="space-y-1.5">
            {partes.map(([k, peso, v]) => (
              <div key={k} className="flex items-center gap-3 text-[11px]">
                <span className="w-44 shrink-0 text-plata-300">{k} · {peso} %</span>
                <span className="relative h-2 flex-1 rounded-full bg-white/10">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${v * 100}%` }} />
                </span>
                <span className="cifra w-16 text-right text-white">{num(v * peso, 1)} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">Todas las reglas</p>
        <table className="w-full min-w-[720px] text-left text-xs">
          <tbody>
            {j.reglas.map((g) => (
              <tr key={g.nombre} className="border-b border-borde-suave last:border-0" data-regla={g.ok === null ? 'na' : g.ok ? 'ok' : 'falla'}>
                <td className="w-6 py-2">{g.ok === null ? <Minus size={13} className="text-plata-600" /> : g.ok ? <Check size={13} className="text-white" /> : <X size={13} className="text-plata-400" />}</td>
                <td className="py-2 text-plata-100">{g.nombre}</td>
                <td className="py-2 text-[10px] uppercase tracking-[0.1em] text-plata-500">{g.tipo === 'puerta' ? 'puerta' : 'puntúa'}</td>
                <td className="cifra py-2 text-white">{g.valor}</td>
                <td className="py-2 text-plata-500">{g.umbral}</td>
                <td className="py-2 text-[10.5px] text-plata-500">{g.explicacion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Antes de nada: ≥ 500 barras y ≥ 30 operaciones fuera de muestra; si no, «datos insuficientes».</li>
          <li>Puertas (si falla una: rechazada): anti-futuro sin fugas · ruina ≤ 5 % · PBO &lt; 5 % · DSR ≥ 0,95 · Luck test p &lt; 0,05 · módulo de robustez (menos de 2 fallos críticos). Una puerta que no aplica (p. ej. PBO con una sola variante) no rechaza.</li>
          <li>Nota (cada parte de 0 a 1): WFE ÷ 0,7 (25 %); media de (PF con costos ×2 − 1) ÷ 0,5 y vecinos aceptables (25 %); media de (DSR − 0,5) ÷ 0,5 y 1 − PBO ÷ 0,5 (30 %); media de 1 − p ÷ 0,05, Sharpe anual ÷ 2 y 1 − drawdown ÷ 30 % (20 %).</li>
          <li>75 o más: aprobada para Paper Trading. Menos de 75: aprobada con reserva (cuarentena).</li>
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
        <p className={`mt-1 text-2xl font-light ${aprobada ? '' : 'text-white'}`}>
          {TEXTO_VEREDICTO[j.veredicto] ?? j.veredicto}
          {j.score && <span className="cifra ml-3 text-base">{num(j.score.total, 0)}/100</span>}
        </p>
        <p className={`mt-1 text-sm ${aprobada ? '' : 'text-plata-200'}`}>{j.resumen}</p>
        {(j.alertas ?? []).map((a) => (
          <p key={a} className={`mt-1 text-[11.5px] ${aprobada ? 'text-black/80' : 'text-plata-100'}`} data-alerta>
            ⚠ {a}
          </p>
        ))}
        <p className={`mt-2 text-[10.5px] ${aprobada ? 'text-black/60' : 'text-plata-500'}`}>
          {num(r.filas)} dollar bars ({fecha(r.desde)} → {fecha(r.hasta)}) · fuera de muestra desde {fecha(r.inicioOosT)} · {r.combos.length} {r.combos.length === 1 ? 'variante' : 'variantes'} · {j.ensayos} probadas en total · {num(r.segundos, 1)} s
        </p>
      </div>

      <PestanasJuez r={r} />
    </div>
  );
}

/** Los motores del Juez en pestañas, uno por pestaña (solo presentación: cada sección es la misma de siempre). */
const PESTANAS_JUEZ: { id: string; titulo: string; Seccion: (p: { r: RespuestaLaboratorio }) => JSX.Element | null }[] = [
  { id: 'backtest', titulo: '1 · Backtest', Seccion: SeccionBacktest },
  { id: 'metricas', titulo: '2 · Métricas', Seccion: SeccionMetricas },
  { id: 'wfo', titulo: '3 · Walk-Forward', Seccion: SeccionWalkForward },
  { id: 'mc', titulo: '4 · Monte Carlo', Seccion: SeccionMonteCarlo },
  { id: 'luck', titulo: '5 · Luck test', Seccion: SeccionLuck },
  { id: 'robustez', titulo: '6 · Robustez', Seccion: SeccionRobustez },
  { id: 'sobreajuste', titulo: '7–8 · DSR y PBO', Seccion: SeccionSobreajuste },
  { id: 'antifuturo', titulo: '9 · Anti-futuro', Seccion: SeccionAntiFuturo },
  { id: 'veredicto', titulo: '10 · Veredicto', Seccion: SeccionVeredicto },
];

function PestanasJuez({ r }: { r: RespuestaLaboratorio }) {
  const [activa, setActiva] = useState<string>('backtest');
  const todas = activa === 'todas';
  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-borde p-1" role="tablist" aria-label="Motores del Juez">
        {[...PESTANAS_JUEZ.map((x) => [x.id, x.titulo] as const), ['todas', 'Ver todos'] as const].map(([id, titulo]) => (
          <button key={id} role="tab" aria-selected={activa === id} data-pestana-juez={id} onClick={() => setActiva(id)} className={`shrink-0 rounded-lg px-3 py-2 text-xs ${activa === id ? 'bg-white text-black' : 'text-plata-300 hover:text-white'}`}>
            {titulo}
          </button>
        ))}
      </div>
      {PESTANAS_JUEZ.filter((x) => todas || x.id === activa).map(({ id, Seccion }) => (
        <Seccion key={id} r={r} />
      ))}
    </div>
  );
}
