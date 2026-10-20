import { Lightbulb, TestTubes, Gavel, Layers } from 'lucide-react';
import Panel from '../ui/Panel.jsx';
import StatusIndicator from '../ui/StatusIndicator.jsx';

const ENGINE_COUNTERS = [
  { id: 'hipotesis', title: 'Hipótesis Generadas', icon: Lightbulb, value: 0, caption: 'Total de la sesión' },
  { id: 'pruebas', title: 'Pruebas en Proceso', icon: TestTubes, value: 0, caption: 'Backtest en cola' },
  { id: 'juez', title: 'Aprobadas por el Juez', icon: Gavel, value: 0, caption: 'Validadas para despliegue' },
];

export default function RightPanels() {
  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="section-title lg:text-right">Métricas del Motor</h2>
      <div className="flex flex-1 flex-col justify-around gap-3">
        {ENGINE_COUNTERS.map((c) => (
          <CounterPanel key={c.id} {...c} />
        ))}
        <NeuralLayersPanel />
      </div>
    </div>
  );
}

function CounterPanel({ title, icon, value, caption }) {
  return (
    <Panel title={title} icon={icon} connector="left">
      <p className="font-mono text-3xl font-medium tabular-nums leading-none text-white">{value}</p>
      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-cemento-700" role="presentation">
        <div className="h-full bg-white" style={{ width: '0%' }} />
      </div>
      <p className="mt-1 text-[11px] text-cemento-400">{caption}</p>
    </Panel>
  );
}

function NeuralLayersPanel() {
  return (
    <Panel title="Capas Neuronales Activas" icon={Layers} connector="left">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-3xl font-medium tabular-nums leading-none text-white">0</p>
        <span className="font-mono text-[11px] text-cemento-400">carga --%</span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-cemento-700 pt-2">
        <StatusIndicator label="Red en reposo" tone="idle" />
        <span className="font-mono text-[11px] text-cemento-400">--</span>
      </div>
    </Panel>
  );
}
