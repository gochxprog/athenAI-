import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookMarked, Boxes, Cpu, Database, Gauge, Gavel, Layers, ListOrdered, Lock, ShieldCheck, TreePine, XCircle } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import Insignia, { InsigniaVeredicto } from '@/components/ui/Insignia';
import Barra from '@/components/ui/Barra';
import BarrasH from '@/components/charts/BarrasH';
import CurvaEquityJuez from '@/components/charts/CurvaEquityJuez';
import { useSistema, usePulso } from '@/hooks/SistemaDemo';
import { CAPITAL_BACKTEST, ESTRATEGIAS, FEATURES, MODELOS, RECHAZOS_JUEZ, REGLAS_JUEZ, WALK_FORWARD, type Estrategia } from '@/data/mock';
import { crearAleatorio } from '@/lib/random';
import { num, pct, usd } from '@/lib/format';

export default function LaboratorioView() {
  const [id, setId] = useState('E-087');
  const e = ESTRATEGIAS.find((x) => x.id === id)!;

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Laboratorio"
        titulo="Backtest Engine y Juez"
        descripcion="Aquí viven los modelos de Machine Learning clásico y el Juez. Backtest, Walk-Forward y Monte Carlo validan: nunca predicen. Las reglas del Juez están bloqueadas y ningún modelo puede modificarlas."
      >
        <Insignia variante="contorno">
          <Lock size={10} /> Reglas del Juez bloqueadas
        </Insignia>
      </Encabezado>

      <Pipeline />

      <Panel
        titulo="Curva de equity · In-Sample vs Out-of-Sample"
        icono={Gauge}
        accion={
          <select
            value={id}
            onChange={(ev) => setId(ev.target.value)}
            className="rounded-md border border-borde bg-black px-2 py-1 font-mono text-[11px] text-plata-100 outline-none focus:border-plata-400"
            aria-label="Estrategia a visualizar"
          >
            {ESTRATEGIAS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id} · {x.nombre} · {x.veredicto}
              </option>
            ))}
          </select>
        }
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-white">
              {e.id} · {e.nombre}
            </p>
            <p className="text-[11px] text-plata-500">
              Origen {e.origen} · propuesta por {e.modelo} · capital de backtest {usd(CAPITAL_BACKTEST, 0)} · costos incluidos
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[10px] text-plata-400">
            <Leyenda trazo="h-px w-5 bg-plata-300" texto="In-Sample (entrenamiento)" />
            <Leyenda trazo="h-0.5 w-5 bg-white" texto="Out-of-Sample (Juez)" />
            <Leyenda trazo="h-2.5 w-5 bg-white/15" texto="Monte Carlo P10–P90" />
            <Leyenda trazo="h-px w-5 border-t border-dashed border-white/60" texto="P5 / P95" />
            <InsigniaVeredicto valor={e.veredicto} />
          </div>
        </div>
        <CurvaParaEstrategia e={e} />
      </Panel>

      <MetricasJuez e={e} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel titulo="Filtro de rechazo del Juez · motivos acumulados" icono={XCircle} accion={<span className="cifra text-[10px] text-plata-500">{num(RECHAZOS_JUEZ.reduce((a, r) => a + r.cantidad, 0))} rechazadas</span>}>
          <BarrasH datos={RECHAZOS_JUEZ.map((r) => ({ etiqueta: r.razon, valor: r.cantidad }))} total />
        </Panel>
        <Panel titulo="Reglas del Juez · solo lectura" icono={Lock} accion={<Insignia variante="tenue">Bloqueadas</Insignia>}>
          <ul className="divide-y divide-borde-suave">
            {REGLAS_JUEZ.map((r) => (
              <li key={r.regla} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                <span className="flex items-center gap-2 text-plata-300">
                  <Lock size={11} className="shrink-0 text-plata-500" />
                  {r.regla}
                </span>
                <span className="cifra shrink-0 text-white">{r.umbral}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] leading-relaxed text-plata-500">
            El Juez es código plano versionado (v3.2.0, firma 4c1e9b0). Los modelos solo reciben su veredicto; no pueden leer ni cambiar los umbrales.
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel titulo={`Walk-Forward · ${e.id} · Sharpe por ventana`} icono={Layers}>
          <WalkForward e={e} />
        </Panel>
        <ColaPruebas />
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
          <Cpu size={13} /> Núcleo de Machine Learning
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          {MODELOS.filter((m) => m.ubicacion === 'Laboratorio').map((m, i) => (
            <ModeloML key={m.id} indice={i} id={m.id} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Leyenda({ trazo, texto }: { trazo: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block ${trazo}`} />
      {texto}
    </span>
  );
}

function CurvaParaEstrategia({ e }: { e: Estrategia }) {
  const derivaIS = (Math.max(e.expectancy, 0) + e.overfitting * 0.9 + 6) / CAPITAL_BACKTEST;
  const derivaOOS = e.expectancy / CAPITAL_BACKTEST;
  const opsIS = Math.max(60, Math.round(e.trades * 0.65));
  const opsOOS = Math.max(40, e.trades - opsIS);
  return (
    <CurvaEquityJuez
      key={e.id}
      semilla={e.semilla}
      deriva={derivaIS}
      vol={0.0042 + e.overfitting * 0.00005}
      retencionOOS={derivaOOS / derivaIS}
      operacionesIS={Math.min(opsIS, 220)}
      operacionesOOS={Math.min(opsOOS, 140)}
      capital={CAPITAL_BACKTEST}
    />
  );
}

function MetricasJuez({ e }: { e: Estrategia }) {
  const dd = Math.abs(e.maxDD) / CAPITAL_BACKTEST;
  const filas = [
    { k: 'Win Rate', v: pct(e.winRate, 1), ok: e.winRate >= 0.55, regla: '≥ 55%' },
    { k: 'Profit Factor', v: num(e.profitFactor, 2), ok: e.profitFactor >= 1.3, regla: '≥ 1,30' },
    { k: 'Expectancy', v: usd(e.expectancy, 1), ok: e.expectancy > 0, regla: '> 0 por operación' },
    { k: 'Max Drawdown', v: usd(e.maxDD, 0), ok: dd <= 0.12, regla: `${pct(dd, 1)} · ≤ 12%` },
    { k: 'Sharpe / Sortino', v: `${num(e.sharpe, 2)} / ${num(e.sortino, 2)}`, ok: e.sharpe >= 1, regla: 'Sharpe ≥ 1,00' },
    { k: 'Prob. sobreajuste', v: `${e.overfitting}%`, ok: e.overfitting <= 25, regla: 'PBO ≤ 25%' },
    { k: 'Luck test', v: `p = ${num(e.pValor, 3)}`, ok: e.pValor <= 0.05, regla: 'p ≤ 0,05' },
    { k: 'Operaciones', v: num(e.trades), ok: e.trades >= 80, regla: '≥ 80' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
      {filas.map((f, i) => (
        <motion.div key={`${e.id}-${f.k}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="panel p-3">
          <div className="flex items-center justify-between">
            <p className="etiqueta truncate">{f.k}</p>
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${f.ok ? 'bg-white text-black' : 'border border-plata-500 text-plata-400'}`} title={f.ok ? 'Cumple' : 'No cumple'}>
              {f.ok ? '✓' : '✕'}
            </span>
          </div>
          <p className={`cifra mt-1.5 text-lg ${f.ok ? 'text-white' : 'text-plata-400 line-through decoration-plata-600'}`}>{f.v}</p>
          <p className="mt-0.5 font-mono text-[9.5px] text-plata-500">{f.regla}</p>
        </motion.div>
      ))}
    </div>
  );
}

function Pipeline() {
  const { mercado, motor } = useSistema();
  const etapas = [
    { t: 'Datos', d: `${num(mercado.dollarBars)} barras`, icono: Database },
    { t: 'Componentes', d: `${FEATURES.length} Features`, icono: Boxes },
    { t: 'Cola', d: `${motor.cola} hipótesis`, icono: ListOrdered },
    { t: 'Motor', d: `${motor.pruebas} backtests`, icono: Cpu },
    { t: 'Evaluación', d: '99,8% cobertura', icono: Gauge, anillo: 99.8 },
    { t: 'Control', d: 'reglas bloqueadas', icono: ShieldCheck },
    { t: 'Libro de estrategias', d: `${ESTRATEGIAS.length} registradas`, icono: BookMarked },
  ];
  return (
    <Panel cuerpo="overflow-x-auto px-4 py-5">
      <div className="flex min-w-[880px] items-center">
        {etapas.map((et, i) => {
          const Icono = et.icono;
          return (
            <div key={et.t} className="flex flex-1 items-center">
              <div className="flex w-[104px] shrink-0 flex-col items-center text-center">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-borde bg-white/[0.03]">
                  {et.anillo ? (
                    <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
                      <circle cx="24" cy="24" r="21" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
                      <motion.circle cx="24" cy="24" r="21" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: et.anillo / 100 }} transition={{ duration: 1.6 }} />
                    </svg>
                  ) : null}
                  <Icono size={17} strokeWidth={1.4} className="text-plata-100" />
                </div>
                <p className="mt-2 text-[11px] text-white">{et.t}</p>
                <p className="cifra text-[9.5px] text-plata-500">{et.d}</p>
              </div>
              {i < etapas.length - 1 && (
                <div className="relative mx-1 h-px flex-1 bg-white/10">
                  {[0, 1, 2].map((k) => (
                    <motion.span
                      key={k}
                      className="absolute -top-[1.5px] h-[4px] w-[4px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
                      animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity, delay: k * 0.6 + i * 0.15, ease: 'linear' }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function WalkForward({ e }: { e: Estrategia }) {
  const factor = e.sharpe / 1.86;
  const datos = WALK_FORWARD.map((w) => ({ v: w.v, is: w.is * Math.max(factor, 0.55), oos: w.oos * factor * (1 - Math.max(0, e.overfitting - 15) / 100) }));
  const max = Math.max(...datos.flatMap((d) => [d.is, d.oos]), 2.5);
  const promIS = datos.reduce((a, d) => a + d.is, 0) / datos.length;
  const promOOS = datos.reduce((a, d) => a + d.oos, 0) / datos.length;
  return (
    <div>
      <div className="relative flex h-44 items-end gap-2 border-b border-borde-suave">
        <span className="absolute inset-x-0 border-t border-dashed border-white/25" style={{ bottom: `${(1 / max) * 100}%` }}>
          <span className="absolute -top-2 left-0 bg-black pr-1.5 font-mono text-[9px] text-plata-400">Sharpe 1,00 · umbral</span>
        </span>
        {datos.map((d, i) => (
          <div key={d.v} className="flex h-full flex-1 items-end justify-center gap-[2px]">
            <motion.div className="w-1/2 max-w-[14px] rounded-t-sm border border-plata-500" initial={{ height: 0 }} animate={{ height: `${(d.is / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.04 }} />
            <motion.div className="w-1/2 max-w-[14px] rounded-t-sm bg-white" initial={{ height: 0 }} animate={{ height: `${(Math.max(d.oos, 0.02) / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.04 + 0.1 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {datos.map((d) => (
          <span key={d.v} className="flex-1 text-center font-mono text-[9px] text-plata-500">
            V{d.v}
          </span>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-borde-suave pt-3">
        <div>
          <p className="etiqueta">IS promedio</p>
          <p className="cifra mt-1 text-sm text-white">{num(promIS, 2)}</p>
        </div>
        <div>
          <p className="etiqueta">OOS promedio</p>
          <p className="cifra mt-1 text-sm text-white">{num(promOOS, 2)}</p>
        </div>
        <div>
          <p className="etiqueta">Degradación</p>
          <p className="cifra mt-1 text-sm text-white">−{num((1 - promOOS / promIS) * 100, 0)}%</p>
        </div>
      </div>
      <p className="mt-2 flex items-center gap-3 text-[10px] text-plata-500">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 border border-plata-500" /> In-Sample</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-white" /> Out-of-Sample</span>
        <span>12 ventanas · 70/30 · anclado</span>
      </p>
    </div>
  );
}

function ColaPruebas() {
  const { motor } = useSistema();
  const n = usePulso(900);
  const fases = ['Walk-Forward', 'Monte Carlo', 'Luck test', 'Costos'];
  return (
    <Panel titulo="Pruebas en proceso" icono={Gavel} accion={<span className="cifra text-[10px] text-plata-500">{motor.pruebas} activas</span>} cuerpo="max-h-[300px] overflow-y-auto px-4 py-2">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
            <th className="py-2 font-normal">Hipótesis</th>
            <th className="py-2 font-normal">Fase</th>
            <th className="w-[40%] py-2 font-normal">Avance</th>
          </tr>
        </thead>
        <tbody>
          {motor.idsPrueba.map((id) => {
            const fase = fases[id % fases.length];
            const avance = (id * 7 + n * (2 + (id % 5))) % 100;
            const detalle = fase === 'Walk-Forward' ? `ventana ${1 + Math.floor((avance / 100) * 12)}/12` : fase === 'Monte Carlo' ? `${num(Math.floor(avance * 20))}/2.000` : fase === 'Luck test' ? `${num(Math.floor(avance * 10))}/1.000` : 'comisión + slippage';
            return (
              <tr key={id} className="border-t border-borde-suave">
                <td className="py-2 font-mono text-plata-200">H-{id}</td>
                <td className="py-2">
                  <p className="text-plata-200">{fase}</p>
                  <p className="font-mono text-[9.5px] text-plata-500">{detalle}</p>
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <Barra valor={avance} />
                    <span className="cifra w-8 text-right text-[10px] text-plata-400">{avance}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function ModeloML({ id, indice }: { id: string; indice: number }) {
  const m = MODELOS.find((x) => x.id === id)!;
  const n = usePulso(1200);
  const importancias = useMemo(() => {
    const rand = crearAleatorio(indice + 5);
    const brutas = FEATURES.map((f) => f.importancia * (0.7 + rand() * 0.6));
    const suma = brutas.reduce((a, b) => a + b, 0);
    return FEATURES.map((f, i) => ({ etiqueta: f.nombre, valor: brutas[i] / suma })).sort((a, b) => b.valor - a.valor).slice(0, 5);
  }, [indice]);
  const total = id === 'LGBM-Flow-02' ? 1200 : 400;
  const progreso = (n * (id === 'LGBM-Flow-02' ? 9 : 3)) % total;
  const Icono = id === 'RF-Alpha-01' ? TreePine : Layers;

  return (
    <Panel titulo={`${m.id} · ${m.familia}`} icono={Icono} accion={<Insignia variante="tenue">Re-entrenando</Insignia>}>
      <p className="text-[11px] text-plata-500">{m.detalle}</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <p className="etiqueta">AUC</p>
          <p className="cifra mt-1 text-lg text-white">{num(m.auc, 3)}</p>
        </div>
        <div>
          <p className="etiqueta">Accuracy</p>
          <p className="cifra mt-1 text-lg text-white">{pct(m.accuracy, 1)}</p>
        </div>
        <div>
          <p className="etiqueta">Muestras</p>
          <p className="cifra mt-1 text-lg text-white">{num(m.muestras / 1e6, 2)} M</p>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[10px] text-plata-400">
          <span>{id === 'LGBM-Flow-02' ? 'Iteración' : 'Árbol'} {num(progreso)} / {num(total)}</span>
          <span className="cifra">{pct(progreso / total, 0)}</span>
        </div>
        <Barra valor={progreso} max={total} />
      </div>
      <div className="mt-4">
        <p className="etiqueta mb-2">Importancia de Features</p>
        <BarrasH datos={importancias} formato={(v) => pct(v, 1)} />
      </div>
    </Panel>
  );
}
