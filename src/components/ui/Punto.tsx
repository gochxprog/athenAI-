/** Estado sin color: relleno pulsante (activo), relleno tenue (espera) o hueco (detenido). */
export type EstadoPunto = 'activo' | 'espera' | 'detenido';

export default function Punto({ estado, className = '' }: { estado: EstadoPunto; className?: string }) {
  const base = 'inline-block h-1.5 w-1.5 shrink-0 rounded-full';
  if (estado === 'activo') return <span className={`${base} animate-latido bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)] ${className}`} />;
  if (estado === 'espera') return <span className={`${base} bg-plata-500 ${className}`} />;
  return <span className={`${base} border border-plata-500 ${className}`} />;
}

export function Estado({ estado, texto }: { estado: EstadoPunto; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-etiqueta text-plata-300">
      <Punto estado={estado} />
      {texto}
    </span>
  );
}
