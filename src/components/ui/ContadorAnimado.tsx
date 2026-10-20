import { useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { num } from '@/lib/format';

/** Cuenta desde 0 al montar y luego interpola suavemente a cada nuevo valor. */
export default function ContadorAnimado({ valor, decimales = 0, className = '' }: { valor: number; decimales?: number; className?: string }) {
  const mv = useMotionValue(0);
  const texto = useTransform(mv, (v) => num(v, decimales));

  useEffect(() => {
    const ctrl = animate(mv, valor, { duration: mv.get() === 0 ? 1.8 : 0.8, ease: [0.16, 1, 0.3, 1] });
    return () => ctrl.stop();
  }, [valor, mv]);

  return <motion.span className={`cifra ${className}`}>{texto}</motion.span>;
}
