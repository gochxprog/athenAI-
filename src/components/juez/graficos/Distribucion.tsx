// Distribución de los retornos por operación fuera de muestra (histograma), con media y estadísticas.
import { memo, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { CajaTooltip, Dato, SinDatos } from '../Piezas';
import { COLOR, EJE, histograma, numero, porcentaje } from '../tema';

export default memo(function Distribucion({ r }: { r: RespuestaLaboratorio }) {
  const s = useMemo(() => {
    const x = (r.operaciones ?? []).map((o) => o.retorno);
    const n = x.length;
    if (!n) return null;
    const media = x.reduce((a, v) => a + v, 0) / n;
    const sd = Math.sqrt(x.reduce((a, v) => a + (v - media) ** 2, 0) / Math.max(1, n - 1));
    const ord = [...x].sort((a, b) => a - b);
    const mediana = n % 2 ? ord[(n - 1) / 2] : (ord[n / 2 - 1] + ord[n / 2]) / 2;
    const asim = sd > 0 ? x.reduce((a, v) => a + ((v - media) / sd) ** 3, 0) / n : 0;
    return { cubos: histograma(x, 32), media, sd, mediana, asim, ganadoras: x.filter((v) => v > 0).length / n, mejor: ord[n - 1], peor: ord[0], z: sd > 0 ? (media / sd) * Math.sqrt(n) : null, n };
  }, [r]);
  if (!s) return <SinDatos>Sin operaciones fuera de muestra todavía.</SinDatos>;
  return (
    <div className="space-y-3" data-distribucion>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={s.cubos} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
            <CartesianGrid stroke={COLOR.rejilla} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="centro" type="number" domain={['dataMin', 'dataMax']} {...EJE} tickFormatter={(v) => porcentaje(v, 1)} />
            <YAxis {...EJE} width={40} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={({ active, payload }) => (active && payload?.length ? <CajaTooltip titulo={`${porcentaje((payload[0].payload as { desde: number }).desde, 2)} … ${porcentaje((payload[0].payload as { hasta: number }).hasta, 2)}`} filas={[{ k: 'Operaciones', v: String((payload[0].payload as { n: number }).n) }]} /> : null)} />
            <ReferenceLine x={0} stroke={COLOR.eje} strokeDasharray="4 4" />
            <ReferenceLine x={s.media} stroke={COLOR.aprobado} strokeDasharray="3 3" label={{ value: 'media', position: 'top', fill: COLOR.aprobado, fontSize: 10 }} />
            <Bar dataKey="n" isAnimationActive animationDuration={900} radius={[2, 2, 0, 0]}>
              {s.cubos.map((c) => (
                <Cell key={c.centro} fill={c.centro >= 0 ? COLOR.positivo : COLOR.negativo} fillOpacity={0.55} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-zinc-800/80 pt-3 sm:grid-cols-4 lg:grid-cols-8">
        <Dato k="Operaciones" v={numero(s.n, 0)} />
        <Dato k="Media" v={porcentaje(s.media, 3)} tono={s.media >= 0 ? 'positivo' : 'negativo'} />
        <Dato k="Mediana" v={porcentaje(s.mediana, 3)} />
        <Dato k="Desviación" v={porcentaje(s.sd, 3, false)} />
        <Dato k="Asimetría" v={numero(s.asim, 2)} />
        <Dato k="Ganadoras" v={porcentaje(s.ganadoras, 1, false)} />
        <Dato k="Mejor / peor" v={`${porcentaje(s.mejor, 2)} / ${porcentaje(s.peor, 2)}`} />
        <Dato k="Z-Score" v={numero(s.z, 2)} tono={(s.z ?? 0) >= 2 ? 'aprobado' : undefined} />
      </div>
    </div>
  );
});
