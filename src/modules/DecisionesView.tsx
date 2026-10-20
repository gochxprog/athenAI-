import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Gavel, Landmark, ShieldAlert } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import { InsigniaVeredicto } from '@/components/ui/Insignia';
import { useSistema } from '@/hooks/SistemaDemo';
import { DECISIONES, type Decision } from '@/data/mock';
import { horaCorta, num } from '@/lib/format';

type Tipo = Decision['tipo'];
const ICONOS: Record<Tipo, typeof Gavel> = { 'Veredicto del Juez': Gavel, 'Ejecución de bot': Bot, Monitor: ShieldAlert, 'Dinero real': Landmark };
const FILTROS: (Tipo | 'Todas')[] = ['Todas', 'Veredicto del Juez', 'Ejecución de bot', 'Monitor', 'Dinero real'];

interface Fila {
  clave: string;
  hora: Date;
  tipo: Tipo;
  ref: string;
  detalle: string;
  resultado: Decision['resultado'];
  enVivo?: boolean;
}

export default function DecisionesView() {
  const { eventos, ahora, motor } = useSistema();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>('Todas');

  const filas = useMemo<Fila[]>(() => {
    // Veredictos que el Juez emite durante la sesión (vienen del registro en vivo).
    const vivos: Fila[] = eventos
      .filter((e) => e.tipo === 'juez' && (e.texto.includes('APROBADA') || e.texto.includes('RECHAZADA')))
      .map((e) => {
        const [, cuerpo] = e.texto.split('Juez: ');
        const [ref, ...resto] = cuerpo.split(' · ');
        const aprobada = e.texto.includes('APROBADA');
        return {
          clave: `v-${e.id}`,
          hora: e.hora,
          tipo: 'Veredicto del Juez' as const,
          ref: ref.replace(/ (APROBADA|RECHAZADA)$/, ''),
          detalle: resto.join(' · '),
          resultado: aprobada ? ('APROBADA' as const) : ('RECHAZADA' as const),
          enVivo: true,
        };
      });
    const base = ahora.getTime();
    const fijas: Fila[] = DECISIONES.map((d, i) => ({ clave: `d-${i}`, hora: new Date(base - d.haceMin * 60_000), tipo: d.tipo, ref: d.ref, detalle: d.detalle, resultado: d.resultado }));
    return [...vivos, ...fijas].sort((a, b) => b.hora.getTime() - a.hora.getTime());
    // La hora base solo se recalcula al llegar eventos nuevos para que la lista no salte cada segundo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventos]);

  const visibles = filas.filter((f) => filtro === 'Todas' || f.tipo === filtro);
  const cuenta = (t: Tipo) => filas.filter((f) => f.tipo === t).length;

  return (
    <div className="space-y-4">
      <Encabezado
        modulo="Decisiones"
        titulo="Bitácora de decisiones"
        descripcion="Todo lo que se decide queda registrado: veredictos del Juez, ejecuciones de los bots, pausas del monitor y solicitudes de dinero real. Incluye los rechazos."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FILTROS.slice(1).map((t) => {
          const Icono = ICONOS[t as Tipo];
          return (
            <div key={t} className="panel p-4">
              <p className="etiqueta flex items-center gap-1.5">
                <Icono size={11} /> {t}
              </p>
              <p className="cifra mt-2 text-2xl font-light text-white">{cuenta(t as Tipo)}</p>
              <p className="mt-1 text-[10px] text-plata-500">
                {t === 'Veredicto del Juez' ? `${num(motor.aprobadas)} aprobadas · ${num(motor.rechazadas)} rechazadas en total` : 'últimas 6 h'}
              </p>
            </div>
          );
        })}
      </div>

      <Panel
        cuerpo="p-0"
        titulo="Registro"
        accion={
          <div className="flex flex-wrap gap-1">
            {FILTROS.map((f) => (
              <button key={f} onClick={() => setFiltro(f)} className={`rounded-md px-2.5 py-1 text-[10px] transition-colors ${filtro === f ? 'bg-white text-black' : 'text-plata-400 hover:bg-white/5 hover:text-white'}`}>
                {f}
              </button>
            ))}
          </div>
        }
      >
        <ol className="relative">
          <AnimatePresence initial={false}>
            {visibles.map((f) => {
              const Icono = ICONOS[f.tipo];
              return (
                <motion.li key={f.clave} layout initial={{ opacity: 0, backgroundColor: 'rgba(255,255,255,0.06)' }} animate={{ opacity: 1, backgroundColor: 'rgba(255,255,255,0)' }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} className="grid grid-cols-[52px_28px_minmax(0,1fr)_auto] items-start gap-3 border-b border-borde-suave px-4 py-3 last:border-0 md:grid-cols-[60px_28px_180px_minmax(0,1fr)_auto]">
                  <time className="cifra pt-0.5 text-[11px] text-plata-500">{horaCorta(f.hora)}</time>
                  <span className="flex h-7 w-7 items-center justify-center rounded-md border border-borde">
                    <Icono size={13} className="text-plata-300" />
                  </span>
                  <div className="hidden md:block">
                    <p className="text-xs text-plata-200">{f.tipo}</p>
                    <p className="font-mono text-[10px] text-plata-500">{f.ref}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] text-plata-500 md:hidden">{f.ref}</p>
                    <p className="text-xs leading-relaxed text-plata-200">{f.detalle}</p>
                    {f.enVivo && <p className="mt-0.5 text-[9.5px] uppercase tracking-[0.14em] text-plata-500">Sesión en curso</p>}
                  </div>
                  <InsigniaVeredicto valor={f.resultado} />
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      </Panel>
    </div>
  );
}
