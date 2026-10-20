import { Fragment, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Library } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import Insignia, { InsigniaVeredicto } from '@/components/ui/Insignia';
import Sparkline from '@/components/charts/Sparkline';
import { useSistema } from '@/hooks/SistemaDemo';
import { BOTS, CAPITAL_BACKTEST, ESTRATEGIAS, type Estrategia, type Veredicto } from '@/data/mock';
import { serieEquity } from '@/lib/random';
import { num, pct, usd } from '@/lib/format';

const FILTROS: (Veredicto | 'Todas')[] = ['Todas', 'Aprobada', 'En evaluación', 'Rechazada'];

export default function EstrategiasView() {
  const { motor } = useSistema();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>('Todas');
  const [abierta, setAbierta] = useState<string | null>('E-087');
  const lista = ESTRATEGIAS.filter((e) => filtro === 'Todas' || e.veredicto === filtro);
  const cuenta = (v: Veredicto) => ESTRATEGIAS.filter((e) => e.veredicto === v).length;

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Estrategias"
        titulo="Biblioteca de estrategias"
        descripcion="Cada estrategia que los modelos propusieron y pasó por el Laboratorio, con el veredicto del Juez. Se guardan todas, también las fallidas: cada prueba queda registrada, incluso las muertas."
      >
        <Insignia variante="solida">{num(motor.aprobadas)} aprobadas</Insignia>
        <Insignia variante="tachada">{num(motor.rechazadas)} rechazadas</Insignia>
        <Insignia variante="tenue">histórico</Insignia>
      </Encabezado>

      <Panel
        titulo={`Últimas ${ESTRATEGIAS.length} evaluaciones`}
        icono={Library}
        cuerpo="overflow-x-auto p-0"
        accion={
          <div className="flex flex-wrap gap-1">
            {FILTROS.map((f) => (
              <button key={f} onClick={() => setFiltro(f)} className={`rounded-md px-2.5 py-1 text-[10px] transition-colors ${filtro === f ? 'bg-white text-black' : 'text-plata-400 hover:bg-white/5 hover:text-white'}`}>
                {f === 'Todas' ? `Todas · ${ESTRATEGIAS.length}` : `${f} · ${cuenta(f)}`}
              </button>
            ))}
          </div>
        }
      >
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
              {['', 'ID', 'Estrategia', 'Modelo', 'Win Rate', 'PF', 'Expectancy', 'Max DD', 'Sharpe', 'PBO', 'Operaciones', 'Veredicto'].map((h, i) => (
                <th key={i} className="px-3 py-3 font-normal first:pl-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lista.map((e) => (
              <Fragment key={e.id}>
                <tr onClick={() => setAbierta(abierta === e.id ? null : e.id)} className={`cursor-pointer border-t border-borde-suave transition-colors hover:bg-white/[0.02] ${e.veredicto === 'Rechazada' ? 'text-plata-400' : 'text-plata-100'}`}>
                  <td className="py-3 pl-4 pr-1">
                    <ChevronDown size={13} className={`text-plata-500 transition-transform ${abierta === e.id ? 'rotate-180' : ''}`} />
                  </td>
                  <td className="px-3 py-3 font-mono">{e.id}</td>
                  <td className="px-3 py-3">
                    <p>{e.nombre}</p>
                    <p className="font-mono text-[10px] text-plata-500">{e.origen} · {e.fecha}</p>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px]">{e.modelo}</td>
                  <td className="cifra px-3 py-3">{pct(e.winRate, 1)}</td>
                  <td className="cifra px-3 py-3">{num(e.profitFactor, 2)}</td>
                  <td className="cifra px-3 py-3">{usd(e.expectancy, 1)}</td>
                  <td className="cifra px-3 py-3">{usd(e.maxDD, 0)}</td>
                  <td className="cifra px-3 py-3">{num(e.sharpe, 2)}</td>
                  <td className="cifra px-3 py-3">{e.overfitting}%</td>
                  <td className="cifra px-3 py-3">{num(e.trades)}</td>
                  <td className="px-3 py-3">
                    <InsigniaVeredicto valor={e.veredicto} />
                  </td>
                </tr>
                  {abierta === e.id && (
                    <tr>
                      <td colSpan={12} className="p-0">
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <Detalle e={e} />
                        </motion.div>
                      </td>
                    </tr>
                  )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Detalle({ e }: { e: Estrategia }) {
  const curva = useMemo(() => {
    const deriva = e.expectancy / CAPITAL_BACKTEST;
    return serieEquity(e.semilla, Math.min(e.trades, 260), CAPITAL_BACKTEST, deriva, 0.0045);
  }, [e]);
  const bots = BOTS.filter((b) => b.estrategia === e.id);
  return (
    <div className="grid gap-4 border-t border-borde-suave bg-white/[0.015] px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div>
        <p className="etiqueta mb-2">Equity Out-of-Sample · {num(curva.length)} operaciones</p>
        <Sparkline datos={curva} alto={90} base={CAPITAL_BACKTEST} dibujar />
      </div>
      <div className="space-y-3 text-xs">
        <div>
          <p className="etiqueta">Veredicto del Juez</p>
          <p className="mt-1 text-plata-100">
            {e.veredicto === 'Aprobada' && `Aprobada: cumple todas las reglas · luck test p = ${num(e.pValor, 3)} · Sortino ${num(e.sortino, 2)}`}
            {e.veredicto === 'Rechazada' && `Rechazada: ${e.motivo}`}
            {e.veredicto === 'En evaluación' && `En evaluación: Walk-Forward y Monte Carlo en curso · p provisional ${num(e.pValor, 3)}`}
          </p>
        </div>
        <div>
          <p className="etiqueta">Ejecución</p>
          <p className="mt-1 text-plata-300">
            {bots.length ? bots.map((b) => `${b.id} ${b.nombre} (${b.estado.toLowerCase()})`).join(' · ') : e.veredicto === 'Aprobada' ? 'Sin bot asignado' : 'Ningún bot puede ejecutarla'}
          </p>
        </div>
      </div>
    </div>
  );
}
