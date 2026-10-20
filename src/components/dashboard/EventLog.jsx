import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { formatClock } from '../../lib/format.js';
import useClock from '../../hooks/useClock.js';

const LEVEL_STYLES = {
  system: 'text-cemento-200',
  info: 'text-white',
  warn: 'text-white font-semibold',
};

const LEVEL_TAGS = {
  system: 'SYS',
  info: 'INF',
  warn: 'AVS',
};

export default function EventLog({ entries }) {
  const now = useClock();
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <section className="glass-panel flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-cemento-700 px-4 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-cemento-300" strokeWidth={1.75} aria-hidden />
          <h2 className="panel-label">Registro de Eventos (Log del Día)</h2>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-cemento-400">
          {entries.length} eventos · {formatClock(now)}
        </span>
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-[12px] leading-relaxed"
      >
        {entries.map((entry) => (
          <p key={entry.id} className="flex gap-3 whitespace-pre-wrap">
            <time className="shrink-0 tabular-nums text-cemento-400" dateTime={entry.time.toISOString()}>
              [{formatClock(entry.time)}]
            </time>
            <span className="shrink-0 text-cemento-600">{LEVEL_TAGS[entry.level] ?? 'INF'}</span>
            <span className={LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info}>{entry.message}</span>
          </p>
        ))}
        <p className="flex gap-3 text-cemento-400" aria-hidden>
          <span className="animate-pulse">▍</span>
        </p>
      </div>
    </section>
  );
}
