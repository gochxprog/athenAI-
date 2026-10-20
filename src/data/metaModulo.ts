import type { Modulo } from '@/types/nav';

export const META_MODULO: Record<Modulo, { titulo: string; seccion: string }> = {
  panel: { titulo: 'Panel General', seccion: 'Dashboard' },
  laboratorio: { titulo: 'Laboratorio', seccion: 'Cerebro' },
  investigacion: { titulo: 'Investigación', seccion: 'Cerebro' },
  estrategias: { titulo: 'Estrategias', seccion: 'Cerebro' },
  conocimiento: { titulo: 'Conocimiento', seccion: 'Cerebro' },
  agentes: { titulo: 'Agentes', seccion: 'Cerebro' },
  paper: { titulo: 'Paper Trading', seccion: 'Dinero' },
  decisiones: { titulo: 'Decisiones', seccion: 'Dinero' },
  costos: { titulo: 'Costos', seccion: 'Sistema' },
  maquinas: { titulo: 'Máquinas', seccion: 'Sistema' },
  datos: { titulo: 'Datos', seccion: 'Sistema' },
};
