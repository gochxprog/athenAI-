// Terminal: la mesa de operaciones en Paper. Arriba la cuenta y la cinta; «Operar» = gráfico de Order Flow con las
// operaciones encima, ticket a mano, posiciones y libro; «Diario» = calendario estilo ATAS y métricas;
// «Bots» = los bots, crear uno nuevo y el Guardián.
// Reemplaza la antigua pantalla de Paper Trading: todo lo que hacía sigue aquí.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Bot as IconoBot, CalendarDays, CandlestickChart, Crosshair, Layers } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import { Explicacion } from '@/components/laboratorio/graficos';
import OrderFlowChart, { useEstadoMotor } from '@/components/orderflow/OrderFlowChart';
import type { MarcasGrafico } from '@/components/orderflow/LienzoOrderFlow';
import BarraCuenta from '@/components/terminal/BarraCuenta';
import Cinta from '@/components/terminal/Cinta';
import Ticket from '@/components/terminal/Ticket';
import Posiciones from '@/components/terminal/Posiciones';
import LibroOperaciones from '@/components/terminal/LibroOperaciones';
import PanelGuardian from '@/components/terminal/PanelGuardian';
import Diario from '@/components/terminal/Diario';
import { NuevoBot, TarjetaBot } from '@/components/terminal/Bots';
import { ahoraSuscribir, useMotorPaper, useOperaciones } from '@/components/terminal/comun';
import { tieneObjetivo } from '@/motores/paper/manual';

type Pestana = 'operar' | 'diario' | 'bots';
const PESTANAS: { id: Pestana; titulo: string; icono: typeof Layers }[] = [
  { id: 'operar', titulo: 'Operar', icono: Crosshair },
  { id: 'diario', titulo: 'Diario', icono: CalendarDays },
  { id: 'bots', titulo: 'Bots', icono: IconoBot },
];

export default function TerminalView() {
  const motor = useMotorPaper();
  const ahora = useSyncExternalStore(ahoraSuscribir, () => Math.floor(Date.now() / 1_000)) * 1_000;
  const totalOps = motor.bots.reduce((s, b) => s + b.operaciones, 0);
  const ops = useOperaciones(totalOps);
  const { estado } = useEstadoMotor();
  const [pestana, setPestana] = useState<Pestana>('operar');
  const nombre = (id: string) => {
    const b = motor.bots.find((x) => x.id === id);
    return b?.origen === 'manual' ? 'Tú' : b?.nombre ?? '—';
  };

  // Lo que se dibuja sobre el gráfico del mercado visible: entradas/salidas recientes y stop/objetivo de lo abierto.
  const simbolo = estado?.simbolo;
  const marcas = useMemo((): MarcasGrafico | null => {
    if (!simbolo) return null;
    const delMercado = motor.bots.filter((b) => b.simbolo === simbolo);
    const recientes = ops.filter((o) => o.simbolo === simbolo).slice(-40);
    return {
      simbolo,
      ops: [
        ...recientes.flatMap((o) => [
          { t: o.entradaT, p: o.precioEntrada, lado: o.lado, entrada: true },
          { t: o.salidaT, p: o.precioSalida, lado: o.lado, entrada: false },
        ]),
        ...delMercado.filter((b) => b.posicion).map((b) => ({ t: b.posicion!.t, p: b.posicion!.precioEntrada, lado: b.posicion!.lado, entrada: true })),
      ],
      abiertas: delMercado
        .filter((b) => b.posicion)
        .map((b) => {
          const g = b.gestion?.posicion;
          return { t0: b.posicion!.t, entrada: b.posicion!.precioEntrada, stop: g ? g.stop : null, objetivo: g && tieneObjetivo(g.objetivo) ? g.objetivo : null, lado: b.posicion!.lado, quien: b.origen === 'manual' ? 'TÚ' : b.nombre.toUpperCase().slice(0, 14) };
        }),
    };
  }, [simbolo, motor.bots, ops]);

  return (
    <div className="space-y-4">
      <Encabezado modulo="Terminal" titulo="Mesa de operaciones" fuente="PAPER · SIN DINERO REAL" descripcion="Tus bots y tú operando sobre el mercado en vivo, sin dinero real: con comisión, deslizamiento y funding, y el Guardián vigilando. Cada operación queda en el libro con su stop, su objetivo y su resultado en R." />
      <BarraCuenta ops={ops} ahora={ahora} />
      <Cinta />

      <div className="flex w-fit gap-1 rounded-xl border border-borde p-1" role="tablist" aria-label="Terminal">
        {PESTANAS.map((p) => {
          const Icono = p.icono;
          const sel = p.id === pestana;
          return (
            <button key={p.id} role="tab" aria-selected={sel} data-pestana-terminal={p.id} onClick={() => setPestana(p.id)} className={`relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs transition-colors ${sel ? 'text-black' : 'text-plata-300 hover:text-white'}`}>
              {sel && <motion.span layoutId="pestana-terminal" className="absolute inset-0 rounded-lg bg-white" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              <Icono size={13} className="relative" />
              <span className="relative">{p.titulo}</span>
            </button>
          );
        })}
      </div>

      <motion.div key={pestana} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-4">
        {pestana === 'operar' ? (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="min-w-0 overflow-hidden rounded-xl border border-borde-suave bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.04),transparent_60%)]" data-grafico-terminal>
                <div className="h-auto lg:h-[700px]">
                  <OrderFlowChart estado={estado} marcas={marcas} />
                </div>
              </div>
              <Panel titulo="Ticket" icono={CandlestickChart} cuerpo="p-4">
                <Ticket />
              </Panel>
            </div>
            <Panel titulo="Posiciones abiertas" cuerpo="px-4 py-2">
              <Posiciones />
            </Panel>
            <LibroOperaciones ops={ops} nombre={nombre} />
          </>
        ) : pestana === 'diario' ? (
          <Diario ops={ops} />
        ) : (
          <>
            <Explicacion
              que="cada bot es una estrategia que el Juez aprobó, operando sola sobre el precio real (compra al precio de venta del libro, vende al de compra) sin dinero real. Paga comisión, deslizamiento y funding como en la realidad."
              sirve="ver si la estrategia hace en vivo lo que prometió en la prueba. Si se sale de lo esperado, el Guardián la frena antes de pensar en dinero real."
              mirar="que el capital suba con el tiempo y que «¿Se comporta como dijo el Juez?» diga «dentro de lo esperado». Los bots necesitan semanas y muchas operaciones para concluir algo."
            />
            <NuevoBot />
            {motor.bots.length ? <div className="grid gap-4 xl:grid-cols-2">{motor.bots.map((b) => <TarjetaBot key={b.id} b={b} />)}</div> : null}
            <PanelGuardian />
          </>
        )}
      </motion.div>
    </div>
  );
}
