import { motion } from 'framer-motion';
import { num } from '@/lib/format';

interface Props {
  datos: { etiqueta: string; valor: number; nota?: string }[];
  formato?: (v: number) => string;
  total?: boolean;
}

/** Barras horizontales monocromas, ordenadas, con animación de entrada escalonada. */
export default function BarrasH({ datos, formato = (v) => num(v), total = false }: Props) {
  const max = Math.max(...datos.map((d) => d.valor));
  const suma = datos.reduce((a, d) => a + d.valor, 0);
  return (
    <div className="space-y-3">
      {datos.map((d, i) => (
        <div key={d.etiqueta}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-plata-300">{d.etiqueta}</span>
            <span className="cifra shrink-0 text-white">
              {formato(d.valor)}
              {total && <span className="ml-2 text-plata-500">{num((d.valor / suma) * 100, 1)}%</span>}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `rgba(235,236,240,${0.9 - i * 0.09})` }}
              initial={{ width: 0 }}
              animate={{ width: `${(d.valor / max) * 100}%` }}
              transition={{ duration: 1.1, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          {d.nota && <p className="mt-1 text-[10px] text-plata-500">{d.nota}</p>}
        </div>
      ))}
    </div>
  );
}
