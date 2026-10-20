import { AnimatePresence, motion } from 'framer-motion';
import { hora } from '@/lib/format';

export interface LineaConsola {
  id: number | string;
  hora: Date;
  etiqueta?: string;
  texto: string;
}

/** Lista de eventos con marca de tiempo; las nuevas líneas entran por arriba. */
export default function Consola({ lineas, alto = 'h-56', vacio = 'Sin eventos' }: { lineas: LineaConsola[]; alto?: string; vacio?: string }) {
  return (
    <div className={`${alto} overflow-y-auto pr-1 font-mono text-[11.5px] leading-relaxed`} role="log" aria-live="polite">
      {lineas.length === 0 && <p className="text-plata-500">{vacio}</p>}
      <AnimatePresence initial={false}>
        {lineas.map((l, i) => (
          <motion.div
            key={l.id}
            layout="position"
            initial={{ opacity: 0, y: -8, backgroundColor: 'rgba(255,255,255,0.07)' }}
            animate={{ opacity: 1, y: 0, backgroundColor: 'rgba(255,255,255,0)' }}
            transition={{ duration: 0.6 }}
            className="flex gap-3 rounded border-b border-white/[0.03] px-1 py-1.5 last:border-0"
            style={{ opacity: Math.max(0.45, 1 - i * 0.03) }}
          >
            <time className="shrink-0 text-plata-500">{hora(l.hora)}</time>
            {l.etiqueta && <span className="w-14 shrink-0 text-[9.5px] uppercase tracking-[0.12em] text-plata-500">{l.etiqueta}</span>}
            <span className="min-w-0 text-plata-200">{l.texto}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
