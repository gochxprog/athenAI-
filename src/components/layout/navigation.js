import {
  LayoutDashboard,
  FlaskConical,
  Microscope,
  Workflow,
  BookOpen,
  Users,
  LineChart,
  Landmark,
  Scale,
  Receipt,
  Server,
} from 'lucide-react';

/** Jerarquía fija del menú lateral. `implemented` indica que la vista existe. */
export const NAV_SECTIONS = [
  {
    id: 'general',
    label: 'Panel General',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, implemented: true }],
  },
  {
    id: 'cerebro',
    label: 'Cerebro',
    items: [
      { id: 'laboratorio', label: 'Laboratorio', icon: FlaskConical },
      { id: 'investigacion', label: 'Investigación', icon: Microscope },
      { id: 'estrategias', label: 'Estrategias', icon: Workflow },
      { id: 'conocimiento', label: 'Conocimiento', icon: BookOpen },
      { id: 'agentes', label: 'Sala de Agentes', icon: Users },
    ],
  },
  {
    id: 'dinero',
    label: 'Dinero',
    items: [
      { id: 'paper', label: 'Paper Trading', icon: LineChart },
      { id: 'real', label: 'Cuenta Real', icon: Landmark },
      { id: 'decisiones', label: 'Decisiones', icon: Scale },
    ],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [
      { id: 'costos', label: 'Costos', icon: Receipt },
      { id: 'maquinas', label: 'Máquinas / Infraestructura', icon: Server },
    ],
  },
];
