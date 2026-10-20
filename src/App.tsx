import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import { SistemaDemoProvider } from '@/hooks/SistemaDemo';
import { META_MODULO } from '@/data/metaModulo';
import type { Modulo } from '@/types/nav';

// Cada módulo se carga bajo demanda: Three.js y R3F solo se descargan cuando hacen falta.
const DashboardView = lazy(() => import('@/modules/DashboardView'));
const InvestigacionView = lazy(() => import('@/modules/InvestigacionView'));
const ConocimientoView = lazy(() => import('@/modules/ConocimientoView'));
const LaboratorioView = lazy(() => import('@/modules/LaboratorioView'));
const EstrategiasView = lazy(() => import('@/modules/EstrategiasView'));
const AgentesView = lazy(() => import('@/modules/AgentesView'));
const PaperTradingView = lazy(() => import('@/modules/PaperTradingView'));
const DecisionesView = lazy(() => import('@/modules/DecisionesView'));
const CostosView = lazy(() => import('@/modules/CostosView'));
const MaquinasView = lazy(() => import('@/modules/MaquinasView'));
const DatosView = lazy(() => import('@/modules/DatosView'));

const VISTAS: Record<Modulo, ComponentType> = {
  panel: DashboardView,
  laboratorio: LaboratorioView,
  investigacion: InvestigacionView,
  estrategias: EstrategiasView,
  conocimiento: ConocimientoView,
  agentes: AgentesView,
  paper: PaperTradingView,
  decisiones: DecisionesView,
  costos: CostosView,
  maquinas: MaquinasView,
  datos: DatosView,
};

export default function App() {
  const [modulo, setModulo] = useState<Modulo>('panel');
  const meta = META_MODULO[modulo];
  const Vista = VISTAS[modulo];

  useEffect(() => {
    document.title = `${meta.titulo} · AthenAI`;
    document.getElementById('contenedor-principal')?.scrollTo({ top: 0 });
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
                <Suspense fallback={<CargandoModulo />}>
                  <Vista />
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </SistemaDemoProvider>
  );
}

function CargandoModulo() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border border-white/10 border-t-white" aria-label="Cargando" />
    </div>
  );
}
