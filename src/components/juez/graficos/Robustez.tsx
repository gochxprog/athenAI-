// Robustez: costos ×2, parámetros vecinos y estabilidad por sub-periodos (solo este mercado). Datos reales.
import { memo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { Badge } from '@/components/ui/shadcn/badge';
import { CajaTooltip, SinDatos, TarjetaMetrica } from '../Piezas';
import { COLOR, EJE, numero, porcentaje } from '../tema';

export default memo(function Robustez({ r }: { r: RespuestaLaboratorio }) {
  const rb = r.resultado.robustez;
  if (!rb?.costos2x) return <SinDatos>Sin datos de robustez todavía.</SinDatos>;
  const subs = rb.estabilidad.subperiodos.map((s, i) => ({ ...s, n: `S${i + 1}` }));
  const est = (ok: boolean | null) => (ok === null ? 'neutro' : ok ? 'ok' : 'falla') as 'ok' | 'falla' | 'neutro';
  return (
    <div className="space-y-5" data-robustez>
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        Estado del módulo: <Badge variant={rb.estado === 'aprobado' ? 'aprobado' : rb.estado === 'alerta' ? 'reserva' : 'rechazo'}>{rb.estado}</Badge>
        <span>· {rb.fallas} {rb.fallas === 1 ? 'fallo crítico' : 'fallos críticos'}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TarjetaMetrica titulo="Costos ×2" valor={porcentaje(rb.costos2x.retorno)} detalle={`Profit Factor ${numero(rb.costos2x.factorBeneficio)} · > 1,20`} estado={est(rb.costos2x.ok)} />
        <TarjetaMetrica titulo="Parámetros vecinos" valor={rb.vecinos.proporcion === null ? '—' : porcentaje(rb.vecinos.proporcion, 0, false)} detalle={rb.vecinos.proporcion === null ? 'pon 3+ valores por parámetro' : `ganan · ≥ 70%${rb.vecinos.isla ? ' · isla de optimización' : ''}`} estado={est(rb.vecinos.ok)} indice={1} />
        <TarjetaMetrica titulo="Estabilidad" valor={porcentaje(rb.estabilidad.consistencia, 0, false)} detalle={`sub-periodos que ganan · ≥ 60% · el mejor aporta ${rb.estabilidad.concentracion === null ? '—' : porcentaje(rb.estabilidad.concentracion, 0, false)}`} estado={est(rb.estabilidad.ok)} indice={2} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-[220px]">
          <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">Retorno por sub-periodo fuera de muestra</p>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={subs} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLOR.rejilla} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="n" {...EJE} />
              <YAxis {...EJE} width={52} tickFormatter={(v) => porcentaje(v, 1)} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }} content={({ active, payload }) => (active && payload?.length ? <CajaTooltip titulo={(payload[0].payload as { n: string }).n} filas={[{ k: 'Retorno', v: porcentaje((payload[0].payload as { retorno: number }).retorno, 2) }, { k: 'Mercado', v: (payload[0].payload as { direccion: string }).direccion }, { k: 'Volatilidad', v: (payload[0].payload as { volatilidad: string }).volatilidad }]} /> : null)} />
              <ReferenceLine y={0} stroke={COLOR.eje} />
              <Bar dataKey="retorno" radius={[2, 2, 0, 0]} isAnimationActive animationDuration={900}>
                {subs.map((s) => (
                  <Cell key={s.n} fill={s.retorno >= 0 ? COLOR.positivo : COLOR.negativo} fillOpacity={0.6} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="max-h-[230px] overflow-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-zinc-900 text-[9.5px] uppercase tracking-[0.12em] text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-normal">Vecino</th>
                <th className="px-2 py-2 text-right font-normal">Retorno</th>
                <th className="px-3 py-2 text-right font-normal">Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {rb.vecinos.lista.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-zinc-500">Sin vecinos: pon 3 o más valores por parámetro.</td>
                </tr>
              )}
              {rb.vecinos.lista.map((v) => (
                <tr key={v.combo} className="border-t border-zinc-800/80">
                  <td className="px-3 py-1.5 font-mono text-zinc-300">{v.cambio}</td>
                  <td className={v.retorno >= 0 ? 'px-2 py-1.5 text-right font-mono text-emerald-400' : 'px-2 py-1.5 text-right font-mono text-rose-400'}>{porcentaje(v.retorno, 2)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-400">{numero(v.sharpe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
