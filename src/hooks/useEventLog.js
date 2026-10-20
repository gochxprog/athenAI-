import { useCallback, useRef, useState } from 'react';

const MAX_ENTRIES = 250;

/**
 * Registro de eventos en memoria. Cada entrada lleva su marca de tiempo real.
 * level: 'info' | 'warn' | 'system'
 */
export default function useEventLog(initial = []) {
  const seq = useRef(0);
  const [entries, setEntries] = useState(() =>
    initial.map((e) => ({ id: seq.current++, time: new Date(), level: 'system', ...e })),
  );

  const log = useCallback((message, level = 'info') => {
    setEntries((prev) => {
      const next = [...prev, { id: seq.current++, time: new Date(), level, message }];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, log, clear };
}
