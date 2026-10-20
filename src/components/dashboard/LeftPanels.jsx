import { Radio, AudioLines, Gauge } from 'lucide-react';
import Panel from '../ui/Panel.jsx';
import StatusIndicator from '../ui/StatusIndicator.jsx';

// Estado inicial: sin conexión a ninguna fuente de datos.
const ORDER_FLOW_BUCKETS = 12;

export default function LeftPanels() {
  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="section-title">Fuentes de Datos</h2>
      <div className="flex flex-1 flex-col justify-around gap-3">
        <LiveMarketPanel />
        <OrderFlowPanel />
        <InputMetricsPanel />
      </div>
    </div>
  );
}

function LiveMarketPanel() {
  return (
    <Panel title="Mercado Vivo" icon={Radio} connector="right">
      <p className="text-[11px] text-cemento-400">Binance USD-M Futures</p>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-label text-cemento-400">Bid / Ask</span>
        <span className="font-mono text-2xl font-medium tabular-nums text-white">--/--</span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-cemento-700 pt-2">
        <StatusIndicator label="Desconectado" tone="off" />
        <span className="font-mono text-[11px] text-cemento-400">-- ms</span>
      </div>
    </Panel>
  );
}

function OrderFlowPanel() {
  return (
    <Panel title="Flujo Order Flow" icon={AudioLines} connector="right">
      <p className="text-[11px] text-cemento-400">Grabadora</p>
      <div className="mt-2 flex h-10 items-end gap-1" aria-label="Volumen por intervalo: sin datos">
        {Array.from({ length: ORDER_FLOW_BUCKETS }, (_, i) => (
          <span key={i} className="h-px flex-1 bg-cemento-600" />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-cemento-700 pt-2">
        <StatusIndicator label="Detenido" tone="off" />
        <span className="font-mono text-[11px] text-cemento-400">--</span>
      </div>
    </Panel>
  );
}

const INPUT_METRICS = [
  { label: 'VWAP', value: '0' },
  { label: 'CVD Delta', value: '0' },
  { label: 'ATR', value: '--' },
];

function InputMetricsPanel() {
  return (
    <Panel title="Métricas de Entrada" icon={Gauge} connector="right">
      <dl className="divide-y divide-cemento-700">
        {INPUT_METRICS.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-cemento-200">{label}</dt>
            <dd className="font-mono text-sm tabular-nums text-white">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
