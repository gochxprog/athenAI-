import { BookOpen } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { Explicacion } from '@/components/laboratorio/graficos';

export interface FichaMotor {
  id: string;
  nombre: string;
  que: string;
  sirve: string;
  mirar: string;
  formulas: string[];
}

/** Ficha de un motor: explicación simple, valores en vivo y «Cómo se calcula». */
export default function TarjetaMotor({ m, vivo }: { m: FichaMotor; vivo: [string, string][] }) {
  return (
    <Panel titulo={m.nombre} icono={BookOpen} cuerpo="space-y-3 p-4">
      <Explicacion que={m.que} sirve={m.sirve} mirar={m.mirar} />
      <div className="flex flex-wrap gap-2" data-vivo={m.id}>
        {vivo.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-borde-suave px-2.5 py-1.5">
            <p className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">{k}</p>
            <p className="cifra text-sm text-white">{v}</p>
          </div>
        ))}
      </div>
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {m.formulas.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
    </Panel>
  );
}
