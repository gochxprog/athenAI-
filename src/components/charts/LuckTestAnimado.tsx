import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Estrategia } from '@/data/mock';
import { crearAleatorio } from '@/lib/random';
import { normalInversa } from '@/lib/backtest';
import useProgreso from '@/hooks/useProgreso';
import { num } from '@/lib/format';

const PERMUTACIONES = 1000;
const BINS = 40;

/**
 * Luck test por permutación: se barajan 1.000 veces las señales contra los retornos y se mide el
 * Sharpe de cada versión aleatoria. Si la estrategia real no destaca sobre ese ruido, es suerte.
 */
export default function LuckTestAnimado({ e }: { e: Estrategia }) {
  const [corrida, setCorrida] = useState(0);
  const t = useProgreso(3800, `${e.id}-${corrida}`);

  const datos = useMemo(() => {
    // Distribución nula calibrada para que la cola ≥ Sharpe real coincida con el p-valor del Juez.
    const sigma = e.sharpe / Math.max(0.05, normalInversa(1 - e.pValor));
    const rand = crearAleatorio(e.semilla * 31 + corrida);
    const valores = Array.from({ length: PERMUTACIONES }, (_, i) => sigma * normalInversa((i + 0.5) / PERMUTACIONES) + (rand() - 0.5) * sigma * 0.02);
    for (let i = valores.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [valores[i], valores[j]] = [valores[j], valores[i]];
    }
    const lim = Math.max(Math.abs(Math.min(...valores)), Math.max(...valores), e.sharpe) * 1.08;
    const bin = valores.map((v) => Math.min(BINS - 1, Math.max(0, Math.floor(((v + lim) / (2 * lim)) * BINS))));
    return { valores, lim, bin };
  }, [e, corrida]);

  const n = Math.floor(t * PERMUTACIONES);
  const conteo = useMemo(() => {
    const c = new Array(BINS).fill(0);
    for (let i = 0; i < n; i++) c[datos.bin[i]] += 1;
    return c;
  }, [n, datos]);
  const maxConteo = Math.max(...conteo, 1);
  const posReal = ((e.sharpe + datos.lim) / (2 * datos.lim)) * 100;
  const binReal = Math.floor((posReal / 100) * BINS);
  const superan = datos.valores.slice(0, n).filter((v) => v >= e.sharpe).length;
  const p = n ? superan / n : 0;
  const terminado = t >= 1;
  const pasa = e.pValor <= 0.05;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="cifra text-[11px] text-plata-400">
          Permutaciones <span className="text-white">{num(n)}</span> / {num(PERMUTACIONES)} · señales barajadas contra retornos reales
        </p>
        <button onClick={() => setCorrida((c) => c + 1)} className="flex items-center gap-1.5 rounded-md border border-borde px-2.5 py-1.5 text-[11px] text-plata-200 transition-colors hover:border-plata-400 hover:text-white">
          <RotateCcw size={12} /> Repetir test
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div>
          <div className="relative flex h-56 items-end gap-[2px] border-b border-borde-suave">
            {conteo.map((c, i) => (
              <div key={i} className="flex h-full flex-1 items-end">
                <div className={`w-full rounded-t-[1px] transition-[height] duration-100 ${i >= binReal ? 'bg-white' : 'bg-plata-500/60'}`} style={{ height: `${(c / maxConteo) * 100}%` }} />
              </div>
            ))}
            <div className="absolute inset-y-0 w-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" style={{ left: `${posReal}%` }}>
              <span className="absolute -top-1 left-1.5 whitespace-nowrap font-mono text-[10px] text-white">Estrategia real · Sharpe {num(e.sharpe, 2)}</span>
            </div>
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9.5px] text-plata-500">
            <span>Sharpe {num(-datos.lim, 1)}</span>
            <span>0</span>
            <span>{num(datos.lim, 1)}</span>
          </div>
          <p className="mt-2 text-[10px] text-plata-500">Barras grises: Sharpe de versiones aleatorias. Blancas: las que igualan o superan a la estrategia real.</p>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-borde p-5 text-center">
          <div className="relative h-36 w-36">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeDasharray={2 * Math.PI * 42} strokeDashoffset={2 * Math.PI * 42 * (1 - t)} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="cifra text-base text-white">p = {num(terminado ? e.pValor : p, 3)}</span>
              <span className="text-[9.5px] text-plata-500">{superan} de {num(n)}</span>
            </div>
          </div>
          <p className={`mt-4 rounded-md px-3 py-2 text-[11px] ${!terminado ? 'border border-borde text-plata-400' : pasa ? 'bg-white text-black' : 'border border-plata-500 text-plata-300'}`}>
            {!terminado ? 'Barajando…' : pasa ? '✓ No explicable por azar (p ≤ 0,05)' : '✕ Explicable por azar (p > 0,05)'}
          </p>
        </div>
      </div>
    </div>
  );
}
