import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Bot, Calculator, CalendarDays, Receipt, Server } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import Barra from '@/components/ui/Barra';
import BarrasH from '@/components/charts/BarrasH';
import { useSistema } from '@/hooks/SistemaDemo';
import { COSTO_POR_AGENTE, COSTOS_MES, DIAS_MES_TRANSCURRIDOS, MAQUINAS, PRESUPUESTO_MES } from '@/data/mock';
import { crearAleatorio, normal } from '@/lib/random';
import { num, pct, usd } from '@/lib/format';

const DIAS_MES = 31;

export default function CostosView() {
  const { ahora, motor } = useSistema();
  // COSTOS_MES cubre los días completos (hasta ayer); hoy se acumula en vivo.
  const diasCompletos = DIAS_MES_TRANSCURRIDOS - 1;
  const cerrado = COSTOS_MES.reduce((a, c) => a + c.monto, 0);
  const mediaDiaria = cerrado / diasCompletos;
  const proyeccion = mediaDiaria * DIAS_MES;
  const costoHora = MAQUINAS.reduce((a, m) => a + m.costoHora, 0) + COSTO_POR_AGENTE.reduce((a, c) => a + c.monto, 0) / (diasCompletos * 24);
  const segundosHoy = ahora.getHours() * 3600 + ahora.getMinutes() * 60 + ahora.getSeconds();
  const hoy = (costoHora / 3600) * segundosHoy;
  const total = cerrado + hoy;

  const diario = useMemo(() => {
    const rand = crearAleatorio(31);
    const crudo = Array.from({ length: diasCompletos }, () => Math.max(40, mediaDiaria + normal(rand) * 14));
    const escala = cerrado / crudo.reduce((a, v) => a + v, 0);
    return crudo.map((v) => v * escala);
  }, [mediaDiaria, cerrado, diasCompletos]);
  const maxDia = Math.max(...diario, mediaDiaria) * 1.1;

  const porCategoria = ['Máquinas', 'Agentes', 'Datos'].map((c) => ({ etiqueta: c, valor: COSTOS_MES.filter((x) => x.categoria === c).reduce((a, x) => a + x.monto, 0) }));

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Costos"
        titulo="Costos de agentes y máquinas"
        descripcion="Cuánto cuesta aprender: cómputo del Cerebro, del Laboratorio y del Juez, inferencia de los agentes y almacenamiento del Order Flow. Las comisiones y el slippage de trading se modelan en el Juez."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="Gasto del mes" valor={usd(total, 2)} nota={`día ${DIAS_MES_TRANSCURRIDOS} de ${DIAS_MES}`} />
        <Kpi etiqueta="Hoy, en curso" valor={usd(hoy, 2)} nota={`${usd(costoHora, 2)} por hora`} />
        <Kpi etiqueta="Proyección de cierre" valor={usd(proyeccion, 0)} nota={`${pct(proyeccion / PRESUPUESTO_MES, 1)} del presupuesto`} />
        <Kpi etiqueta="Costo por hipótesis evaluada" valor={usd(total / (motor.aprobadas + motor.rechazadas), 2)} nota="gasto del mes / hipótesis evaluadas" />
      </div>

      <Panel titulo="Presupuesto mensual" icono={Calculator}>
        <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs">
          <span className="text-plata-300">
            Gastado <span className="cifra text-white">{usd(total, 0)}</span> · proyectado <span className="cifra text-white">{usd(proyeccion, 0)}</span>
          </span>
          <span className="cifra text-plata-400">Presupuesto {usd(PRESUPUESTO_MES, 0)}</span>
        </div>
        <Barra valor={total} max={PRESUPUESTO_MES} alto="h-2" marca={proyeccion} />
        <p className="mt-2 text-[10px] text-plata-500">La marca indica el cierre proyectado al ritmo actual.</p>
      </Panel>

      <Panel titulo="Gasto diario · octubre" icono={CalendarDays} accion={<span className="cifra text-[10px] text-plata-500">media {usd(mediaDiaria, 2)} / día</span>}>
        <div className="relative flex h-44 items-end gap-1.5">
          <span className="absolute inset-x-0 border-t border-dashed border-white/25" style={{ bottom: `${(mediaDiaria / maxDia) * 100}%` }} />
          {diario.map((v, i) => (
            <div key={i} className="group relative flex h-full flex-1 items-end">
              <motion.div className="w-full rounded-t-sm border-t border-white/70 bg-gradient-to-t from-white/[0.04] to-white/30 transition-colors group-hover:to-white/60" initial={{ height: 0 }} animate={{ height: `${(v / maxDia) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.03 }} />
              <span className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-white group-hover:block">{usd(v, 0)}</span>
            </div>
          ))}
          <div className="relative flex h-full flex-1 items-end">
            <motion.div className="w-full animate-latido rounded-t-sm border border-dashed border-plata-300" initial={{ height: 0 }} animate={{ height: `${(Math.max(hoy, 1) / maxDia) * 100}%` }} />
          </div>
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9.5px] text-plata-500">
          <span>01-oct</span>
          <span>{DIAS_MES_TRANSCURRIDOS}-oct · hoy (en curso)</span>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel titulo="Por concepto" icono={Receipt} className="xl:col-span-2">
          <BarrasH datos={[...COSTOS_MES].sort((a, b) => b.monto - a.monto).map((c) => ({ etiqueta: c.concepto, valor: c.monto }))} formato={(v) => usd(v, 2)} total />
        </Panel>
        <div className="space-y-4">
          <Panel titulo="Por categoría" icono={Server}>
            <BarrasH datos={porCategoria} formato={(v) => usd(v, 0)} total />
          </Panel>
          <Panel titulo="Por agente · inferencia" icono={Bot} cuerpo="px-4 py-2">
            <table className="w-full text-xs">
              <tbody>
                {COSTO_POR_AGENTE.map((a) => (
                  <tr key={a.agente} className="border-b border-borde-suave last:border-0">
                    <td className="py-2 text-plata-200">{a.agente}</td>
                    <td className="cifra py-2 text-right text-plata-500">{num(a.horas)} h</td>
                    <td className="cifra py-2 text-right text-white">{usd(a.monto, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Kpi({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota: string }) {
  return (
    <div className="panel p-4">
      <p className="etiqueta">{etiqueta}</p>
      <p className="cifra mt-2 text-xl font-light text-white md:text-2xl">{valor}</p>
      <p className="mt-1 text-[10px] text-plata-500">{nota}</p>
    </div>
  );
}
