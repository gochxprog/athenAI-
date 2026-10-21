// Fases del pipeline del Juez con su estado real: Datos → Generación → Grid → Robustez → El Juez → Control.
import { memo } from 'react';
import { motion } from 'framer-motion';
import { Database, Gavel, Grid3x3, ShieldCheck, Sparkles, Waves } from 'lucide-react';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { MIN_BARRAS_OOS } from '@/motores/juez/juez';
import { cn } from '@/lib/utils';
import { numero } from './tema';

type Estado = 'ok' | 'aviso' | 'falla';
const TONO: Record<Estado, string> = {
  ok: 'border-cyan-500/40 text-cyan-300',
  aviso: 'border-amber-500/40 text-amber-300',
  falla: 'border-rose-500/40 text-rose-400',
};
const PUNTO: Record<Estado, string> = { ok: 'bg-cyan-400', aviso: 'bg-amber-400', falla: 'bg-rose-400' };

export default memo(function Stepper({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const barrasOos = r.filas - j.inicioOos;
  const fases: { t: string; d: string; e: Estado; icono: typeof Database }[] = [
    { t: 'Datos', d: `${numero(r.filas, 0)} barras`, e: barrasOos >= MIN_BARRAS_OOS ? 'ok' : 'falla', icono: Database },
    { t: 'Generación', d: `${r.combos.length} ${r.combos.length === 1 ? 'variante' : 'variantes'}`, e: r.combos.length > 0 ? 'ok' : 'falla', icono: Sparkles },
    { t: 'Grid', d: `${j.tramos.length} ventanas WF`, e: j.wfo.clase === null ? 'aviso' : j.wfo.wfe !== null && j.wfo.wfe > 0 ? 'ok' : 'falla', icono: Grid3x3 },
    { t: 'Robustez', d: j.robustez.estado, e: j.robustez.estado === 'aprobado' ? 'ok' : j.robustez.estado === 'alerta' ? 'aviso' : 'falla', icono: Waves },
    { t: 'El Juez', d: j.score ? `${numero(j.score.total, 0)}/100` : j.veredicto.toLowerCase(), e: j.veredicto === 'APROBADA' ? 'ok' : j.veredicto === 'APROBADA CON RESERVA' ? 'aviso' : 'falla', icono: Gavel },
    { t: 'Control', d: j.antiFuturo?.ok === false ? 'fuga de datos' : `${j.reglas.length} reglas · causal`, e: j.antiFuturo?.ok === false ? 'falla' : 'ok', icono: ShieldCheck },
  ];
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-4" data-stepper>
      <ol className="flex min-w-[720px] items-center">
        {fases.map((f, i) => {
          const Icono = f.icono;
          return (
            <li key={f.t} className="flex flex-1 items-center last:flex-none">
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="flex items-center gap-3" data-fase={f.t} data-estado={f.e}>
                <span className={cn('relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-zinc-900', TONO[f.e])}>
                  <Icono className="h-4 w-4" strokeWidth={1.5} />
                  <span className={cn('absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-zinc-950', PUNTO[f.e])} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                    {i + 1}. {f.t}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-zinc-200">{f.d}</span>
                </span>
              </motion.div>
              {i < fases.length - 1 && <span className="mx-3 h-px flex-1 bg-gradient-to-r from-zinc-700 to-zinc-800" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
});
