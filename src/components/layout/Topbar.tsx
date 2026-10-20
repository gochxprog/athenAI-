import { useSistema } from '@/hooks/SistemaDemo';
import { fechaLarga, hora } from '@/lib/format';
import Punto from '@/components/ui/Punto';
import Insignia from '@/components/ui/Insignia';

export default function Topbar({ titulo, seccion }: { titulo: string; seccion: string }) {
  const { ahora, mercado } = useSistema();
  const enVivo = mercado.conectado;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-borde-suave bg-black/85 pl-16 pr-4 backdrop-blur-xl md:px-6">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium tracking-[0.08em] text-white">
          QUANT-AGENTIC <span className="text-plata-500">v4.1 PRO</span>
        </p>
        <p className="truncate text-[11px] text-plata-500">
          {seccion} <span className="text-plata-600">/</span> <span className="text-plata-300">{titulo}</span>
        </p>
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        <div className="hidden text-right sm:block">
          <p className="text-[10px] uppercase tracking-etiqueta text-plata-500">{fechaLarga(ahora)}</p>
          <p className="cifra text-sm text-white">{hora(ahora)}</p>
        </div>
        <div className="hidden h-8 w-px bg-borde sm:block" />
        <div className="flex items-center gap-2 rounded-full border border-borde px-3 py-1.5">
          <Punto estado={enVivo ? 'activo' : 'detenido'} />
          <span className="text-[10px] font-medium uppercase tracking-etiqueta text-plata-200">{enVivo ? 'En vivo' : 'Standby'}</span>
        </div>
        <Insignia variante="tenue" className="hidden md:inline-flex">DEMO</Insignia>
      </div>
    </header>
  );
}
