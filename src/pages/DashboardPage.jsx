import { useCallback, useEffect, useRef } from 'react';
import Brain3D from '../components/dashboard/Brain3D.jsx';
import LeftPanels from '../components/dashboard/LeftPanels.jsx';
import RightPanels from '../components/dashboard/RightPanels.jsx';
import EventLog from '../components/dashboard/EventLog.jsx';
import useEventLog from '../hooks/useEventLog.js';

const STANDBY_MESSAGE = 'Sistema en espera de conexión de datos...';
const HEARTBEAT_MS = 60_000;

export default function DashboardPage() {
  const { entries, log } = useEventLog([
    { message: STANDBY_MESSAGE },
    { message: 'Fuente Binance USD-M Futures: desconectada.' },
    { message: 'Grabadora de Order Flow: detenida.' },
  ]);
  const brainReported = useRef(false);

  // Latido: deja constancia periódica del estado de espera mientras no haya datos.
  useEffect(() => {
    const id = setInterval(() => log(STANDBY_MESSAGE, 'system'), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [log]);

  const handleBrainReady = useCallback(
    ({ nodes, links }) => {
      if (brainReported.current) return;
      brainReported.current = true;
      log(`Cerebro 3D inicializado: ${nodes.toLocaleString('es-ES')} nodos, ${links.toLocaleString('es-ES')} sinapsis (WebGL).`);
    },
    [log],
  );

  const handleBrainError = useCallback(() => {
    log('No se pudo inicializar el contexto WebGL del Cerebro 3D.', 'warn');
  }, [log]);

  return (
    <div className="flex flex-col gap-3 p-3 md:p-4 lg:h-full lg:min-h-0">
      <div className="grid grid-cols-1 gap-3 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)] lg:gap-0">
        <div className="order-2 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <LeftPanels />
        </div>
        <div className="order-1 h-[52vh] min-h-[320px] lg:order-2 lg:h-auto">
          <Brain3D onReady={handleBrainReady} onError={handleBrainError} />
        </div>
        <div className="order-3 lg:min-h-0 lg:overflow-y-auto lg:pl-1">
          <RightPanels />
        </div>
      </div>
      <div className="h-40 shrink-0 lg:h-[clamp(8rem,20vh,12rem)]">
        <EventLog entries={entries} />
      </div>
    </div>
  );
}
