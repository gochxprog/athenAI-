import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  titulo?: ReactNode;
  icono?: LucideIcon;
  accion?: ReactNode;
  conector?: 'izq' | 'der';
  className?: string;
  cuerpo?: string;
  children: ReactNode;
}

/** Superficie base: vidrio en escala de grises con borde ultrafino. */
export default function Panel({ titulo, icono: Icono, accion, conector, className = '', cuerpo = 'p-4', children }: Props) {
  return (
    <section className={`panel ${className}`}>
      {(titulo || accion) && (
        <header className="flex items-center justify-between gap-3 border-b border-borde-suave px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {Icono && <Icono size={14} strokeWidth={1.6} className="shrink-0 text-plata-400" />}
            <h3 className="etiqueta truncate">{titulo}</h3>
          </div>
          {accion}
        </header>
      )}
      <div className={cuerpo}>{children}</div>
      {conector && (
        <span
          aria-hidden
          className={`absolute top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full border border-plata-300 bg-black shadow-[0_0_8px_rgba(255,255,255,0.5)] xl:block ${
            conector === 'der' ? '-right-[5px]' : '-left-[5px]'
          }`}
        />
      )}
    </section>
  );
}
