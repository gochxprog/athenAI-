import type { ReactNode } from 'react';

type Variante = 'solida' | 'contorno' | 'tenue' | 'tachada';

const ESTILOS: Record<Variante, string> = {
  solida: 'border-white bg-white text-black',
  contorno: 'border-plata-400 text-plata-200',
  tenue: 'border-borde text-plata-400',
  tachada: 'border-plata-600 text-plata-400 line-through decoration-plata-500',
};

export default function Insignia({ children, variante = 'contorno', className = '' }: { children: ReactNode; variante?: Variante; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.12em] ${ESTILOS[variante]} ${className}`}>
      {children}
    </span>
  );
}

