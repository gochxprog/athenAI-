// Piezas del panel del Juez: tarjeta de métrica, tooltip de gráficos y bloque «Explicación simple / Cómo se calcula».
import { memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, Info, MinusCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/shadcn/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/shadcn/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/shadcn/tooltip';
import type { TextoMotor } from './textos';

export type Estado = 'ok' | 'falla' | 'neutro';
const ICONO = { ok: CheckCircle2, falla: XCircle, neutro: MinusCircle };

export const TarjetaMetrica = memo(function TarjetaMetrica({ titulo, valor, detalle, estado, ayuda, indice = 0 }: { titulo: string; valor: string; detalle?: string; estado: Estado; ayuda?: string; indice?: number }) {
  const Icono = ICONO[estado];
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: indice * 0.035, duration: 0.25 }}>
      <Card className="h-full px-4 py-3" data-metrica={titulo}>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">{titulo}</p>
          {ayuda ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Icono className={cn('h-3.5 w-3.5 shrink-0', estado === 'ok' ? 'text-cyan-400' : estado === 'falla' ? 'text-rose-400' : 'text-zinc-600')} />
              </TooltipTrigger>
              <TooltipContent>{ayuda}</TooltipContent>
            </Tooltip>
          ) : (
            <Icono className={cn('h-3.5 w-3.5 shrink-0', estado === 'ok' ? 'text-cyan-400' : estado === 'falla' ? 'text-rose-400' : 'text-zinc-600')} />
          )}
        </div>
        <p className="mt-2 font-mono text-xl tabular-nums text-zinc-50">{valor}</p>
        {detalle && <p className="mt-1 font-mono text-[10px] text-zinc-500">{detalle}</p>}
      </Card>
    </motion.div>
  );
});

/** Tooltip de Recharts con el estilo del panel. */
export function CajaTooltip({ titulo, filas }: { titulo?: string; filas: { k: string; v: string; color?: string }[] }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/95 px-3 py-2 text-[11px] shadow-xl backdrop-blur">
      {titulo && <p className="mb-1 font-mono text-[10px] text-zinc-500">{titulo}</p>}
      {filas.map((f) => (
        <p key={f.k} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-zinc-400">
            {f.color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: f.color }} />}
            {f.k}
          </span>
          <span className="font-mono tabular-nums text-zinc-100">{f.v}</span>
        </p>
      ))}
    </div>
  );
}

/** Dato pequeño en fila (debajo de los gráficos). */
export function Dato({ k, v, tono }: { k: string; v: ReactNode; tono?: 'positivo' | 'negativo' | 'aprobado' | 'reserva' }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-[0.14em] text-zinc-500">{k}</p>
      <p className={cn('mt-1 font-mono text-sm tabular-nums', tono === 'positivo' ? 'text-emerald-400' : tono === 'negativo' ? 'text-rose-400' : tono === 'aprobado' ? 'text-cyan-300' : tono === 'reserva' ? 'text-amber-300' : 'text-zinc-100')}>{v}</p>
    </div>
  );
}

/** «Explicación simple» y «Cómo se calcula» de cada motor, plegado. */
export function InfoMotor({ t }: { t: TextoMotor }) {
  return (
    <Collapsible className="rounded-lg border border-zinc-800/80 bg-zinc-900/30" data-info-motor>
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-xs text-zinc-400 hover:text-zinc-100">
        <span className="flex items-center gap-2"><Info className="h-3.5 w-3.5" /> Explicación simple y cómo se calcula</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-4 border-t border-zinc-800/80 px-4 py-3 text-[12px] leading-relaxed text-zinc-300 md:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Explicación simple</p>
          <p><span className="text-zinc-100">Qué es:</span> {t.que}</p>
          <p><span className="text-zinc-100">Para qué te sirve:</span> {t.sirve}</p>
          <p><span className="text-zinc-100">Qué mirar:</span> {t.mirar}</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Cómo se calcula</p>
          <ul className="list-disc space-y-1 pl-4 text-zinc-400">
            {t.calculo.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Mensaje cuando el motor no tiene datos suficientes (sin inventar nada). */
export function SinDatos({ children }: { children: ReactNode }) {
  return <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-xs text-zinc-500">{children}</div>;
}
