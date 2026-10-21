import type { ReactNode } from 'react';
import Panel from './Panel';

/** Pantalla cuyo motor aún no existe: lo dice claro y explica qué mostrará, sin datos inventados. */
export default function SinMotor({ titulo, motor, children }: { titulo: string; motor: string; children: ReactNode }) {
  return (
    <Panel titulo={titulo} cuerpo="space-y-2 p-4">
      <p className="text-sm text-white" data-sin-motor>
        Todavía sin motor: {motor}.
      </p>
      <div className="text-[12px] leading-relaxed text-plata-300">{children}</div>
      <p className="text-[11px] text-plata-500">Aquí no se muestran datos inventados: cuando el motor exista, esta pantalla se llenará con tus datos reales.</p>
    </Panel>
  );
}
