// Menú de la versión 2 (docs/CROQUIS.md §8). `fase`: en qué fase llega la pantalla; sin fase = ya está.
import { Activity, BookMarked, Bot, Brain, CalendarClock, CalendarDays, CandlestickChart, Database, DollarSign, FlaskConical, LayoutGrid, Server, Shield, Sparkles, Wallet, type LucideIcon } from 'lucide-react';

export type IdPantalla = 'panel' | 'laboratorio' | 'biblioteca' | 'investigacion' | 'red' | 'agentes' | 'paper' | 'real' | 'terminal' | 'mercado' | 'riesgo' | 'diario' | 'datos' | 'calendario' | 'sistema';
export interface Item { id: IdPantalla; nombre: string; icono: LucideIcon; fase?: number }

export const MENU: { seccion: string; items: Item[] }[] = [
  { seccion: 'Panel', items: [{ id: 'panel', nombre: 'Panel', icono: LayoutGrid }] },
  {
    seccion: 'Cerebro',
    items: [
      { id: 'laboratorio', nombre: 'Laboratorio', icono: FlaskConical },
      { id: 'biblioteca', nombre: 'Biblioteca', icono: BookMarked },
      { id: 'investigacion', nombre: 'Investigación', icono: Sparkles, fase: 4 },
      { id: 'red', nombre: 'Red neuronal', icono: Brain, fase: 5 },
      { id: 'agentes', nombre: 'Agentes', icono: Bot },
    ],
  },
  {
    seccion: 'Dinero',
    items: [
      { id: 'paper', nombre: 'Paper', icono: Wallet },
      { id: 'real', nombre: 'Real', icono: DollarSign, fase: 9 },
      { id: 'terminal', nombre: 'Terminal', icono: CandlestickChart },
      { id: 'riesgo', nombre: 'Riesgo', icono: Shield },
      { id: 'diario', nombre: 'Diario', icono: CalendarDays },
    ],
  },
  {
    seccion: 'Sistema',
    items: [
      { id: 'datos', nombre: 'Datos', icono: Database },
      { id: 'calendario', nombre: 'Calendario', icono: CalendarClock },
      { id: 'sistema', nombre: 'Sistema', icono: Server },
    ],
  },
];

export const TODAS = MENU.flatMap((s) => s.items);
/** Las 4 de la barra de abajo en el celular (la 5.ª es «Más»). */
export const MOVIL: IdPantalla[] = ['panel', 'terminal', 'laboratorio', 'paper'];
export const nota = (it: Item) => (it.fase === 9 ? 'cuando conectes un broker' : it.fase ? `llega en la fase ${it.fase}` : '');
export const ICONO_MAS = Activity;
