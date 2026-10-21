// Tira de pasos del Laboratorio (estilo de la antigua pantalla), con números REALES de la prueba.
import { motion } from 'framer-motion';
import { BookMarked, Boxes, Cpu, Database, Gauge, ListOrdered, ShieldCheck } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { DEFINICIONES_FEATURES } from '@/motores/nucleo/features';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { num } from '@/lib/format';

export default function TiraPasos({ r, estrategias, papers }: { r: RespuestaLaboratorio; estrategias: number; papers: number }) {
  const j = r.resultado;
  const nota = j.score?.total ?? 0;
  const etapas = [
    { t: 'Datos', d: `${num(r.filas)} barras`, icono: Database },
    { t: 'Componentes', d: `${DEFINICIONES_FEATURES.length} Features`, icono: Boxes },
    { t: 'Cola', d: `${num(estrategias)} estrategias`, icono: ListOrdered },
    { t: 'Motor', d: `${num(j.ensayos)} backtests`, icono: Cpu },
    { t: 'Evaluación', d: j.score ? `${num(nota, 0)}/100` : j.veredicto.toLowerCase(), icono: Gauge, anillo: nota },
    { t: 'Control', d: `${j.reglas.length} reglas bloqueadas`, icono: ShieldCheck },
    { t: 'Libro de estrategias', d: `${num(papers)} registradas`, icono: BookMarked },
  ];
  return (
    <Panel cuerpo="overflow-x-auto px-4 py-5">
      <div className="flex min-w-[880px] items-center" data-tira-pasos>
        {etapas.map((et, i) => {
          const Icono = et.icono;
          return (
            <div key={et.t} className="flex flex-1 items-center">
              <div className="flex w-[104px] shrink-0 flex-col items-center text-center">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-borde bg-white/[0.03]">
                  {et.anillo !== undefined && (
                    <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
                      <circle cx="24" cy="24" r="21" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
                      <motion.circle cx="24" cy="24" r="21" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: Math.max(0, Math.min(1, et.anillo / 100)) }} transition={{ duration: 1.6 }} />
                    </svg>
                  )}
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
