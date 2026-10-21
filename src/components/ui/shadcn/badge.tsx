// Badge · shadcn/ui. Acentos solo para estados con significado: aprobado (cian), reserva (dorado), rechazo (rojo suave).
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const variantes = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider', {
  variants: {
    variant: {
      default: 'border-zinc-700 bg-zinc-900 text-zinc-300',
      aprobado: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
      reserva: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      rechazo: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
      positivo: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      tenue: 'border-zinc-800 bg-transparent text-zinc-500',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof variantes> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(variantes({ variant }), className)} {...props} />;
}
