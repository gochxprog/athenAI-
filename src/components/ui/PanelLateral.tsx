import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  children: ReactNode;
}

/** Panel deslizante desde la derecha (detalle de hipótesis, consola de agente…). */
export default function PanelLateral({ abierto, onCerrar, titulo, subtitulo, children }: Props) {
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  // Abrir el panel añade una entrada al historial: el botón Atrás lo cierra en vez de salir de la app.
  useEffect(() => {
    if (!abierto) return;
    window.history.pushState({ panelLateral: true }, '');
    let cerradoConAtras = false;
    const alVolver = () => {
      cerradoConAtras = true;
      cerrarRef.current();
    };
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && cerrarRef.current();
    window.addEventListener('popstate', alVolver);
    window.addEventListener('keydown', alTeclear);
    return () => {
      window.removeEventListener('popstate', alVolver);
      window.removeEventListener('keydown', alTeclear);
      if (!cerradoConAtras && window.history.state?.panelLateral) window.history.back();
    };
  }, [abierto]);

  return (
    <AnimatePresence>
      {abierto && (
        <motion.div key="panel-lateral" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCerrar}
          />
          <motion.aside
            className="fixed bottom-0 right-0 top-16 z-50 flex w-full max-w-md flex-col border-l border-borde bg-[#060607]/95 shadow-2xl backdrop-blur-xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 32 }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-borde px-5 py-4">
              <div className="min-w-0">
                {subtitulo && <p className="etiqueta mb-1">{subtitulo}</p>}
                <h3 className="text-base font-normal leading-snug text-white">{titulo}</h3>
              </div>
              <button onClick={onCerrar} className="rounded-md p-1.5 text-plata-400 transition-colors hover:bg-white/5 hover:text-white" aria-label="Cerrar panel">
                <X size={16} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
