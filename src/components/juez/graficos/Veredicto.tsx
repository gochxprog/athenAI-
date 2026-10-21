// Veredicto: puertas de cero tolerancia, nota por partes, reglas bloqueadas y alertas del Juez.
import { memo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Lock, MinusCircle, XCircle } from 'lucide-react';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { cn } from '@/lib/utils';
import { CajaTooltip } from '../Piezas';
import { COLOR, EJE, numero } from '../tema';

const Icono = ({ ok }: { ok: boolean | null }) => (ok === null ? <MinusCircle className="h-3.5 w-3.5 text-zinc-600" /> : ok ? <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" /> : <XCircle className="h-3.5 w-3.5 text-rose-400" />);

export default memo(function Veredicto({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const partes = j.score
    ? [
        { k: 'Walk-Forward', v: j.score.partes.wfo * 100, peso: '25%' },
        { k: 'Costos y vecinos', v: j.score.partes.costosVecinos * 100, peso: '25%' },
        { k: 'Sobreajuste', v: j.score.partes.sobreajuste * 100, peso: '30%' },
        { k: 'Curva', v: j.score.partes.curva * 100, peso: '20%' },
      ]
    : [];
  return (
    <div className="space-y-5" data-veredicto>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800">
          <p className="border-b border-zinc-800 px-4 py-2.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500">Puertas de cero tolerancia</p>
          <ul className="divide-y divide-zinc-800/80">
            {j.puertas.map((p) => (
              <li key={p.nombre} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                <span className="flex items-center gap-2 text-zinc-300">
                  <Icono ok={p.ok} /> {p.nombre}
                </span>
                <span className="text-right font-mono text-[11px] text-zinc-400">
                  {p.valor} <span className="text-zinc-600">· {p.umbral}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-zinc-800 p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Nota del Juez</p>
            <p className={cn('font-mono text-2xl', !j.score ? 'text-zinc-500' : j.score.total >= 75 ? 'text-cyan-300' : 'text-amber-300')}>{j.score ? `${numero(j.score.total, 0)}/100` : '—'}</p>
          </div>
          {partes.length ? (
            <div className="mt-2 h-[170px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={partes} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={COLOR.rejilla} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} {...EJE} />
                  <YAxis type="category" dataKey="k" {...EJE} width={110} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={({ active, payload }) => (active && payload?.length ? <CajaTooltip titulo={(payload[0].payload as { k: string }).k} filas={[{ k: 'Puntos', v: `${numero((payload[0].payload as { v: number }).v, 0)}/100` }, { k: 'Peso', v: (payload[0].payload as { peso: string }).peso }]} /> : null)} />
                  <Bar dataKey="v" fill={COLOR.aprobado} fillOpacity={0.6} radius={[0, 3, 3, 0]} isAnimationActive animationDuration={900} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-zinc-500">La nota solo existe si pasa todas las puertas.</p>
          )}
          <p className="mt-2 text-[11px] text-zinc-500">75 o más: lista para Paper Trading · menos de 75: aprobada con reserva (cuarentena).</p>
        </div>
      </div>
      {j.alertas.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-200">
          {j.alertas.map((a) => (
            <p key={a}>⚠ {a}</p>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-zinc-800">
        <p className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          <Lock className="h-3 w-3" /> Reglas del Juez · solo lectura
        </p>
        <ul className="divide-y divide-zinc-800/80">
          {j.reglas.map((x) => (
            <li key={x.nombre} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <span className="flex items-center gap-2 text-zinc-300">
                <Icono ok={x.ok} /> {x.nombre}
              </span>
              <span className="hidden truncate font-mono text-[11px] text-zinc-400 sm:block">{x.valor}</span>
              <span className="font-mono text-[11px] text-zinc-500">{x.umbral}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});
