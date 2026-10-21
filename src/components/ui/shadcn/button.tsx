// Button · shadcn/ui.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const variantes = cva('inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40', {
  variants: {
    variant: {
      default: 'bg-zinc-100 text-zinc-950 hover:bg-white',
      outline: 'border border-zinc-800 bg-transparent text-zinc-300 hover:border-zinc-600 hover:text-zinc-100',
      ghost: 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
    },
    size: { default: 'h-8 px-3', sm: 'h-7 px-2.5 text-[11px]', icon: 'h-8 w-8' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variantes> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(variantes({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';
