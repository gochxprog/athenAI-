import { motion } from 'framer-motion';

/** Barra de progreso fina en plata. */
export default function Barra({ valor, max = 100, alto = 'h-1', tenue = false, marca }: { valor: number; max?: number; alto?: string; tenue?: boolean; marca?: number }) {
  const ancho = Math.max(0, Math.min(100, (valor / max) * 100));
  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-white/[0.06] ${alto}`}>
      <motion.div
        className={`h-full rounded-full ${tenue ? 'bg-plata-500' : 'bg-plata-200'}`}
        initial={{ width: 0 }}
        animate={{ width: `${ancho}%` }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
      {marca !== undefined && <span className="absolute inset-y-0 w-px bg-white" style={{ left: `${(marca / max) * 100}%` }} />}
    </div>
  );
}
