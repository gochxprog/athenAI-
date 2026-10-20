import { BrainCircuit } from 'lucide-react';
import useClock from '../../hooks/useClock.js';
import { formatClock, formatLongDate } from '../../lib/format.js';
import StatusIndicator from '../ui/StatusIndicator.jsx';

export default function TopBar({ subtitle }) {
  const now = useClock();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-cemento-700 bg-black px-4 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <BrainCircuit className="h-5 w-5 shrink-0 text-white" strokeWidth={1.5} aria-hidden />
        <h1 className="truncate text-sm font-semibold tracking-wide text-white">
          QUANT-AGENTIC <span className="text-cemento-300">v4.0 PRO</span>
          {subtitle && <span className="hidden font-normal text-cemento-400 sm:inline"> / {subtitle}</span>}
        </h1>
      </div>

      <div className="flex items-center gap-5">
        <div className="hidden text-right sm:block">
          <p className="text-[10px] uppercase tracking-label text-cemento-400">{formatLongDate(now)}</p>
          <p className="font-mono text-sm tabular-nums text-white">{formatClock(now)}</p>
        </div>
        <div className="hidden h-8 w-px bg-cemento-700 sm:block" aria-hidden />
        <HeaderStatus label="Mercado" value="--" />
        <HeaderStatus label="Motor" value="Standby" />
      </div>
    </header>
  );
}

function HeaderStatus({ label, value }) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-label text-cemento-400">{label}</p>
      <StatusIndicator label={value} tone="off" />
    </div>
  );
}
