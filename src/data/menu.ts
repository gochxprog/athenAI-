import {
  LayoutDashboard, CandlestickChart, FlaskConical, Microscope, Library, Brain, Bot,
  Wallet, Gavel, Server, Database, type LucideIcon,
} from 'lucide-react';
import type { Modulo } from '@/types/nav';

export interface ItemMenu {
  id: Modulo;
  etiqueta: string;
  icono: LucideIcon;
}

export const MENU: { titulo: string; items: ItemMenu[] }[] = [
  {
    titulo: 'Panel General',
    items: [
      { id: 'panel', etiqueta: 'Panel General', icono: LayoutDashboard },
      { id: 'orderflow', etiqueta: 'Order Flow', icono: CandlestickChart },
    ],
  },
  {
    titulo: 'Cerebro',
    items: [
      { id: 'laboratorio', etiqueta: 'Laboratorio', icono: FlaskConical },
      { id: 'investigacion', etiqueta: 'Investigación', icono: Microscope },
      { id: 'estrategias', etiqueta: 'Estrategias', icono: Library },
      { id: 'conocimiento', etiqueta: 'Conocimiento', icono: Brain },
      { id: 'agentes', etiqueta: 'Agentes', icono: Bot },
    ],
  },
  {
    titulo: 'Dinero',
    items: [
      { id: 'paper', etiqueta: 'Paper Trading', icono: Wallet },
      { id: 'decisiones', etiqueta: 'Decisiones', icono: Gavel },
    ],
  },
  {
    titulo: 'Sistema',
    items: [
      { id: 'maquinas', etiqueta: 'Máquinas', icono: Server },
      { id: 'datos', etiqueta: 'Datos', icono: Database },
    ],
  },
];
