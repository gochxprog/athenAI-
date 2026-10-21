// Walk-Forward: ventanas reales (entrena → embargo → valida) en una línea de tiempo, Sharpe IS frente a OOS por
// ventana y la tabla de cada ventana. Datos reales del Juez.
import { memo, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { motion } from 'framer-motion';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { NOMBRE_OBJETIVO } from '@/motores/juez/walkForward';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import { CajaTooltip, Dato, SinDatos } from '../Piezas';
import { COLOR, EJE, fechaCorta, fechaHora, numero, porcentaje } from '../tema';

export default memo(function WalkForward({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const [activa, setActiva] = useState<number | null>(null);
  const datos = useMemo(() => j.tramos.map((w, i) => ({ v: `V${i + 1}`, i, is: w.sharpeIs ?? null, oos: w.sharpe, ret: w.retorno, ops: w.operaciones, t: r.ventanasT?.[i] })), [j.tramos, r.ventanasT]);
  if (!datos.length) return <SinDatos>Sin ventanas de Walk-Forward todavía: hacen falta más datos grabados.</SinDatos>;
  const span = Math.max(1, r.hasta - r.desde);
  const pos = (t: number) => Math.max(0, Math.min(100, ((t - r.desde) / span) * 100));
  const ganan = datos.filter((d) => d.ret > 0).length;
  const wfe = j.wfo.wfe;
  return (
    <div className="space-y-5" data-walk-forward>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span>{datos.length} ventanas rodantes</span>
        <span>·</span>
        <span className="font-mono">IS {numero(j.wfo.lIs, 0)} → embargo {numero(j.wfo.embargo, 0)} → OOS {numero(j.wfo.lOos, 0)} barras</span>
        <span>·</span>
        <span>objetivo {NOMBRE_OBJETIVO[j.wfo.objetivo]}</span>
      </div>

      <div className="space-y-1.5">
        {datos.map((d) => {
          const sel = activa === d.i;
          return (
            <button key={d.v} onMouseEnter={() => setActiva(d.i)} onMouseLeave={() => setActiva(null)} onClick={() => setActiva(sel ? null : d.i)} className="flex w-full items-center gap-3" aria-label={`Ventana ${d.v}`}>
              <span className={cn('w-7 shrink-0 text-right font-mono text-[10px]', sel ? 'text-zinc-100' : 'text-zinc-500')}>{d.v}</span>
              <div className="relative h-4 flex-1 rounded bg-zinc-900">
                {d.t && (
                  <>
                    <motion.div className={cn('absolute inset-y-0 rounded-l border', sel ? 'border-zinc-400 bg-zinc-700/40' : 'border-zinc-700 bg-zinc-800/40')} style={{ left: `${pos(d.t.isDesdeT)}%` }} initial={{ width: 0 }} animate={{ width: `${Math.max(0.6, pos(d.t.isHastaT) - pos(d.t.isDesdeT))}%` }} transition={{ duration: 0.6, delay: d.i * 0.05 }} />
                    <motion.div className={cn('absolute inset-y-0 rounded-r', d.ret > 0 ? 'bg-emerald-400/70' : 'bg-rose-400/60', sel && 'ring-1 ring-zinc-100')} style={{ left: `${pos(d.t.oosDesdeT)}%`, width: `${Math.max(0.6, pos(d.t.oosHastaT) - pos(d.t.oosDesdeT))}%` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + d.i * 0.05 }} />
                  </>
                )}
              </div>
            </button>
          );
        })}
        <div className="flex justify-between pl-10 font-mono text-[10px] text-zinc-600">
          <span>{fechaCorta(r.desde)}</span>
          <span>{fechaCorta(r.hasta)}</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} barGap={3}>
              <CartesianGrid stroke={COLOR.rejilla} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="v" {...EJE} />
              <YAxis {...EJE} width={44} tickFormatter={(v) => numero(v, 1)} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={({ active, payload }) => (active && payload?.length ? <CajaTooltip titulo={(payload[0].payload as { v: string }).v} filas={[{ k: 'Sharpe In-Sample', v: numero((payload[0].payload as { is: number | null }).is), color: COLOR.is }, { k: 'Sharpe Out-of-Sample', v: numero((payload[0].payload as { oos: number | null }).oos), color: COLOR.oos }]} /> : null)} />
              <Legend wrapperStyle={{ fontSize: 10, color: COLOR.texto }} formatter={(v) => (v === 'is' ? 'Sharpe In-Sample' : 'Sharpe Out-of-Sample')} />
              <ReferenceLine y={0} stroke={COLOR.eje} />
              <Bar dataKey="is" fill={COLOR.is} fillOpacity={0.5} radius={[2, 2, 0, 0]} isAnimationActive animationDuration={800} />
              <Bar dataKey="oos" fill={COLOR.oos} fillOpacity={0.9} radius={[2, 2, 0, 0]} isAnimationActive animationDuration={1000} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-zinc-900/60 text-[9.5px] uppercase tracking-[0.12em] text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-normal">Ventana</th>
                <th className="px-2 py-2 text-right font-normal">Retorno OOS</th>
                <th className="px-2 py-2 text-right font-normal">Ops</th>
                <th className="px-3 py-2 text-right font-normal">Estado</th>
              </tr>
            </thead>
            <tbody>
              {datos.map((d) => (
                <tr key={d.v} className={cn('border-t border-zinc-800/80', activa === d.i && 'bg-zinc-900')} title={d.t ? `IS ${fechaHora(d.t.isDesdeT)} → ${fechaHora(d.t.isHastaT)} · OOS ${fechaHora(d.t.oosDesdeT)} → ${fechaHora(d.t.oosHastaT)}` : ''}>
                  <td className="px-3 py-1.5 font-mono text-zinc-300">{d.v}</td>
                  <td className={cn('px-2 py-1.5 text-right font-mono', d.ret >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{porcentaje(d.ret, 2)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-zinc-400">{d.ops}</td>
                  <td className="px-3 py-1.5 text-right">{d.ret > 0 ? <Badge variant="positivo">gana</Badge> : <Badge variant="rechazo">pierde</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-zinc-800/80 pt-3 sm:grid-cols-4">
        <Dato k="WFE" v={numero(wfe, 2)} tono={wfe === null ? undefined : wfe >= 0.5 ? 'aprobado' : 'negativo'} />
        <Dato k="Clase" v={j.wfo.clase ?? '—'} />
        <Dato k="Ventanas que ganan" v={`${ganan} de ${datos.length}`} tono={ganan > datos.length / 2 ? 'positivo' : 'negativo'} />
        <Dato k="Retorno OOS total" v={porcentaje(j.oos.retornoTotal)} tono={j.oos.retornoTotal >= 0 ? 'positivo' : 'negativo'} />
      </div>
    </div>
  );
});
