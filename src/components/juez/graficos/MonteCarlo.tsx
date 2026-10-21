// Monte Carlo: abanico de trayectorias calculadas por el motor (bandas P5–P95 y mediana) y la distribución del
// resultado final. Solo dibuja lo que calculó el Juez.
import { memo, useMemo } from 'react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { CajaTooltip, Dato, SinDatos } from '../Piezas';
import { COLOR, EJE, histograma, numero, porcentaje, pctEje } from '../tema';

export default memo(function MonteCarlo({ r }: { r: RespuestaLaboratorio }) {
  const mc = r.resultado.monteCarlo;
  const datos = useMemo(() => {
    if (!mc || !mc.caminos.length) return null;
    const n = mc.bandas.p50.length;
    const caminos = mc.caminos.slice(0, 40);
    const puntos = Array.from({ length: n }, (_, k) => {
      const p: Record<string, number | [number, number]> = { k, banda: [mc.bandas.p5[k] - 1, mc.bandas.p95[k] - 1], p50: mc.bandas.p50[k] - 1 };
      caminos.forEach((c, i) => {
        if (c[k] !== undefined) p[`c${i}`] = c[k] - 1;
      });
      return p;
    });
    return { puntos, caminos: caminos.length, finales: histograma(mc.muestras, 24) };
  }, [mc]);
  if (!mc || !datos) return <SinDatos>Hacen falta al menos 5 operaciones fuera de muestra para el Monte Carlo.</SinDatos>;
  return (
    <div className="space-y-3" data-monte-carlo>
      <p className="text-[11px] text-zinc-500">
        {numero(mc.simulaciones, 0)} simulaciones ({mc.metodo === 'bootstrap' ? 'bootstrap, con reemplazo' : 'reordenando'}) de {numero(mc.operaciones, 0)} operaciones reales fuera de muestra · se dibujan {datos.caminos} de ejemplo
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={datos.puntos} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLOR.rejilla} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="k" {...EJE} tickFormatter={(v) => `${Math.round((v / Math.max(1, datos.puntos.length - 1)) * 100)}%`} />
              <YAxis {...EJE} width={56} tickFormatter={pctEje} />
              <Tooltip
                cursor={{ stroke: COLOR.eje, strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as { banda: [number, number]; p50: number };
                  return <CajaTooltip titulo="Capital en este punto" filas={[{ k: 'P95 optimista', v: porcentaje(p.banda[1]) }, { k: 'P50 mediana', v: porcentaje(p.p50), color: COLOR.aprobado }, { k: 'P5 pesimista', v: porcentaje(p.banda[0]) }]} />;
                }}
              />
              <ReferenceLine y={0} stroke={COLOR.eje} strokeDasharray="4 4" />
              <Area type="monotone" dataKey="banda" stroke="none" fill={COLOR.aprobado} fillOpacity={0.08} isAnimationActive animationDuration={1200} />
              {Array.from({ length: datos.caminos }, (_, i) => (
                <Line key={i} type="monotone" dataKey={`c${i}`} stroke={COLOR.linea} strokeOpacity={0.12} strokeWidth={1} dot={false} isAnimationActive animationDuration={600 + i * 25} />
              ))}
              <Line type="monotone" dataKey="p50" stroke={COLOR.aprobado} strokeWidth={2} dot={false} isAnimationActive animationDuration={1400} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="h-[300px]">
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">Resultado final · distribución</p>
          <ResponsiveContainer width="100%" height="92%">
            <BarChart data={[...datos.finales].reverse()} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="centro" {...EJE} width={60} tickFormatter={pctEje} interval={3} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={({ active, payload }) => (active && payload?.length ? <CajaTooltip filas={[{ k: 'Resultado', v: porcentaje((payload[0].payload as { centro: number }).centro) }, { k: 'Simulaciones (muestra)', v: String((payload[0].payload as { n: number }).n) }]} /> : null)} />
              <Bar dataKey="n" radius={[0, 2, 2, 0]} isAnimationActive animationDuration={1000}>
                {[...datos.finales].reverse().map((c) => (
                  <Cell key={c.centro} fill={c.centro >= 0 ? COLOR.positivo : COLOR.negativo} fillOpacity={0.55} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-zinc-800/80 pt-3 sm:grid-cols-6">
        <Dato k="P5 final" v={porcentaje(mc.p5)} tono={mc.p5 >= 0 ? 'positivo' : 'negativo'} />
        <Dato k="P50 final" v={porcentaje(mc.p50)} tono={mc.p50 >= 0 ? 'positivo' : 'negativo'} />
        <Dato k="P95 final" v={porcentaje(mc.p95)} tono={mc.p95 >= 0 ? 'positivo' : 'negativo'} />
        <Dato k="Prob. de ruina" v={porcentaje(mc.probRuina, 1, false)} tono={mc.probRuina <= 0.05 ? 'aprobado' : 'negativo'} />
        <Dato k="Drawdown P50" v={porcentaje(-mc.ddP50)} tono="negativo" />
        <Dato k="Drawdown P95" v={porcentaje(-mc.ddP95)} tono="negativo" />
      </div>
    </div>
  );
});
