// Panel del Juez (diseño «Quant Desk»): estrategia, métricas clave, fases y una pestaña por motor. Datos reales.
import { memo, useMemo, type ReactNode } from 'react';
import { Activity, BarChart3, Dice5, FlaskConical, Gavel, GitCompareArrows, LineChart, Network, ShieldCheck, Shuffle, Waves } from 'lucide-react';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { MIN_OPERACIONES } from '@/motores/juez/juez';
import { ALFA_LUCK } from '@/motores/juez/luckTest';
import { PBO_MAXIMO } from '@/motores/juez/sobreajuste';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { InfoMotor, TarjetaMetrica, type Estado } from './Piezas';
import Stepper from './Stepper';
import { TEXTOS, type TextoMotor } from './textos';
import { fechaCorta, numero, porcentaje } from './tema';
import CurvaOOS from './graficos/CurvaOOS';
import Distribucion from './graficos/Distribucion';
import WalkForward from './graficos/WalkForward';
import MonteCarlo from './graficos/MonteCarlo';
import LuckTest from './graficos/LuckTest';
import Robustez from './graficos/Robustez';
import Sobreajuste from './graficos/Sobreajuste';
import Correlacion from './graficos/Correlacion';
import AntiFuturo from './graficos/AntiFuturo';
import Veredicto from './graficos/Veredicto';

type Grafico = (p: { r: RespuestaLaboratorio }) => ReactNode;
const PESTANAS: { id: string; t: string; icono: typeof LineChart; titulo: string; desc: string; texto: TextoMotor; G: Grafico }[] = [
  { id: 'curva', t: 'Curva OOS', icono: LineChart, titulo: 'Curva de capital In-Sample → Out-of-Sample', desc: 'Retorno acumulado por operación; a la derecha del corte, lo que juzga el Juez.', texto: TEXTOS.backtest, G: CurvaOOS },
  { id: 'distribucion', t: 'Distribución', icono: BarChart3, titulo: 'Distribución de operaciones', desc: 'Cómo se reparten las ganancias y pérdidas fuera de muestra.', texto: TEXTOS.metricas, G: Distribucion },
  { id: 'wfo', t: 'Walk-Forward', icono: GitCompareArrows, titulo: 'Walk-Forward rodante', desc: 'Optimiza en el pasado, prueba en lo que sigue, avanza la ventana.', texto: TEXTOS.wfo, G: WalkForward },
  { id: 'mc', t: 'Montecarlo', icono: Shuffle, titulo: 'Monte Carlo', desc: 'Miles de órdenes posibles de tus operaciones: banda P5–P95 y caminos.', texto: TEXTOS.mc, G: MonteCarlo },
  { id: 'luck', t: 'Luck test', icono: Dice5, titulo: 'Luck test', desc: 'Tu resultado frente a la misma estrategia con el orden al azar.', texto: TEXTOS.luck, G: LuckTest },
  { id: 'robustez', t: 'Robustez', icono: Waves, titulo: 'Robustez', desc: 'Costos ×2, parámetros vecinos y estabilidad en el tiempo.', texto: TEXTOS.robustez, G: Robustez },
  { id: 'sobreajuste', t: 'DSR y PBO', icono: FlaskConical, titulo: 'Sobreajuste', desc: 'Deflated Sharpe y probabilidad de sobreajuste (CSCV).', texto: TEXTOS.sobreajuste, G: Sobreajuste },
  { id: 'correlacion', t: 'Correlación', icono: Network, titulo: 'Matriz de correlación', desc: 'Cuánto se parecen las variantes probadas entre sí.', texto: TEXTOS.correlacion, G: Correlacion },
  { id: 'antifuturo', t: 'Anti-futuro', icono: ShieldCheck, titulo: 'Anti-futuro (look-ahead / data leakage)', desc: 'Comprueba que la estrategia no usa datos del futuro.', texto: TEXTOS.antifuturo, G: AntiFuturo },
  { id: 'veredicto', t: 'Veredicto', icono: Gavel, titulo: 'Veredicto del Juez', desc: 'Puertas, nota y reglas bloqueadas.', texto: TEXTOS.veredicto, G: Veredicto },
];

const VARIANTE = { APROBADA: 'aprobado', 'APROBADA CON RESERVA': 'reserva', RECHAZADA: 'rechazo', 'DATOS INSUFICIENTES': 'tenue' } as const;
const est = (ok: boolean | null): Estado => (ok === null ? 'neutro' : ok ? 'ok' : 'falla');

/** Z-Score de las operaciones OOS: media / desviación × √n (¿la media es distinta de 0?). */
function zScore(rets: number[]) {
  const n = rets.length;
  if (n < 2) return null;
  const m = rets.reduce((a, x) => a + x, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(n) : null;
}

export default memo(function PanelJuez({ r, nombre, selector }: { r: RespuestaLaboratorio; nombre: string; selector?: ReactNode }) {
  const j = r.resultado;
  const o = j.oos;
  const z = useMemo(() => zScore(r.operaciones.map((x) => x.retorno)), [r.operaciones]);
  const p = j.suerte?.p ?? null;
  const metricas: { titulo: string; valor: string; detalle: string; estado: Estado; ayuda: string }[] = [
    { titulo: 'Win Rate', valor: o.aciertos === null ? '—' : porcentaje(o.aciertos, 1, false), detalle: '≥ 50% · referencia', estado: est(o.aciertos === null ? null : o.aciertos >= 0.5), ayuda: 'Porcentaje de operaciones ganadoras fuera de muestra.' },
    { titulo: 'Profit Factor', valor: numero(o.factorBeneficio), detalle: '> 1,20 · referencia', estado: est(o.factorBeneficio === null ? null : o.factorBeneficio > 1.2), ayuda: 'Ganancias brutas ÷ pérdidas brutas.' },
    { titulo: 'Sharpe', valor: numero(o.sharpe), detalle: `Sortino ${numero(o.sortino)}`, estado: est(o.sharpe === null ? null : o.sharpe > 0), ayuda: 'Retorno por unidad de riesgo, anualizado.' },
    { titulo: 'Max Drawdown', valor: porcentaje(-o.maxDrawdown, 1), detalle: '≤ 20% · Juez', estado: est(o.maxDrawdown <= 0.2), ayuda: 'La peor caída desde un máximo de capital.' },
    { titulo: 'Z-Score', valor: numero(z), detalle: '> 1,96 · 95%', estado: est(z === null ? null : z > 1.96), ayuda: 'Media de las operaciones ÷ su error: más de 1,96 = la ganancia media no parece cero por casualidad.' },
    { titulo: 'Operaciones', valor: numero(o.operaciones, 0), detalle: `≥ ${MIN_OPERACIONES} · Juez`, estado: est(o.operaciones >= MIN_OPERACIONES), ayuda: 'Operaciones fuera de muestra.' },
    { titulo: 'PBO', valor: j.pbo === null ? '—' : porcentaje(j.pbo, 0, false), detalle: `< ${numero(PBO_MAXIMO * 100, 0)}% · Juez`, estado: est(j.pbo === null ? null : j.pbo < PBO_MAXIMO), ayuda: 'Probabilidad de sobreajuste.' },
    { titulo: 'Luck test', valor: p === null ? '—' : `p ${numero(p, 3)}`, detalle: `< ${numero(ALFA_LUCK, 2)} · Juez`, estado: est(p === null ? null : p < ALFA_LUCK), ayuda: 'Probabilidad de lograr lo mismo por suerte.' },
  ];

  return (
    <div className="space-y-4" data-panel-juez>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Estrategia en el Juez</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-zinc-500" /> {nombre}
            </CardTitle>
            <CardDescription className="mt-1 font-mono text-[11px]">
              {j.mercado ?? 'mercado'} · {numero(r.filas, 0)} barras · {fechaCorta(r.desde)} → {fechaCorta(r.hasta)} · {numero(j.ensayos, 0)} variantes · costos incluidos{r.fundingIncluido ? ' · funding' : ''}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={VARIANTE[j.veredicto]} data-veredicto-insignia>{j.veredicto}</Badge>
            {selector}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="border-t border-zinc-800/80 pt-3 text-[12px] leading-relaxed text-zinc-300" data-resumen-juez>{j.resumen}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8" data-tarjetas-juez>
        {metricas.map((m, i) => (
          <TarjetaMetrica key={m.titulo} {...m} indice={i} />
        ))}
      </div>

      <Stepper r={r} />

      <Tabs defaultValue="curva" className="space-y-3">
        <div className="overflow-x-auto">
          <TabsList>
            {PESTANAS.map((t) => {
              const Icono = t.icono;
              return (
                <TabsTrigger key={t.id} value={t.id} data-pestana-juez={t.id}>
                  <Icono className="h-3.5 w-3.5" /> {t.t}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        {PESTANAS.map((t) => (
          <TabsContent key={t.id} value={t.id}>
            <Card>
              <CardHeader>
                <CardTitle>{t.titulo}</CardTitle>
                <CardDescription>{t.desc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <t.G r={r} />
                <InfoMotor t={t.texto} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
});
