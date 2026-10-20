import { useId } from 'react';
import { motion } from 'framer-motion';

interface Props {
  datos: number[];
  alto?: number;
  area?: boolean;
  grosor?: number;
  dibujar?: boolean;
  className?: string;
  marcas?: number[]; // índices a resaltar con un punto
  base?: number; // línea de referencia horizontal
}

/** Línea ultrafina blanca con relleno gris sutil. SVG escalable sin ejes. */
export default function Sparkline({ datos, alto = 40, area = true, grosor = 1, dibujar = false, className = '', marcas = [], base }: Props) {
  const id = useId();
  if (datos.length < 2) return <div style={{ height: alto }} className={className} />;
  const W = 100;
  const min = Math.min(...datos, base ?? Infinity);
  const max = Math.max(...datos, base ?? -Infinity);
  const r = max - min || 1;
  const x = (i: number) => (i / (datos.length - 1)) * W;
  const y = (v: number) => alto - 2 - ((v - min) / r) * (alto - 4);
  const d = datos.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');

  return (
    <svg viewBox={`0 0 ${W} ${alto}`} preserveAspectRatio="none" className={`w-full ${className}`} style={{ height: alto }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {base !== undefined && <line x1="0" x2={W} y1={y(base)} y2={y(base)} stroke="rgba(255,255,255,0.18)" strokeDasharray="1.5 2" vectorEffect="non-scaling-stroke" />}
      {area && <path d={`${d}L${W},${alto}L0,${alto}Z`} fill={`url(#${id})`} />}
      <motion.path
        d={d}
        fill="none"
        stroke="#fff"
        strokeOpacity={0.85}
        strokeWidth={grosor}
        vectorEffect="non-scaling-stroke"
        initial={dibujar ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: 'easeInOut' }}
      />
      {marcas.map((i) => (
        <circle key={i} cx={x(i)} cy={y(datos[i])} r={1.4} fill="#fff" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
