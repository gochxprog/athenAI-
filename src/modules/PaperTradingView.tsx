import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Bot as IconoBot, Check, Lock, ShieldAlert, Snowflake, Wallet, X } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import Insignia, { InsigniaVeredicto } from '@/components/ui/Insignia';
import Barra from '@/components/ui/Barra';
import Punto from '@/components/ui/Punto';
import ContadorAnimado from '@/components/ui/ContadorAnimado';
import Sparkline from '@/components/charts/Sparkline';
import { useSistema } from '@/hooks/SistemaDemo';
import { BOTS, CUENTA_PAPER, ESTRATEGIAS, POSICIONES, type Bot } from '@/data/mock';
import { crearAleatorio, normal } from '@/lib/random';
import { conSigno, num, usd } from '@/lib/format';

const DIAS_REQUERIDOS = 60;

export default function PaperTradingView() {
  // Las posiciones de Paper aún son DEMO (BTC): se valoran con el precio del simulador hasta el Bloque E.
  const { mercadoDemo: mercado } = useSistema();
  const pnlAbierto = POSICIONES.reduce((a, p) => a + (mercado.precio - p.entrada) * p.tamaño * (p.lado === 'Long' ? 1 : -1), 0);
  const pnlHoyCerrado = BOTS.reduce((a, b) => a + b.pnlHoy, 0);
  const capital = CUENTA_PAPER.capitalInicial + CUENTA_PAPER.realizadoHistorico + pnlAbierto;

  const curva = useMemo(() => {
    const rand = crearAleatorio(37);
    const bruto = [0];
    for (let i = 1; i <= CUENTA_PAPER.dias; i++) bruto.push(bruto[i - 1] + 86 + normal(rand) * 260);
    const escala = CUENTA_PAPER.realizadoHistorico / bruto[bruto.length - 1];
    return bruto.map((v) => CUENTA_PAPER.capitalInicial + v * escala);
  }, []);

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Paper Trading"
        titulo="Bots y cuenta de simulación"
        descripcion="Los bots ejecutan solo estrategias aprobadas por el Juez, con reglas estáticas y el modelo congelado. Nunca reentrenan ni ajustan nada en vivo. Un monitor estricto los pausa ante cualquier desvío."
      >
        <Insignia variante="tachada">
          <Lock size={10} /> Dinero real
        </Insignia>
        <Insignia variante="contorno">Simulación</Insignia>
      </Encabezado>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Capital paper" valor={<ContadorAnimado valor={capital} decimales={2} />} nota={`Inicial ${usd(CUENTA_PAPER.capitalInicial, 0)}`} />
        <Kpi etiqueta="P&L no realizado" valor={`${conSigno(pnlAbierto, 2)} USD`} nota={`${POSICIONES.length} posiciones abiertas`} />
        <Kpi etiqueta="P&L cerrado hoy" valor={`${conSigno(pnlHoyCerrado, 2)} USD`} nota={`${BOTS.reduce((a, b) => a + b.operacionesHoy, 0)} operaciones`} />
        <Kpi etiqueta="Días en Paper Trading" valor={`${CUENTA_PAPER.dias} / ${DIAS_REQUERIDOS}`} nota="mínimo para solicitar dinero real" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel titulo="Equity de la cuenta paper · 37 días" icono={Activity} accion={<span className="cifra text-[10px] text-plata-500">{conSigno((CUENTA_PAPER.realizadoHistorico / CUENTA_PAPER.capitalInicial) * 100, 2, '%')} realizado</span>}>
          <div className="flex gap-3">
            <div className="flex flex-col justify-between py-1 font-mono text-[9.5px] text-plata-500">
              <span>{usd(Math.max(...curva), 0)}</span>
              <span>{usd(Math.min(...curva), 0)}</span>
            </div>
            <div className="flex-1">
              <Sparkline datos={curva} alto={200} dibujar grosor={1.4} base={CUENTA_PAPER.capitalInicial} />
            </div>
          </div>
          <div className="mt-2 flex justify-between pl-14 font-mono text-[9.5px] text-plata-500">
            <span>Día 1</span>
            <span>Día {CUENTA_PAPER.dias} · hoy</span>
          </div>
        </Panel>
        <CuentaReal />
      </div>

      <Panel titulo="Posiciones abiertas · BTCUSDT" icono={Wallet} cuerpo="overflow-x-auto px-4 py-2">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.14em] text-plata-500">
              {['ID', 'Bot', 'Lado', 'Tamaño', 'Entrada', 'Actual', 'Stop → Objetivo', 'P&L', 'Abierta'].map((h) => (
                <th key={h} className="py-2.5 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {POSICIONES.map((p) => {
              const pnl = (mercado.precio - p.entrada) * p.tamaño * (p.lado === 'Long' ? 1 : -1);
              const lo = Math.min(p.stop, p.objetivo);
              const hi = Math.max(p.stop, p.objetivo);
              const pos = Math.min(1, Math.max(0, (mercado.precio - lo) / (hi - lo)));
              return (
                <tr key={p.id} className="border-t border-borde-suave">
                  <td className="py-3 font-mono text-plata-300">{p.id}</td>
                  <td className="py-3 font-mono text-plata-300">{p.bot}</td>
                  <td className="py-3">
                    <Insignia variante={p.lado === 'Long' ? 'solida' : 'contorno'}>{p.lado === 'Long' ? '+ Long' : '− Short'}</Insignia>
                  </td>
                  <td className="cifra py-3 text-plata-200">{num(p.tamaño, 3)} BTC</td>
                  <td className="cifra py-3 text-plata-200">{num(p.entrada, 1)}</td>
                  <td className="cifra py-3 text-white">{num(mercado.precio, 1)}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <span className="cifra text-[10px] text-plata-500">{num(p.lado === 'Long' ? p.stop : p.objetivo, 0)}</span>
                      <div className="relative h-1 w-24 rounded-full bg-white/[0.08]">
                        <motion.span className="absolute -top-[3px] h-2.5 w-[3px] rounded-full bg-white" animate={{ left: `${pos * 100}%` }} transition={{ duration: 0.5 }} />
                      </div>
                      <span className="cifra text-[10px] text-plata-500">{num(p.lado === 'Long' ? p.objetivo : p.stop, 0)}</span>
                    </div>
                  </td>
                  <td className="cifra py-3 text-white">{conSigno(pnl, 2)} USD</td>
                  <td className="cifra py-3 text-plata-400">{p.abierta.replace('−', 'hace ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white">
          <IconoBot size={13} /> Bots · monitoreo estricto
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          {BOTS.map((b) => (
            <TarjetaBot key={b.id} b={b} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ etiqueta, valor, nota }: { etiqueta: string; valor: React.ReactNode; nota: string }) {
  return (
    <div className="panel p-4">
      <p className="etiqueta">{etiqueta}</p>
      <p className="cifra mt-2 text-xl font-light text-white md:text-2xl">{valor}</p>
      <p className="mt-1 text-[10px] text-plata-500">{nota}</p>
    </div>
  );
}

function TarjetaBot({ b }: { b: Bot }) {
  const e = ESTRATEGIAS.find((x) => x.id === b.estrategia)!;
  const pausado = b.estado === 'Pausado por monitor';
  return (
    <div className={`panel p-4 ${pausado ? 'border-dashed' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-white">
            <span className="font-mono text-plata-500">{b.id}</span> {b.nombre}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-plata-500">
            {e.id} · {e.nombre}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-etiqueta text-plata-200">
          <Punto estado={b.estado === 'Ejecutando' ? 'activo' : pausado ? 'detenido' : 'espera'} />
          {b.estado}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <InsigniaVeredicto valor={e.veredicto} />
        <Insignia variante="tenue">
          <Snowflake size={10} /> Modelo congelado {b.hashModelo}
        </Insignia>
        <Insignia variante="tenue">Reglas estáticas</Insignia>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <p className="etiqueta">P&L hoy</p>
          <p className="cifra mt-1 text-white">{conSigno(b.pnlHoy, 2)}</p>
        </div>
        <div>
          <p className="etiqueta">Operaciones</p>
          <p className="cifra mt-1 text-white">{b.operacionesHoy}</p>
        </div>
        <div>
          <p className="etiqueta">Latencia</p>
          <p className="cifra mt-1 text-white">{b.latenciaMs} ms</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <Monitor etiqueta="Drawdown diario" valor={`${num(b.ddUsado, 1)}% de ${b.ddLimite}%`} actual={b.ddUsado} max={b.ddLimite} />
        <Monitor etiqueta="Slippage real vs esperado" valor={`${num(b.slippageReal, 1)} / ${num(b.slippageEsperado, 1)} tick`} actual={b.slippageReal} max={b.slippageEsperado * 2.5} marca={b.slippageEsperado * 2} />
      </div>

      <p className={`mt-3 flex items-center gap-1.5 text-[11px] ${pausado ? 'text-white' : 'text-plata-500'}`}>
        {pausado && <ShieldAlert size={12} />}
        {b.nota}
      </p>
    </div>
  );
}

function Monitor({ etiqueta, valor, actual, max, marca }: { etiqueta: string; valor: string; actual: number; max: number; marca?: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px]">
        <span className="text-plata-400">{etiqueta}</span>
        <span className="cifra text-plata-200">{valor}</span>
      </div>
      <Barra valor={actual} max={max} marca={marca} tenue={actual / max < 0.6} />
    </div>
  );
}

function CuentaReal() {
  const requisitos = [
    { texto: 'Estrategia aprobada por el Juez (E-087)', ok: true },
    { texto: 'Re-validación semanal superada', ok: true },
    { texto: `60 días de Paper Trading (${CUENTA_PAPER.dias}/60)`, ok: false },
    { texto: 'Drawdown real dentro del rango del backtest', ok: true },
    { texto: 'Slippage real ≤ 2× el modelado en todos los bots', ok: false },
    { texto: 'OK explícito del dueño de la cuenta', ok: false },
  ];
  return (
    <Panel titulo="Cuenta real" icono={Lock} accion={<Insignia variante="tachada">Bloqueada</Insignia>}>
      <p className="text-[12px] leading-relaxed text-plata-300">Nada toca dinero real sin pruebas y sin el OK del dueño. Estado de los requisitos:</p>
      <ul className="mt-3 space-y-2">
        {requisitos.map((r) => (
          <li key={r.texto} className="flex items-start gap-2.5 text-xs">
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${r.ok ? 'bg-white text-black' : 'border border-plata-500 text-plata-400'}`}>
              {r.ok ? <Check size={10} strokeWidth={3} /> : <X size={10} />}
            </span>
            <span className={r.ok ? 'text-plata-200' : 'text-plata-400'}>{r.texto}</span>
          </li>
        ))}
      </ul>
      <button disabled className="mt-4 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-borde px-4 py-2.5 text-xs text-plata-500">
        <Lock size={12} /> Solicitar paso a dinero real · 3 requisitos pendientes
      </button>
    </Panel>
  );
}
