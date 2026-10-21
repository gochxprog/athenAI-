// Anti-futuro: resultado del análisis del código y de la prueba de causalidad (cortes de la serie).
import { memo } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { Badge } from '@/components/ui/shadcn/badge';
import { Dato, SinDatos } from '../Piezas';
import { numero } from '../tema';

export default memo(function AntiFuturo({ r }: { r: RespuestaLaboratorio }) {
  const a = r.resultado.antiFuturo;
  if (!a) return <SinDatos>No comprobado todavía.</SinDatos>;
  const Icono = a.ok ? ShieldCheck : ShieldAlert;
  const violaciones = a.estatico?.violaciones ?? [];
  const alertas = a.estatico?.alertas ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]" data-anti-futuro>
      <div className={a.ok ? 'flex flex-col items-center justify-center gap-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-6' : 'flex flex-col items-center justify-center gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-6'}>
        <Icono className={a.ok ? 'h-12 w-12 text-cyan-300' : 'h-12 w-12 text-rose-400'} strokeWidth={1.3} />
        <p className={a.ok ? 'font-mono text-lg text-cyan-200' : 'font-mono text-lg text-rose-300'}>{a.ok ? 'CAUSAL' : 'FUGA DE DATOS'}</p>
        <p className="text-center text-[11px] text-zinc-400">{a.ok ? 'La estrategia decide solo con lo que ya pasó.' : 'La estrategia usa datos del futuro: queda rechazada.'}</p>
      </div>
      <div className="space-y-4">
        <p className="text-xs text-zinc-300">{a.detalle}</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Dato k="Cortes probados" v={numero(a.dinamico?.cortes, 0)} />
          <Dato k="Posición alterada" v={a.dinamico ? (a.dinamico.alteracion ? 'sí' : 'no') : '—'} tono={a.dinamico?.alteracion ? 'negativo' : 'aprobado'} />
          <Dato k="Fugas en el código" v={String(violaciones.length)} tono={violaciones.length ? 'negativo' : 'aprobado'} />
          <Dato k="Avisos" v={String(alertas.length)} tono={alertas.length ? 'reserva' : undefined} />
        </div>
        {(violaciones.length > 0 || alertas.length > 0) && (
          <ul className="space-y-1.5 rounded-lg border border-zinc-800 p-3 text-[11px]">
            {violaciones.map((v) => (
              <li key={v} className="flex items-start gap-2 text-rose-300">
                <Badge variant="rechazo">fuga</Badge> {v}
              </li>
            ))}
            {alertas.map((v) => (
              <li key={v} className="flex items-start gap-2 text-amber-200">
                <Badge variant="reserva">aviso</Badge> {v}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
