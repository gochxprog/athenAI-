// Sobreajuste: Deflated Sharpe (indicador radial) y PBO con la distribución de λ = logit(ω) del CSCV.
import { memo, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, PolarAngleAxis, RadialBar, RadialBarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { DSR_MINIMO, PBO_MAXIMO } from '@/motores/juez/sobreajuste';
import { CajaTooltip, Dato, SinDatos } from '../Piezas';
import { COLOR, EJE, histograma, numero, porcentaje } from '../tema';

export default memo(function Sobreajuste({ r }: { r: RespuestaLaboratorio }) {
  const j = r.resultado;
  const dsr = j.deflatedSharpe;
  const pbo = j.pbo;
  const lambdas = useMemo(() => histograma(j.pboDetalle?.lambdas ?? [], 30), [j.pboDetalle]);
  const okDsr = dsr !== null && dsr >= DSR_MINIMO;
  const okPbo = pbo !== null && pbo < PBO_MAXIMO;
  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]" data-sobreajuste>
      <div className="rounded-lg border border-zinc-800 p-4">
        <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Deflated Sharpe</p>
        <div className="relative h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart innerRadius="72%" outerRadius="100%" startAngle={220} endAngle={-40} data={[{ v: Math.max(0, Math.min(1, dsr ?? 0)) }]}>
              <PolarAngleAxis type="number" domain={[0, 1]} tick={false} />
              <RadialBar dataKey="v" background={{ fill: COLOR.rejilla }} fill={okDsr ? COLOR.aprobado : COLOR.negativo} cornerRadius={6} isAnimationActive animationDuration={1200} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={okDsr ? 'font-mono text-2xl text-cyan-300' : 'font-mono text-2xl text-rose-400'}>{numero(dsr, 3)}</span>
            <span className="text-[10px] text-zinc-500">umbral {numero(DSR_MINIMO, 2)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-zinc-800/80 pt-3">
          <Dato k="SR observado" v={numero(j.dsrDetalle?.srObs, 4)} />
          <Dato k="SR* (azar)" v={numero(j.dsrDetalle?.srEstrella, 4)} />
          <Dato k="Variantes N" v={numero(j.ensayos, 0)} />
          <Dato k="Muestras T" v={numero(j.dsrDetalle?.t, 0)} />
        </div>
      </div>
      <div className="rounded-lg border border-zinc-800 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">PBO · probabilidad de sobreajuste (CSCV)</p>
          <span className={okPbo ? 'font-mono text-2xl text-cyan-300' : 'font-mono text-2xl text-rose-400'}>{pbo === null ? '—' : porcentaje(pbo, 1, false)}</span>
        </div>
        {lambdas.length ? (
          <div className="mt-2 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lambdas} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
                <CartesianGrid stroke={COLOR.rejilla} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="centro" type="number" domain={[(m: number) => Math.min(0, m), (m: number) => Math.max(0, m)]} {...EJE} tickFormatter={(v) => numero(v, 1)} />
                <YAxis {...EJE} width={36} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={({ active, payload }) => (active && payload?.length ? <CajaTooltip titulo={`λ ≈ ${numero((payload[0].payload as { centro: number }).centro, 2)}`} filas={[{ k: 'Combinaciones (muestra)', v: String((payload[0].payload as { n: number }).n) }]} /> : null)} />
                <ReferenceLine x={0} stroke={COLOR.reserva} strokeDasharray="3 3" label={{ value: 'mediana', position: 'top', fill: COLOR.reserva, fontSize: 10 }} />
                <Bar dataKey="n" radius={[2, 2, 0, 0]} isAnimationActive animationDuration={900}>
                  {lambdas.map((c) => (
                    <Cell key={c.centro} fill={c.centro < 0 ? COLOR.negativo : COLOR.positivo} fillOpacity={0.55} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <SinDatos>Con una sola variante no se puede medir el PBO.</SinDatos>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">λ &lt; 0 (rojo): la variante elegida quedó por debajo de la mediana fuera de muestra. PBO = proporción de esas combinaciones · umbral &lt; {numero(PBO_MAXIMO * 100, 0)}%.</p>
      </div>
    </div>
  );
});
