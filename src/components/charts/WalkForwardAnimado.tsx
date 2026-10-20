import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { WALK_FORWARD, type Estrategia } from '@/data/mock';
import { num } from '@/lib/format';

const MESES = ['may', 'jun', 'jul', 'ago', 'sep', 'oct'];
const VENTANAS = WALK_FORWARD.length;
// Cada ventana avanza medio mes; el entrenamiento está anclado al inicio (ventana creciente).
const fecha = (medioMes: number) => `${medioMes % 2 === 0 ? '01' : '15'}-${MESES[Math.min(MESES.length - 1, Math.floor(medioMes / 2))]}`;

/**
 * Walk-Forward anclado: 12 ventanas que se entrenan (In-Sample) y se validan en el tramo siguiente
 * (Out-of-Sample). Un cursor recorre las ventanas una por una.
 */
export default function WalkForwardAnimado({ e }: { e: Estrategia }) {
  const [activa, setActiva] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(true);

  useEffect(() => {
    setActiva(0);
  }, [e.id]);

  useEffect(() => {
    if (!reproduciendo) return;
    const t = setInterval(() => setActiva((a) => (a + 1) % VENTANAS), 1300);
    return () => clearInterval(t);
  }, [reproduciendo]);

  const factor = e.sharpe / 1.86;
  const datos = WALK_FORWARD.map((w) => ({
    v: w.v,
    is: w.is * Math.max(factor, 0.55),
    oos: w.oos * factor * (1 - Math.max(0, e.overfitting - 15) / 100),
  }));
  const max = Math.max(...datos.flatMap((d) => [d.is, d.oos]), 2.5);
  const promIS = datos.reduce((a, d) => a + d.is, 0) / VENTANAS;
  const promOOS = datos.reduce((a, d) => a + d.oos, 0) / VENTANAS;
  const d = datos[activa];
  const tramos = VENTANAS + 1; // medio mes por tramo
  const opsVentana = Math.max(6, Math.round((e.trades * 0.35) / VENTANAS));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-plata-400">12 ventanas · entrenamiento anclado desde el 01-may · validación de medio mes por ventana</p>
        <button onClick={() => setReproduciendo((r) => !r)} className="flex items-center gap-1.5 rounded-md border border-borde px-2.5 py-1.5 text-[11px] text-plata-200 transition-colors hover:border-plata-400 hover:text-white">
          {reproduciendo ? <Pause size={12} /> : <Play size={12} />} {reproduciendo ? 'Pausar' : 'Reproducir'}
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          {/* Línea de tiempo de ventanas */}
          <div className="space-y-[3px]">
            {datos.map((w, i) => {
              const finIS = ((i + 1) / tramos) * 100;
              const anchoOOS = (1 / tramos) * 100;
              const es = i === activa;
              return (
                <button key={w.v} onClick={() => { setActiva(i); setReproduciendo(false); }} className="flex w-full items-center gap-2" aria-label={`Ventana ${w.v}`}>
                  <span className={`w-7 shrink-0 text-right font-mono text-[9.5px] ${es ? 'text-white' : 'text-plata-500'}`}>V{w.v}</span>
                  <div className="relative h-3 flex-1 rounded-sm bg-white/[0.03]">
                    <motion.div className={`absolute inset-y-0 left-0 rounded-l-sm border ${es ? 'border-plata-300 bg-white/10' : 'border-plata-600'}`} initial={{ width: 0 }} animate={{ width: `${finIS}%` }} transition={{ duration: 0.6, delay: i * 0.04 }} />
                    <motion.div className={`absolute inset-y-0 rounded-r-sm ${es ? 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)]' : 'bg-plata-400'}`} style={{ left: `${finIS}%`, width: `${anchoOOS}%` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + i * 0.04 }} />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between pl-9 font-mono text-[9px] text-plata-500">
            <span>01-may</span>
            <span>15-jul</span>
            <span>15-oct</span>
          </div>

          {/* Sharpe por ventana */}
          <div className="relative mt-5 flex h-36 items-end gap-2 border-b border-borde-suave pl-9">
            <span className="absolute inset-x-0 left-9 border-t border-dashed border-white/30" style={{ bottom: `${(1 / max) * 100}%` }}>
              <span className="absolute -top-3.5 right-0 font-mono text-[9px] text-plata-400">Sharpe 1,00 · umbral</span>
            </span>
            {datos.map((w, i) => (
              <div key={w.v} className={`flex h-full flex-1 items-end justify-center gap-[2px] transition-opacity ${i === activa ? 'opacity-100' : 'opacity-45'}`}>
                <motion.div className="w-1/2 max-w-[14px] rounded-t-sm border border-plata-400" initial={{ height: 0 }} animate={{ height: `${(w.is / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.05 }} />
                <motion.div className="w-1/2 max-w-[14px] rounded-t-sm bg-white" initial={{ height: 0 }} animate={{ height: `${(Math.max(w.oos, 0.02) / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.05 + 0.1 }} />
              </div>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-3 pl-9 text-[10px] text-plata-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 border border-plata-400" /> In-Sample</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-white" /> Out-of-Sample</span>
          </p>
        </div>

        {/* Detalle de la ventana activa */}
        <motion.div key={activa} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }} className="rounded-xl border border-borde p-4">
          <p className="etiqueta">Ventana {d.v} de {VENTANAS}</p>
          <dl className="mt-3 space-y-2.5 text-xs">
            <Fila k="Entrenamiento" v={`01-may → ${fecha(activa + 1)}`} />
            <Fila k="Validación" v={`${fecha(activa + 1)} → ${fecha(activa + 2)}`} />
            <Fila k="Sharpe In-Sample" v={num(d.is, 2)} />
            <Fila k="Sharpe Out-of-Sample" v={num(d.oos, 2)} />
            <Fila k="Degradación" v={`−${num(Math.max(0, (1 - d.oos / d.is) * 100), 0)}%`} />
            <Fila k="Operaciones OOS" v={String(opsVentana)} />
          </dl>
          <div className={`mt-4 rounded-md px-3 py-2 text-center text-[11px] ${d.oos >= 1 ? 'bg-white text-black' : 'border border-plata-500 text-plata-300'}`}>
            {d.oos >= 1 ? '✓ Ventana supera el umbral' : '✕ Ventana bajo el umbral'}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-borde-suave pt-3">
            <div>
              <p className="etiqueta">OOS promedio</p>
              <p className="cifra mt-1 text-sm text-white">{num(promOOS, 2)}</p>
            </div>
            <div>
              <p className="etiqueta">Degradación media</p>
              <p className="cifra mt-1 text-sm text-white">−{num((1 - promOOS / promIS) * 100, 0)}%</p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-plata-400">{k}</dt>
      <dd className="cifra text-white">{v}</dd>
    </div>
  );
}
