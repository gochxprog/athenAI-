// Luck test (estilo de la antigua pantalla) con el resultado REAL del Juez: la distribución de los escenarios al azar
// que calculó el motor se va llenando, con la marca de tu estrategia y la p. Solo anima lo ya calculado.
import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import useProgreso from '@/hooks/useProgreso';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { ALFA_LUCK, NOMBRE_METODO_LUCK, NOMBRE_METRICA_LUCK } from '@/motores/juez/luckTest';
import { num } from '@/lib/format';

const BINS = 40;
const repartido = (n: number) => Array.from({ length: n }, (_, k) => (k * 7919) % n);

export default function LuckTestJuez({ r }: { r: RespuestaLaboratorio }) {
  const s = r.resultado.suerte;
  const [corrida, setCorrida] = useState(0);
  const t = useProgreso(3800, `${r.hasta}-${corrida}`);

  const datos = useMemo(() => {
    if (!s || !s.simulaciones.length) return null;
    const v = s.simulaciones;
    const lo = Math.min(...v, s.real);
    const hi = Math.max(...v, s.real);
    const pad = (hi - lo) * 0.06 || 1;
    const min = lo - pad;
    const max = hi + pad;
    const orden = repartido(v.length);
    const bin = orden.map((i) => Math.min(BINS - 1, Math.max(0, Math.floor(((v[i] - min) / (max - min)) * BINS))));
    const valores = orden.map((i) => v[i]);
    return { min, max, bin, valores };
  }, [s]);

  const n = datos ? Math.floor(t * datos.bin.length) : 0;
  const conteo = useMemo(() => {
    const c = new Array(BINS).fill(0);
    if (datos) for (let i = 0; i < n; i += 1) c[datos.bin[i]] += 1;
    return c;
  }, [n, datos]);

  if (!s || !datos) return <p className="text-xs text-plata-400">Hacen falta al menos 5 operaciones y 50 barras fuera de muestra para el Luck test.</p>;

  const maxConteo = Math.max(...conteo, 1);
  const posReal = ((s.real - datos.min) / (datos.max - datos.min)) * 100;
  const binReal = Math.floor((posReal / 100) * BINS);
  const superanVistos = datos.valores.slice(0, n).filter((v) => v >= s.real).length;
  const terminado = t >= 1;
  const pasa = s.p < ALFA_LUCK;

  return (
    <div data-luck-animado>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="cifra text-[11px] text-plata-400">
          {num(s.permutaciones)} escenarios al azar · {NOMBRE_METODO_LUCK[s.metodo]} · métrica {NOMBRE_METRICA_LUCK[s.metrica]}
        </p>
        <button onClick={() => setCorrida((c) => c + 1)} className="flex items-center gap-1.5 rounded-md border border-borde px-2.5 py-1.5 text-[11px] text-plata-200 transition-colors hover:border-plata-400 hover:text-white">
          <RotateCcw size={12} /> Repetir animación
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
              <span className={`absolute -top-1 whitespace-nowrap font-mono text-[10px] text-white ${posReal > 70 ? 'right-1.5' : 'left-1.5'}`}>Tu estrategia · {num(s.real, 3)}</span>
            </div>
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9.5px] text-plata-500">
            <span>{num(datos.min, 2)}</span>
            <span>{num(datos.max, 2)}</span>
          </div>
          <p className="mt-2 text-[10px] text-plata-500">Barras grises: escenarios al azar. Blancas: los que igualan o superan a tu estrategia.</p>
        </div>

        <div className="flex flex-col items-center justify-center rounded-xl border border-borde p-5 text-center">
          <div className="relative h-36 w-36">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeDasharray={2 * Math.PI * 42} strokeDashoffset={2 * Math.PI * 42 * (1 - t)} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="cifra text-base text-white">p = {num(terminado ? s.p : n ? superanVistos / n : 0, 3)}</span>
              <span className="text-[9.5px] text-plata-500">{terminado ? `${num(s.superiores)} de ${num(s.permutaciones)}` : `${superanVistos} de ${n}`}</span>
            </div>
          </div>
          <p className={`mt-4 rounded-md px-3 py-2 text-[11px] ${!terminado ? 'border border-borde text-plata-400' : pasa ? 'bg-white text-black' : 'border border-plata-500 text-plata-300'}`}>
            {!terminado ? 'Barajando…' : pasa ? `✓ No explicable por azar (p < ${num(ALFA_LUCK, 2)})` : `✕ Explicable por azar (p ≥ ${num(ALFA_LUCK, 2)})`}
          </p>
        </div>
      </div>
    </div>
  );
}
