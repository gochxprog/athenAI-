import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface Props {
  modulo: string;
  titulo: string;
  descripcion: string;
  children?: ReactNode;
}

export default function Encabezado({ modulo, titulo, descripcion, children }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-wrap items-end justify-between gap-4"
    >
      <div className="min-w-0">
        <p className="etiqueta mb-1.5">
          {modulo} · <span className="text-plata-300">DEMO</span>
        </p>
        <h2 className="text-2xl font-light tracking-tight text-white md:text-[28px]">{titulo}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-plata-400">{descripcion}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </motion.div>
  );
}
