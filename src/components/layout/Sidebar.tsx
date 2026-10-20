import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, Menu, X } from 'lucide-react';
import { MENU } from '@/data/menu';
import { AGENTES } from '@/data/mock';
import { useFeeds } from '@/components/orderflow/OrderFlowChart';
import { leerEstrategias } from '@/components/laboratorio/plantillas';
import Punto, { type EstadoPunto } from '@/components/ui/Punto';
import type { Modulo } from '@/types/nav';

interface Props {
  activo: Modulo;
  onSeleccion: (m: Modulo) => void;
}

export default function Sidebar({ activo, onSeleccion }: Props) {
  const [abierta, setAbierta] = useState(false);
  const { feeds } = useFeeds();
  const vivos = feeds.feeds.some((f) => f.conexion === 'en-vivo');
  const grabando = feeds.feeds.some((f) => f.guardando && f.conexion === 'en-vivo');
  const estrategias = leerEstrategias();

  // Números y puntos reales; las pantallas que aún son DEMO quedan en espera y sin número.
  const info: Partial<Record<Modulo, { n?: number; e: EstadoPunto }>> = {
    panel: { e: vivos ? 'activo' : 'detenido' },
    orderflow: { e: vivos ? 'activo' : 'detenido' },
    laboratorio: { n: estrategias.filter((x) => x.ultimoVeredicto).length, e: 'activo' },
    investigacion: { e: 'espera' },
    estrategias: { n: estrategias.length, e: 'espera' },
    conocimiento: { e: 'espera' },
    agentes: { n: AGENTES.filter((a) => a.real).length, e: vivos ? 'activo' : 'espera' },
    paper: { e: 'espera' },
    decisiones: { e: 'espera' },
    maquinas: { e: 'espera' },
    datos: { e: grabando ? 'activo' : vivos ? 'espera' : 'detenido' },
  };

  const contenido = (
    <>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-borde-suave px-5">
        <Logo />
        <div className="leading-tight">
          <p className="text-sm font-medium tracking-wide text-white">AthenAI</p>
          <p className="text-[9px] uppercase tracking-[0.22em] text-plata-500">Quant Agentic</p>
        </div>
        <button onClick={() => setAbierta(false)} className="ml-auto rounded-md p-1.5 text-plata-400 hover:bg-white/5 hover:text-white md:hidden" aria-label="Cerrar menú">
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Navegación principal">
        {MENU.map((sec) => (
          <div key={sec.titulo} className="mb-6 last:mb-0">
            <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-plata-600">{sec.titulo}</p>
            <ul className="space-y-0.5">
              {sec.items.map((it) => {
                const sel = activo === it.id;
                const d = info[it.id];
                const Icono = it.icono;
                return (
                  <li key={it.id}>
                    <button
                      onClick={() => {
                        onSeleccion(it.id);
                        setAbierta(false);
                      }}
                      aria-current={sel ? 'page' : undefined}
                      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                        sel ? 'text-white' : 'text-plata-400 hover:bg-white/[0.03] hover:text-plata-100'
                      }`}
                    >
                      {sel && (
                        <motion.span
                          layoutId="menu-activo"
                          className="absolute inset-0 rounded-lg border border-borde-fuerte bg-white/[0.06]"
                          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                        />
                      )}
                      <Icono size={16} strokeWidth={1.5} className={`relative ${sel ? 'text-white' : 'text-plata-500 group-hover:text-plata-300'}`} />
                      <span className="relative flex-1 text-left">{it.etiqueta}</span>
                      {d?.n !== undefined && <span className="cifra relative text-[10px] text-plata-500">{d.n}</span>}
                      {d && <Punto estado={d.e} className="relative" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-borde-suave p-3">
        <div className="flex items-center gap-2 rounded-lg border border-borde-suave px-3 py-2.5">
          <Lock size={12} className="text-plata-400" />
          <span className="text-[10px] leading-tight text-plata-400">
            Modo DEMO · dinero real <span className="text-plata-200">bloqueado</span>
          </span>
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        onClick={() => setAbierta(true)}
        className="fixed left-3 top-3 z-40 rounded-lg border border-borde bg-black/80 p-2 text-plata-300 backdrop-blur md:hidden"
        aria-label="Abrir menú"
      >
        <Menu size={20} />
      </button>

      <aside className="hidden w-60 shrink-0 border-r border-borde-suave bg-[#030303] md:flex md:flex-col">{contenido}</aside>

      <AnimatePresence>
        {abierta && (
          // El hijo directo de AnimatePresence debe ser un motion con key; si no, nunca se desmonta
          // y su fondo queda bloqueando todos los toques.
          <motion.div key="menu-movil" className="fixed inset-0 z-50 md:hidden" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAbierta(false)} />
            <motion.aside
              className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-borde bg-[#050505]"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 34 }}
            >
              {contenido}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
      <circle cx="16" cy="16" r="11" fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth="1" />
      <ellipse cx="16" cy="16" rx="11" ry="4.2" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth=".8" />
      <ellipse cx="16" cy="16" rx="4.2" ry="11" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth=".8" />
      <circle cx="16" cy="16" r="1.8" fill="#fff" />
    </svg>
  );
}
