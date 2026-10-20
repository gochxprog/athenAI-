import { useEffect, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import { SistemaDemoProvider } from '@/hooks/SistemaDemo';
import { META_MODULO } from '@/data/metaModulo';
import DashboardView from '@/modules/DashboardView';
import type { Modulo } from '@/types/nav';

const VISTAS: Partial<Record<Modulo, ComponentType>> = {
  panel: DashboardView,
};

export default function App() {
  const [modulo, setModulo] = useState<Modulo>('panel');
  const meta = META_MODULO[modulo];
  const Vista = VISTAS[modulo] ?? DashboardView;

  useEffect(() => {
    document.title = `${meta.titulo} · AthenAI`;
  }, [meta.titulo]);

  return (
    <SistemaDemoProvider>
      <div className="flex h-screen overflow-hidden bg-black text-plata-200">
        <Sidebar activo={modulo} onSeleccion={setModulo} />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto" id="contenedor-principal">
          <Topbar titulo={meta.titulo} seccion={meta.seccion} />
          <main className="flex-1 p-4 md:p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={modulo}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
              >
                <Vista />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </SistemaDemoProvider>
  );
}
