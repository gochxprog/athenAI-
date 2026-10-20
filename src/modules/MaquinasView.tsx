import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Cpu, MemoryStick, MonitorCog, Server } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import { Estado } from '@/components/ui/Punto';
import Insignia from '@/components/ui/Insignia';
import Sparkline from '@/components/charts/Sparkline';
import { MAQUINAS, type Maquina } from '@/data/mock';
import { crearAleatorio, normal } from '@/lib/random';
import { num, usd } from '@/lib/format';

interface Lectura {
  cpu: number;
  ram: number;
  gpu: number | null;
  historial: number[];
}

const limitar = (v: number) => Math.max(1, Math.min(99, v));

/** Telemetría DEMO: cada máquina oscila alrededor de su carga nominal. */
function useTelemetria() {
  const [lecturas, setLecturas] = useState<Record<string, Lectura>>(() => {
    const rand = crearAleatorio(12);
    return Object.fromEntries(
      MAQUINAS.map((m) => [m.id, { cpu: m.cpu, ram: m.ram, gpu: m.gpu, historial: Array.from({ length: 40 }, () => limitar(m.cpu + normal(rand) * (m.estado === 'Standby' ? 2 : 6))) }]),
    );
  });
  useEffect(() => {
    const rand = crearAleatorio(Date.now() % 9999);
    const t = setInterval(() => {
      setLecturas((prev) => {
        const sig: Record<string, Lectura> = {};
        for (const m of MAQUINAS) {
          const p = prev[m.id];
          const amp = m.estado === 'Standby' ? 1.5 : 5;
          const cpu = limitar(p.cpu + (m.cpu - p.cpu) * 0.3 + normal(rand) * amp);
          sig[m.id] = {
            cpu,
            ram: limitar(p.ram + (m.ram - p.ram) * 0.2 + normal(rand) * 0.8),
            gpu: m.gpu === null ? null : limitar((p.gpu ?? m.gpu) + (m.gpu - (p.gpu ?? m.gpu)) * 0.3 + normal(rand) * 4),
            historial: [...p.historial.slice(1), cpu],
          };
        }
        return sig;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);
  return lecturas;
}

export default function MaquinasView() {
  const lecturas = useTelemetria();
  const operativas = MAQUINAS.filter((m) => m.estado === 'Operativa').length;
  const cpuMedia = MAQUINAS.reduce((a, m) => a + lecturas[m.id].cpu, 0) / MAQUINAS.length;

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Máquinas"
        titulo="Infraestructura de cómputo"
        descripcion="Dónde corre cada pieza: el Cerebro entrena en GPU, el Juez valida en su propia máquina aislada y los bots ejecutan cerca del exchange para minimizar latencia."
      >
        <Insignia variante="contorno">
          {operativas}/{MAQUINAS.length} operativas
        </Insignia>
      </Encabezado>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etiqueta="CPU media" valor={`${num(cpuMedia, 0)}%`} />
        <Kpi etiqueta="Procesos" valor={String(MAQUINAS.reduce((a, m) => a + m.procesos, 0))} />
        <Kpi etiqueta="Costo por hora" valor={usd(MAQUINAS.reduce((a, m) => a + m.costoHora, 0), 2)} />
        <Kpi etiqueta="Regiones" valor="eu-central · ap-northeast" pequeño />
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {MAQUINAS.map((m) => (
          <TarjetaMaquina key={m.id} m={m} l={lecturas[m.id]} />
        ))}
      </div>
    </div>
  );
}

function Kpi({ etiqueta, valor, pequeño = false }: { etiqueta: string; valor: string; pequeño?: boolean }) {
  return (
    <div className="panel p-4">
      <p className="etiqueta">{etiqueta}</p>
      <p className={`cifra mt-2 font-light text-white ${pequeño ? 'text-sm' : 'text-2xl'}`}>{valor}</p>
    </div>
  );
}

function Anillo({ valor, etiqueta, icono: Icono }: { valor: number | null; etiqueta: string; icono: typeof Cpu }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[68px] w-[68px]">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
          {valor !== null && (
            <motion.circle cx="32" cy="32" r={r} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - valor / 100) }} transition={{ duration: 1.2, ease: 'easeOut' }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="cifra text-sm text-white">{valor === null ? '—' : `${Math.round(valor)}%`}</span>
        </div>
      </div>
      <span className="mt-1 flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-plata-500">
        <Icono size={10} /> {etiqueta}
      </span>
    </div>
  );
}

function TarjetaMaquina({ m, l }: { m: Maquina; l: Lectura }) {
  return (
    <Panel titulo={m.id} icono={Server} accion={<Estado estado={m.estado === 'Operativa' ? 'activo' : 'espera'} texto={m.estado} />}>
      <p className="text-xs text-plata-300">{m.rol}</p>
      <div className="mt-4 flex justify-around">
        <Anillo valor={l.cpu} etiqueta="CPU" icono={Cpu} />
        <Anillo valor={l.ram} etiqueta="RAM" icono={MemoryStick} />
        <Anillo valor={l.gpu} etiqueta="GPU" icono={MonitorCog} />
      </div>
      <div className="mt-4">
        <p className="etiqueta mb-1">CPU · último minuto</p>
        <Sparkline datos={l.historial} alto={36} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-borde-suave pt-3 text-[10px]">
        <div>
          <p className="uppercase tracking-[0.12em] text-plata-500">Procesos</p>
          <p className="cifra mt-0.5 text-plata-100">{m.procesos}</p>
        </div>
        <div>
          <p className="uppercase tracking-[0.12em] text-plata-500">Costo/h</p>
          <p className="cifra mt-0.5 text-plata-100">{usd(m.costoHora, 3)}</p>
        </div>
        <div>
          <p className="uppercase tracking-[0.12em] text-plata-500">Región</p>
          <p className="cifra mt-0.5 text-plata-100">{m.region}</p>
        </div>
      </div>
    </Panel>
  );
}
