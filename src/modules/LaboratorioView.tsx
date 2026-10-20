import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookMarked, Boxes, Cpu, Database, Dices, Gauge, Gavel, Layers, LineChart, ListOrdered, Lock, ShieldCheck, Shuffle, TreePine, XCircle, type LucideIcon } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import Insignia, { InsigniaVeredicto } from '@/components/ui/Insignia';
import Barra from '@/components/ui/Barra';
import BarrasH from '@/components/charts/BarrasH';
import CurvaEquity from '@/components/charts/CurvaEquity';
import MonteCarloAnimado from '@/components/charts/MonteCarloAnimado';
import WalkForwardAnimado from '@/components/charts/WalkForwardAnimado';
import LuckTestAnimado from '@/components/charts/LuckTestAnimado';
import { useSistema, usePulso } from '@/hooks/SistemaDemo';
import { CAPITAL_BACKTEST, ESTRATEGIAS, FEATURES, MODELOS, RECHAZOS_JUEZ, REGLAS_JUEZ, type Estrategia } from '@/data/mock';
import { simularEstrategia } from '@/lib/backtest';
import { crearAleatorio } from '@/lib/random';
import { num, pct, usd } from '@/lib/format';

type Pestana = 'equity' | 'walk' | 'montecarlo' | 'luck' | 'juez' | 'ml';

const PESTANAS: { id: Pestana; titulo: string; icono: LucideIcon; descripcion: string }[] = [
  { id: 'equity', titulo: 'Curva de equity', icono: LineChart, descripcion: 'Entrenamiento (In-Sample) frente a validación del Juez (Out-of-Sample), con su drawdown.' },
  { id: 'walk', titulo: 'Walk-Forward', icono: Layers, descripcion: 'La estrategia se re-entrena y se valida ventana a ventana sobre datos que nunca vio.' },
  { id: 'montecarlo', titulo: 'Monte Carlo', icono: Dices, descripcion: 'Miles de reordenamientos de las operaciones reales para medir el rango de resultados y el riesgo.' },
  { id: 'luck', titulo: 'Luck test', icono: Shuffle, descripcion: 'Se compara la estrategia con 1.000 versiones aleatorias para descartar que el resultado sea suerte.' },
  { id: 'juez', titulo: 'Juez y rechazos', icono: Gavel, descripcion: 'Reglas bloqueadas, motivos de rechazo acumulados y pruebas en curso.' },
  { id: 'ml', titulo: 'Núcleo ML', icono: Cpu, descripcion: 'Modelos de Machine Learning clásico que proponen hipótesis desde los datos.' },
];

export default function LaboratorioView() {
  const [id, setId] = useState('E-087');
  const [pestana, setPestana] = useState<Pestana>('equity');
  const e = ESTRATEGIAS.find((x) => x.id === id)!;
  const sim = useMemo(() => simularEstrategia(e), [e]);
  const actual = PESTANAS.find((p) => p.id === pestana)!;
  const porEstrategia = pestana === 'equity' || pestana === 'walk' || pestana === 'montecarlo' || pestana === 'luck';

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Laboratorio"
        titulo="Backtest Engine y Juez"
        descripcion="Aquí viven los modelos de Machine Learning clásico y el Juez. Backtest, Walk-Forward, Monte Carlo y el luck test validan: nunca predicen. Las reglas del Juez están bloqueadas y ningún modelo puede modificarlas."
      >
        <Insignia variante="contorno">
          <Lock size={10} /> Reglas del Juez bloqueadas
        </Insignia>
      </Encabezado>

      <Pipeline />

      <Panel cuerpo="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="etiqueta">Estrategia en el Laboratorio</p>
            <p className="mt-1 text-sm text-white">
              {e.id} · {e.nombre}
            </p>
            <p className="text-[11px] text-plata-500">
              Origen {e.origen} · propuesta por {e.modelo} · capital de backtest {usd(CAPITAL_BACKTEST, 0)} · comisión y slippage incluidos
            </p>
          </div>
          <div className="flex items-center gap-3">
            <InsigniaVeredicto valor={e.veredicto} />
            <select
              value={id}
              onChange={(ev) => setId(ev.target.value)}
              className="max-w-[260px] rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100 outline-none focus:border-plata-400"
              aria-label="Estrategia a analizar"
            >
              {ESTRATEGIAS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.id} · {x.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      <MetricasJuez e={e} />

      {/* Cada prueba en su propia pestaña */}
      <div className="sticky top-16 z-20 -mx-1 overflow-x-auto bg-black/80 px-1 py-2 backdrop-blur-xl">
        <div className="flex min-w-max gap-1 rounded-xl border border-borde p-1">
          {PESTANAS.map((p) => {
            const Icono = p.icono;
            const sel = p.id === pestana;
            return (
              <button
                key={p.id}
                onClick={() => setPestana(p.id)}
                className={`relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs transition-colors ${sel ? 'text-black' : 'text-plata-300 hover:text-white'}`}
              >
                {sel && <motion.span layoutId="pestana-lab" className="absolute inset-0 rounded-lg bg-white" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                <Icono size={13} className="relative" />
                <span className="relative">{p.titulo}</span>
              </button>
            );
          })}
        </div>
      </div>

      <motion.div key={pestana} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Panel
          titulo={porEstrategia ? `${actual.titulo} · ${e.id}` : actual.titulo}
          icono={actual.icono}
          accion={<span className="hidden text-[10px] text-plata-500 md:inline">{actual.descripcion}</span>}
        >
          <p className="mb-4 text-[11px] text-plata-500 md:hidden">{actual.descripcion}</p>
          {pestana === 'equity' && <CurvaEquity sim={sim} clave={e.id} />}
          {pestana === 'walk' && <WalkForwardAnimado e={e} />}
          {pestana === 'montecarlo' && <MonteCarloAnimado sim={sim} clave={e.id} />}
          {pestana === 'luck' && <LuckTestAnimado e={e} />}
          {pestana === 'juez' && <JuezYRechazos />}
          {pestana === 'ml' && (
            <div className="grid gap-4 md:grid-cols-2">
              {MODELOS.filter((m) => m.ubicacion === 'Laboratorio').map((m, i) => (
                <ModeloML key={m.id} indice={i} id={m.id} />
              ))}
            </div>
          )}
        </Panel>
      </motion.div>
    </div>
  );
}

function JuezYRechazos() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel titulo="Filtro de rechazo · motivos acumulados" icono={XCircle} accion={<span className="cifra text-[10px] text-plata-500">{num(RECHAZOS_JUEZ.reduce((a, r) => a + r.cantidad, 0))} rechazadas</span>}>
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
      <ColaPruebas />
    </div>
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

function ColaPruebas() {
  const { motor } = useSistema();
  const n = usePulso(900);
  const fases = ['Walk-Forward', 'Monte Carlo', 'Luck test', 'Comisión y slippage'];
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
            const detalle = fase === 'Walk-Forward' ? `ventana ${1 + Math.floor((avance / 100) * 12)}/12` : fase === 'Monte Carlo' ? `${num(Math.floor(avance * 20))}/2.000` : fase === 'Luck test' ? `${num(Math.floor(avance * 10))}/1.000` : 'costos de mercado modelados';
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
