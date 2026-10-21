// Walk-Forward (estilo de la antigua pantalla) con las ventanas REALES del Juez: cada ventana entrena (In-Sample,
// gris) y se valida en el tramo siguiente (Out-of-Sample, blanco). Un cursor las recorre una por una.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { NOMBRE_OBJETIVO } from '@/motores/juez/walkForward';
import { conSigno, num } from '@/lib/format';

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : conSigno(v * 100, d, '%'));
const dia = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function WalkForwardJuez({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const vs = j.tramos;
  const ts = r.ventanasT ?? [];
  const n = vs.length;
  const [activa, setActiva] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(true);

  useEffect(() => setActiva(0), [r.hasta, n]);
  useEffect(() => {
    if (!reproduciendo || n < 2) return;
    const t = setInterval(() => setActiva((a) => (a + 1) % n), 1300);
    return () => clearInterval(t);
  }, [reproduciendo, n]);

  if (!n) return <p className="text-xs text-plata-400">Sin ventanas de Walk-Forward: hacen falta más datos grabados.</p>;

  const t0 = r.desde;
  const span = Math.max(1, r.hasta - t0);
  const pos = (t: number) => Math.max(0, Math.min(100, ((t - t0) / span) * 100));
  const maxAbs = Math.max(0.01, ...vs.flatMap((w) => [Math.abs(w.anualIs), Math.abs(w.anualOos)].filter(Number.isFinite)));
  const altura = (v: number) => `${(Math.min(Math.abs(v), maxAbs) / maxAbs) * 50}%`;
  const w = vs[Math.min(activa, n - 1)];
  const tw = ts[Math.min(activa, n - 1)];
  const degr = w.anualIs > 0 && Number.isFinite(w.anualOos) ? 1 - w.anualOos / w.anualIs : null;
  const gana = w.retorno > 0;
  const promOos = vs.reduce((a, x) => a + x.retorno, 0) / n;
  const ganan = vs.filter((x) => x.retorno > 0).length;

  return (
    <div data-wf-animado>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-plata-400">
          {n} ventanas rodantes · entrena {num(j.wfo.lIs)} barras → {num(j.wfo.embargo)} de embargo → valida {num(j.wfo.lOos)} · objetivo {NOMBRE_OBJETIVO[j.wfo.objetivo]}
        </p>
        <button onClick={() => setReproduciendo((x) => !x)} className="flex items-center gap-1.5 rounded-md border border-borde px-2.5 py-1.5 text-[11px] text-plata-200 transition-colors hover:border-plata-400 hover:text-white">
          {reproduciendo ? <Pause size={12} /> : <Play size={12} />} {reproduciendo ? 'Pausar' : 'Reproducir'}
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <div className="space-y-[3px]">
            {vs.map((v, i) => {
              const t = ts[i];
              const es = i === activa;
              const isA = t ? pos(t.isDesdeT) : 0;
              const isB = t ? pos(t.isHastaT) : 0;
              const ooA = t ? pos(t.oosDesdeT) : 0;
              const ooB = t ? pos(t.oosHastaT) : 0;
              return (
                <button key={i} onClick={() => { setActiva(i); setReproduciendo(false); }} className="flex w-full items-center gap-2" aria-label={`Ventana ${i + 1}`}>
                  <span className={`w-7 shrink-0 text-right font-mono text-[9.5px] ${es ? 'text-white' : 'text-plata-500'}`}>V{i + 1}</span>
                  <div className="relative h-3 flex-1 rounded-sm bg-white/[0.03]">
                    <motion.div className={`absolute inset-y-0 rounded-l-sm border ${es ? 'border-plata-300 bg-white/10' : 'border-plata-600'}`} style={{ left: `${isA}%` }} initial={{ width: 0 }} animate={{ width: `${Math.max(0.5, isB - isA)}%` }} transition={{ duration: 0.6, delay: i * 0.04 }} />
                    <motion.div className={`absolute inset-y-0 rounded-r-sm ${es ? 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)]' : v.retorno > 0 ? 'bg-plata-300' : 'border border-plata-500'}`} style={{ left: `${ooA}%`, width: `${Math.max(0.5, ooB - ooA)}%` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + i * 0.04 }} />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between pl-9 font-mono text-[9px] text-plata-500">
            <span>{dia(r.desde)}</span>
            <span>{dia(r.hasta)}</span>
          </div>

          {/* Retorno anualizado por ventana: entrenamiento (borde) frente a validación (blanco). */}
          <div className="relative mt-5 flex h-36 items-stretch gap-2 border-b border-borde-suave pl-9">
            <span className="absolute inset-x-0 left-9 top-1/2 border-t border-dashed border-white/30">
              <span className="absolute -top-3.5 right-0 font-mono text-[9px] text-plata-400">0 % · gana arriba</span>
            </span>
            {vs.map((v, i) => (
              <div key={i} className={`relative flex h-full flex-1 justify-center gap-[2px] transition-opacity ${i === activa ? 'opacity-100' : 'opacity-45'}`}>
                {[v.anualIs, v.anualOos].map((x, k) => (
                  <div key={k} className="relative h-full w-1/2 max-w-[14px]">
                    <motion.div
                      className={`absolute left-0 right-0 ${k === 0 ? 'border border-plata-400' : 'bg-white'} ${x >= 0 ? 'bottom-1/2 rounded-t-sm' : 'top-1/2 rounded-b-sm'}`}
                      initial={{ height: 0 }}
                      animate={{ height: Number.isFinite(x) ? altura(x) : 0 }}
                      transition={{ duration: 0.8, delay: i * 0.05 + k * 0.1 }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-3 pl-9 text-[10px] text-plata-500">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 border border-plata-400" /> In-Sample (retorno anual)</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-white" /> Out-of-Sample</span>
          </p>
        </div>

        <motion.div key={activa} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }} className="rounded-xl border border-borde p-4" data-wf-ventana={activa + 1}>
          <p className="etiqueta">Ventana {activa + 1} de {n}</p>
          <dl className="mt-3 space-y-2.5 text-xs">
            <Fila k="Entrenamiento" v={tw ? `${dia(tw.isDesdeT)} → ${dia(tw.isHastaT)}` : '—'} />
            <Fila k="Validación" v={tw ? `${dia(tw.oosDesdeT)} → ${dia(tw.oosHastaT)}` : '—'} />
            <Fila k="Retorno anual IS" v={pct(w.anualIs)} />
            <Fila k="Retorno anual OOS" v={pct(w.anualOos)} />
            <Fila k="Retorno del tramo" v={pct(w.retorno, 2)} />
            <Fila k="Sharpe OOS" v={w.sharpe === null ? '—' : num(w.sharpe, 2)} />
            <Fila k="Degradación" v={degr === null ? '—' : pct(-degr, 0)} />
            <Fila k="Operaciones OOS" v={num(w.operaciones)} />
          </dl>
          <div className={`mt-4 rounded-md px-3 py-2 text-center text-[11px] ${gana ? 'bg-white text-black' : 'border border-plata-500 text-plata-300'}`}>
            {gana ? '✓ La ventana gana fuera de muestra' : '✕ La ventana pierde fuera de muestra'}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-borde-suave pt-3">
            <div>
              <p className="etiqueta">Ganan</p>
              <p className="cifra mt-1 text-sm text-white">{ganan} de {n}</p>
            </div>
            <div>
              <p className="etiqueta">WFE</p>
              <p className="cifra mt-1 text-sm text-white">{j.wfo.wfe === null ? '—' : num(j.wfo.wfe, 2)}</p>
            </div>
            <div className="col-span-2">
              <p className="etiqueta">Retorno medio por tramo OOS</p>
              <p className="cifra mt-1 text-sm text-white">{pct(promOos, 2)}</p>
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
      <dd className="cifra text-right text-white">{v}</dd>
    </div>
  );
}
