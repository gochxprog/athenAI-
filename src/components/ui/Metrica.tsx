import type { ReactNode } from 'react';

export default function Metrica({ etiqueta, valor, nota, grande = false }: { etiqueta: string; valor: ReactNode; nota?: ReactNode; grande?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="etiqueta truncate">{etiqueta}</p>
      <p className={`cifra mt-1 truncate text-white ${grande ? 'text-2xl font-light' : 'text-base'}`}>{valor}</p>
      {nota && <p className="mt-0.5 truncate text-[10px] text-plata-500">{nota}</p>}
    </div>
  );
}
