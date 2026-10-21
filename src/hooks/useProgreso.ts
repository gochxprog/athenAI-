import { useEffect, useState } from 'react';

/** Progreso 0 → 1 en `ms`, reiniciable cambiando `clave`. Respeta prefers-reduced-motion. */
export default function useProgreso(ms: number, clave: unknown) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setT(1);
      return;
    }
    let raf = 0;
    const inicio = performance.now();
    setT(0);
    const paso = (ahora: number) => {
      const v = Math.min(1, Math.max(0, (ahora - inicio) / ms));
      setT(v);
      if (v < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [ms, clave]);
  return t;
}
