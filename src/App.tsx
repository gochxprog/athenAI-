import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import { NavegacionContexto } from '@/hooks/Navegacion';
import { META_MODULO } from '@/data/metaModulo';
import type { Modulo } from '@/types/nav';
import { iniciarNotificaciones } from '@/motores/notificaciones/iniciar';

// Avisos a Discord / Telegram / ntfy desde que se abre la app (no solo al entrar en un módulo).
iniciarNotificaciones();

// Cada módulo se carga bajo demanda: Three.js y R3F solo se descargan cuando hacen falta.
const DashboardView = lazy(() => import('@/modules/DashboardView'));
const OrderFlowView = lazy(() => import('@/modules/OrderFlowView'));
const InvestigacionView = lazy(() => import('@/modules/InvestigacionView'));
const ConocimientoView = lazy(() => import('@/modules/ConocimientoView'));
const LaboratorioView = lazy(() => import('@/modules/LaboratorioView'));
const EstrategiasView = lazy(() => import('@/modules/EstrategiasView'));
const AgentesView = lazy(() => import('@/modules/AgentesView'));
const PaperTradingView = lazy(() => import('@/modules/PaperTradingView'));
const DecisionesView = lazy(() => import('@/modules/DecisionesView'));
const MaquinasView = lazy(() => import('@/modules/MaquinasView'));
const DatosView = lazy(() => import('@/modules/DatosView'));

const VISTAS: Record<Modulo, ComponentType> = {
  panel: DashboardView,
  orderflow: OrderFlowView,
  laboratorio: LaboratorioView,
  investigacion: InvestigacionView,
  estrategias: EstrategiasView,
  conocimiento: ConocimientoView,
  agentes: AgentesView,
  paper: PaperTradingView,
  decisiones: DecisionesView,
  maquinas: MaquinasView,
  datos: DatosView,
};

const MODULOS = Object.keys(VISTAS) as Modulo[];

/** El módulo vive en el hash (#/laboratorio) para que el botón Atrás del navegador funcione. */
function moduloDesdeHash(): Modulo {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (MODULOS as string[]).includes(h) ? (h as Modulo) : 'panel';
}

export default function App() {
  const [modulo, setModulo] = useState<Modulo>(moduloDesdeHash);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(window.history.state, '', '#/panel');
    const alCambiar = () => setModulo(moduloDesdeHash());
    window.addEventListener('popstate', alCambiar);
    window.addEventListener('hashchange', alCambiar);
    return () => {
      window.removeEventListener('popstate', alCambiar);
      window.removeEventListener('hashchange', alCambiar);
    };
  }, []);

  const navegar = (m: Modulo) => {
    if (m !== moduloDesdeHash()) window.history.pushState(null, '', `#/${m}`);
    setModulo(m);
  };
  const meta = META_MODULO[modulo];
  const Vista = VISTAS[modulo];

  useEffect(() => {
    document.title = `${meta.titulo} · AthenAI`;
    document.getElementById('contenedor-principal')?.scrollTo({ top: 0 });
  }, [meta.titulo]);

  return (
    <>
      <NavegacionContexto.Provider value={navegar}>
      <div className="flex h-screen overflow-hidden bg-black text-plata-200">
        <Sidebar activo={modulo} onSeleccion={navegar} />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto" id="contenedor-principal">
          <Topbar titulo={meta.titulo} seccion={meta.seccion} />
          <main className="flex-1 p-4 md:p-6">
            {/* Sin animación de salida: una salida que no termina (p. ej. por animaciones internas) dejaría la navegación trabada. */}
            <motion.div key={modulo} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
              <Suspense fallback={<CargandoModulo />}>
                <Vista />
              </Suspense>
            </motion.div>
          </main>
        </div>
      </div>
      </NavegacionContexto.Provider>
    </>
  );
}

function CargandoModulo() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border border-white/10 border-t-white" aria-label="Cargando" />
    </div>
  );
}
