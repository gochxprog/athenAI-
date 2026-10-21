// Luck test: distribución de los escenarios al azar (calculada por el motor) y la marca de tu estrategia.
import { memo, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { ALFA_LUCK, NOMBRE_METODO_LUCK, NOMBRE_METRICA_LUCK } from '@/motores/juez/luckTest';
import { CajaTooltip, Dato, SinDatos } from '../Piezas';
import { COLOR, EJE, histograma, numero } from '../tema';

export default memo(function LuckTest({ r }: { r: RespuestaLaboratorio }) {
  const s = r.resultado.suerte;
  const cubos = useMemo(() => {
    if (!s || !s.simulaciones.length) return [];
    const lo = Math.min(...s.simulaciones, s.real);
    const hi = Math.max(...s.simulaciones, s.real);
    const pad = (hi - lo) * 0.05 || 1;
    return histograma(s.simulaciones, 36, [lo - pad, hi + pad]);
  }, [s]);
  if (!s || !cubos.length) return <SinDatos>Hacen falta al menos 5 operaciones y 50 barras fuera de muestra para el Luck test.</SinDatos>;
  const pasa = s.p < ALFA_LUCK;
  return (
    <div className="space-y-3" data-luck-test>
      <p className="text-[11px] text-zinc-500">
        {numero(s.permutaciones, 0)} escenarios al azar · {NOMBRE_METODO_LUCK[s.metodo]} · métrica {NOMBRE_METRICA_LUCK[s.metrica]}
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cubos} margin={{ top: 22, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
              <CartesianGrid stroke={COLOR.rejilla} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="centro" type="number" domain={['dataMin', 'dataMax']} {...EJE} tickFormatter={(v) => numero(v, 2)} />
              <YAxis {...EJE} width={40} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={({ active, payload }) => (active && payload?.length ? <CajaTooltip titulo={`${NOMBRE_METRICA_LUCK[s.metrica]} ≈ ${numero((payload[0].payload as { centro: number }).centro, 3)}`} filas={[{ k: 'Escenarios (muestra)', v: String((payload[0].payload as { n: number }).n) }]} /> : null)} />
              <ReferenceLine x={s.real} stroke={COLOR.aprobado} strokeWidth={2} label={{ value: `Tu estrategia · ${numero(s.real, 3)}`, position: 'top', fill: COLOR.aprobado, fontSize: 10 }} />
              <Bar dataKey="n" radius={[2, 2, 0, 0]} isAnimationActive animationDuration={1000}>
                {cubos.map((c) => (
                  <Cell key={c.centro} fill={c.centro >= s.real ? COLOR.negativo : COLOR.is} fillOpacity={c.centro >= s.real ? 0.7 : 0.45} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-col justify-center gap-3 rounded-lg border border-zinc-800 p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Valor p</p>
          <p className={pasa ? 'font-mono text-3xl text-cyan-300' : 'font-mono text-3xl text-rose-400'}>{numero(s.p, 3)}</p>
          <p className="text-[11px] text-zinc-400">{numero(s.superiores, 0)} de {numero(s.permutaciones, 0)} escenarios al azar igualaron o superaron a tu estrategia.</p>
          <p className={pasa ? 'text-[11px] text-cyan-300' : 'text-[11px] text-rose-300'}>{pasa ? `✓ No explicable por azar (p < ${numero(ALFA_LUCK, 2)})` : `✕ Explicable por azar (p ≥ ${numero(ALFA_LUCK, 2)})`}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-zinc-800/80 pt-3 sm:grid-cols-3">
        <Dato k="Tu estrategia" v={numero(s.real, 3)} tono="aprobado" />
        <Dato k="Escenarios mejores" v={numero(s.superiores, 0)} />
        <Dato k="Umbral" v={`p < ${numero(ALFA_LUCK, 2)}`} />
      </div>
    </div>
  );
});
