// Curva de capital: tramo de entrenamiento (In-Sample, gris) y fuera de muestra (Out-of-Sample, blanco), por
// operación, con su drawdown debajo. Datos reales del Juez.
import { memo, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { Button } from '@/components/ui/shadcn/button';
import { CajaTooltip, Dato, SinDatos } from '../Piezas';
import { COLOR, EJE, numero, porcentaje, reducir, pctEje } from '../tema';

function descargarCsv(r: RespuestaLaboratorio) {
  const filas = (r.operaciones ?? []).map((o) => [new Date(o.entradaT).toISOString(), new Date(o.salidaT).toISOString(), o.lado > 0 ? 'largo' : 'corto', o.barras, o.retorno].join(','));
  const url = URL.createObjectURL(new Blob([['entrada,salida,lado,barras,retorno', ...filas].join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'operaciones-fuera-de-muestra.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default memo(function CurvaOOS({ r }: { r: RespuestaLaboratorio }) {
  const datos = useMemo(() => {
    const rIs = r.resultado.retornosIs ?? [];
    const rOos = (r.operaciones ?? []).map((o) => o.retorno);
    const puntos: { i: number; is?: number; oos?: number; dd: number }[] = [];
    let eq = 1;
    let pico = 1;
    puntos.push({ i: 0, is: 0, dd: 0 });
    rIs.forEach((x, k) => {
      eq *= 1 + x;
      pico = Math.max(pico, eq);
      puntos.push({ i: k + 1, is: eq - 1, dd: eq / pico - 1 });
    });
    const corte = rIs.length;
    puntos[puntos.length - 1].oos = eq - 1;
    rOos.forEach((x, k) => {
      eq *= 1 + x;
      pico = Math.max(pico, eq);
      puntos.push({ i: corte + k + 1, oos: eq - 1, dd: eq / pico - 1 });
    });
    const retIs = rIs.reduce((a, x) => a * (1 + x), 1) - 1;
    const retOos = rOos.reduce((a, x) => a * (1 + x), 1) - 1;
    return { puntos: reducir(puntos, 700), corte, retIs, retOos, peor: Math.min(0, ...puntos.map((p) => p.dd)), nIs: rIs.length, nOos: rOos.length };
  }, [r]);

  if (datos.nOos === 0 && datos.nIs === 0) return <SinDatos>Sin operaciones todavía: deja grabando el mercado y vuelve a probar.</SinDatos>;

  return (
    <div className="space-y-3" data-curva-oos>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={datos.puntos} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="g-oos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR.oos} stopOpacity={0.18} />
                <stop offset="100%" stopColor={COLOR.oos} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g-is" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR.is} stopOpacity={0.15} />
                <stop offset="100%" stopColor={COLOR.is} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={COLOR.rejilla} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="i" type="number" domain={['dataMin', 'dataMax']} {...EJE} tickFormatter={(v) => `#${v}`} />
            <YAxis {...EJE} width={56} tickFormatter={pctEje} />
            <Tooltip
              cursor={{ stroke: COLOR.eje, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as { i: number; is?: number; oos?: number; dd: number };
                return <CajaTooltip titulo={`Operación #${p.i}`} filas={[...(p.is !== undefined ? [{ k: 'In-Sample', v: porcentaje(p.is), color: COLOR.is }] : []), ...(p.oos !== undefined ? [{ k: 'Out-of-Sample', v: porcentaje(p.oos), color: COLOR.oos }] : []), { k: 'Drawdown', v: porcentaje(p.dd), color: COLOR.negativo }]} />;
              }}
            />
            <ReferenceLine y={0} stroke={COLOR.eje} strokeDasharray="4 4" />
            {datos.nIs > 0 && <ReferenceLine x={datos.corte} stroke={COLOR.aprobado} strokeOpacity={0.6} strokeDasharray="3 3" label={{ value: 'OOS · Juez', position: 'insideTopRight', fill: COLOR.aprobado, fontSize: 10 }} />}
            <Area type="monotone" dataKey="is" stroke={COLOR.is} strokeWidth={1.4} fill="url(#g-is)" isAnimationActive animationDuration={900} connectNulls={false} dot={false} />
            <Area type="monotone" dataKey="oos" stroke={COLOR.oos} strokeWidth={1.8} fill="url(#g-oos)" isAnimationActive animationDuration={1200} connectNulls={false} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-[90px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={datos.puntos} margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
            <XAxis dataKey="i" type="number" domain={['dataMin', 'dataMax']} hide />
            <YAxis {...EJE} width={56} tickFormatter={pctEje} />
            <Area type="monotone" dataKey="dd" stroke={COLOR.negativo} strokeOpacity={0.7} strokeWidth={1} fill={COLOR.negativo} fillOpacity={0.12} isAnimationActive animationDuration={900} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-zinc-800/80 pt-3 sm:grid-cols-5">
        <Dato k="Retorno In-Sample" v={porcentaje(datos.retIs)} tono={datos.retIs >= 0 ? 'positivo' : 'negativo'} />
        <Dato k="Retorno Out-of-Sample" v={porcentaje(datos.retOos)} tono={datos.retOos >= 0 ? 'positivo' : 'negativo'} />
        <Dato k="Peor drawdown" v={porcentaje(datos.peor)} tono="negativo" />
        <Dato k="Operaciones IS / OOS" v={`${numero(datos.nIs, 0)} / ${numero(datos.nOos, 0)}`} />
        <div className="flex items-end">
          <Button variant="outline" size="sm" onClick={() => descargarCsv(r)} disabled={!datos.nOos}>
            <Download className="h-3.5 w-3.5" /> Operaciones CSV
          </Button>
        </div>
      </div>
    </div>
  );
});
