import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, BarChart3, Brain, CheckCheck, Database, FlaskConical, Gavel, Lightbulb, Radio } from 'lucide-react';
import EsferaCerebro from '@/components/three/EsferaCerebro';
import Panel from '@/components/ui/Panel';
import { Estado } from '@/components/ui/Punto';
import ContadorAnimado from '@/components/ui/ContadorAnimado';
import Consola from '@/components/ui/Consola';
import Sparkline from '@/components/charts/Sparkline';
import Barra from '@/components/ui/Barra';
import { useSistema, usePulso } from '@/hooks/SistemaDemo';
import { BOTS, ESTRATEGIAS, MODELOS } from '@/data/mock';
import { conSigno, num, pct } from '@/lib/format';
import type { BarraFlujo, TipoEvento } from '@/lib/simulacion';

const ETIQUETA_TIPO: Record<TipoEvento, string> = { datos: 'Datos', modelo: 'Modelo', juez: 'Juez', bot: 'Bot', patron: 'Patrón' };

/** Mide el centro vertical de cada tarjeta respecto al viewport 3D (−1 abajo … 1 arriba). */
function useAnclas(centro: React.RefObject<HTMLDivElement>, tarjetas: React.MutableRefObject<(HTMLElement | null)[]>) {
  const [anclas, setAnclas] = useState<number[] | null>(null);
  const medir = useCallback(() => {
    const c = centro.current?.getBoundingClientRect();
    if (!c || c.height === 0) return;
    // Solo con las tarjetas a los lados del viewport (xl); en pantallas menores se usan anclas por defecto.
    if (window.innerWidth < 1280) {
      setAnclas(null);
      return;
    }
    const valores = tarjetas.current.map((el) => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2 - c.top;
      return Math.round((1 - (2 * y) / c.height) * 1000) / 1000;
    });
    setAnclas((prev) => (prev && prev.join() === valores.join() ? prev : valores));
  }, [centro, tarjetas]);

  useLayoutEffect(() => {
    medir();
    const ro = new ResizeObserver(medir);
    if (centro.current) ro.observe(centro.current);
    tarjetas.current.forEach((t) => t && ro.observe(t));
    window.addEventListener('resize', medir);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', medir);
    };
  }, [medir, centro, tarjetas]);
  return anclas;
}

export default function DashboardView() {
  const { mercado, motor, eventos } = useSistema();
  const centroRef = useRef<HTMLDivElement>(null);
  const izqRefs = useRef<(HTMLElement | null)[]>([]);
  const derRefs = useRef<(HTMLElement | null)[]>([]);
  const anclasIzq = useAnclas(centroRef, izqRefs);
  const anclasDer = useAnclas(centroRef, derRefs);
  const [red, setRed] = useState({ nodos: 0, sinapsis: 0 });
  const dl = MODELOS[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_280px] xl:gap-0">
        {/* IZQUIERDA — Fuentes de datos */}
        <div className="order-2 flex flex-col gap-3 xl:order-1">
          <TituloColumna>Fuentes de Datos</TituloColumna>
          <div className="flex flex-1 flex-col justify-between gap-3">
            <div ref={(el) => (izqRefs.current[0] = el)}>
              <MercadoVivo />
            </div>
            <div ref={(el) => (izqRefs.current[1] = el)}>
              <FlujoOrderFlow barras={mercado.barras} />
            </div>
            <div ref={(el) => (izqRefs.current[2] = el)}>
              <MetricasEntrada />
            </div>
          </div>
        </div>

        {/* CENTRO — Cerebro de Deep Learning */}
        <div ref={centroRef} className="relative order-1 h-[440px] sm:h-[520px] xl:order-2 xl:h-auto xl:min-h-[640px]">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 text-center">
            <p className="etiqueta flex items-center justify-center gap-2">
              <Brain size={12} /> Cerebro · Deep Learning
            </p>
            <p className="mt-1 text-[11px] text-plata-500">
              {dl.id} · {dl.familia} · {dl.detalle}
            </p>
          </div>
          <EsferaCerebro anclasIzq={anclasIzq ?? undefined} anclasDer={anclasDer ?? undefined} onListo={setRed} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden flex-wrap items-center sm:flex justify-center gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-plata-500">
            <span>Neuronas {num(red.nodos)}</span>
            <span>Sinapsis {num(red.sinapsis)}</span>
            <span>Época {Math.floor(motor.epoca)}/120</span>
            <span>Loss {num(motor.loss, 3)}</span>
            <span className="flex items-center gap-1.5 text-plata-300">
              <span className="h-1.5 w-1.5 animate-latido rounded-full bg-white" /> Aprendiendo
            </span>
          </div>
        </div>

        {/* DERECHA — Métricas del motor */}
        <div className="order-3 flex flex-col gap-3">
          <TituloColumna derecha>Métricas del Motor</TituloColumna>
          <div className="flex flex-1 flex-col justify-between gap-3">
            <div ref={(el) => (derRefs.current[0] = el)}>
              <Panel titulo="Hipótesis Generadas" icono={Lightbulb} conector="izq">
                <ContadorAnimado valor={motor.hipotesis} className="text-[34px] font-light leading-none text-white" />
                <p className="mt-2 text-[11px] text-plata-500">Propuestas por los modelos desde datos de Order Flow</p>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-borde-suave pt-3 text-[10px]">
                  <MiniDato etiqueta="En cola" valor={num(motor.cola)} />
                  <MiniDato etiqueta="Rechazadas" valor={num(motor.rechazadas)} />
                </div>
              </Panel>
            </div>
            <div ref={(el) => (derRefs.current[1] = el)}>
              <Panel titulo="Pruebas en Proceso" icono={FlaskConical} conector="izq">
                <ContadorAnimado valor={motor.pruebas} className="text-[34px] font-light leading-none text-white" />
                <p className="mt-2 text-[11px] text-plata-500">Backtest · Walk-Forward · Monte Carlo</p>
                <PruebasEnCurso />
              </Panel>
            </div>
            <div ref={(el) => (derRefs.current[2] = el)}>
              <Panel titulo="Aprobadas por el Juez" icono={Gavel} conector="izq">
                <div className="flex items-baseline justify-between">
                  <ContadorAnimado valor={motor.aprobadas} className="text-[34px] font-light leading-none text-white" />
                  <span className="cifra text-[11px] text-plata-400">{pct(motor.aprobadas / (motor.aprobadas + motor.rechazadas), 1)} de lo evaluado</span>
                </div>
                <p className="mt-2 text-[11px] text-plata-500">Reglas del Juez bloqueadas · sin intervención de los modelos</p>
                <div className="mt-3 border-t border-borde-suave pt-3">
                  <Barra valor={motor.aprobadas} max={motor.aprobadas + motor.rechazadas} marca={(motor.aprobadas / (motor.aprobadas + motor.rechazadas)) * 100} />
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </div>

      <CadenaFlujo />

      <Panel
        titulo="Registro de Eventos · Log del día"
        icono={Activity}
        accion={<Estado estado="activo" texto={`${eventos.length} eventos`} />}
      >
        <Consola lineas={eventos.map((e) => ({ id: e.id, hora: e.hora, etiqueta: ETIQUETA_TIPO[e.tipo], texto: e.texto }))} alto="h-64" />
      </Panel>
    </div>
  );
}

function TituloColumna({ children, derecha = false }: { children: string; derecha?: boolean }) {
  return <h2 className={`text-[11px] font-semibold uppercase tracking-[0.2em] text-white ${derecha ? 'xl:text-right' : ''}`}>{children}</h2>;
}

function MiniDato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="uppercase tracking-[0.12em] text-plata-600">{etiqueta}</p>
      <p className="cifra mt-0.5 text-plata-200">{valor}</p>
    </div>
  );
}

function MercadoVivo() {
  const { mercado } = useSistema();
  const previo = useRef(mercado.precio);
  const dir = mercado.precio > previo.current ? 1 : mercado.precio < previo.current ? -1 : 0;
  useEffect(() => {
    previo.current = mercado.precio;
  });
  const cambio24 = (mercado.precio - mercado.apertura24h) / mercado.apertura24h;
  const spread = 0.1;

  return (
    <Panel titulo="Mercado Vivo · Binance USD-M" icono={Radio} conector="der">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-plata-400">BTCUSDT · Perpetuo</span>
        <Estado estado={mercado.conectado ? 'activo' : 'detenido'} texto={mercado.conectado ? 'Conectado' : 'Desconectado'} />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <motion.span key={mercado.precio} initial={{ opacity: 0.55 }} animate={{ opacity: 1 }} className="cifra text-[26px] font-light text-white">
          {num(mercado.precio, 1)}
        </motion.span>
        <span className="font-mono text-xs text-plata-400">{dir > 0 ? '▲' : dir < 0 ? '▼' : '·'}</span>
      </div>
      <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-plata-400">
        <span>{conSigno(cambio24 * 100, 2, '%')} 24 h</span>
        <span>Spread {num(spread, 1)}</span>
        <span>{mercado.latenciaMs} ms</span>
      </div>
      <Sparkline datos={mercado.historial.slice(-120)} alto={36} className="mt-2" base={mercado.vwap} />
    </Panel>
  );
}

function FlujoOrderFlow({ barras }: { barras: BarraFlujo[] }) {
  const { mercado } = useSistema();
  const deltas = barras.map((b) => b.compra - b.venta);
  const ordenados = deltas.map(Math.abs).sort((a, b) => a - b);
  const max = Math.max(ordenados[Math.floor(ordenados.length * 0.85)] * 1.25, 0.5);
  const ultima = deltas[deltas.length - 1];

  return (
    <Panel titulo="Flujo Order Flow · Recorder" icono={BarChart3} conector="der">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-plata-400">Delta por dollar bar</span>
        <Estado estado={mercado.grabando ? 'activo' : 'detenido'} texto={mercado.grabando ? 'Grabando' : 'Detenido'} />
      </div>
      <div className="relative mt-3 flex h-14 items-center gap-[2px]">
        <span className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        {deltas.map((d, i) => {
          const h = `${Math.min(100, Math.max((Math.abs(d) / max) * 100, 4))}%`;
          const enCurso = i === deltas.length - 1 ? 'animate-latido' : '';
          return (
            <div key={i} className="relative flex h-full flex-1 flex-col">
              <div className="flex flex-1 items-end">
                {d >= 0 && <motion.div className={`w-full rounded-t-[1px] bg-plata-200 ${enCurso}`} animate={{ height: h }} transition={{ duration: 0.4 }} />}
              </div>
              <div className="flex flex-1 items-start">
                {d < 0 && <motion.div className={`w-full rounded-b-[1px] border border-plata-400 ${enCurso}`} animate={{ height: h }} transition={{ duration: 0.4 }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-plata-400">
        <span>Barra en curso {conSigno(ultima, 1)} BTC</span>
        <span>{num(mercado.ritmo[mercado.ritmo.length - 1], 0)} barras/min</span>
      </div>
    </Panel>
  );
}

function MetricasEntrada() {
  const { mercado } = useSistema();
  const distancia = (mercado.precio - mercado.vwap) / mercado.atr;
  const filas = [
    { k: 'VWAP', v: num(mercado.vwap, 1), n: `${conSigno(distancia, 2)} ATR` },
    { k: 'CVD Delta', v: `${conSigno(mercado.cvd, 0)} BTC`, n: 'sesión' },
    { k: 'ATR (5m)', v: `${num(mercado.atr, 1)} USD`, n: '14 periodos' },
    { k: 'Open Interest', v: `${num(mercado.oi, 0)} BTC`, n: 'perpetuo' },
  ];
  return (
    <Panel titulo="Métricas de Entrada" icono={Database} conector="der" cuerpo="px-4 py-2" accion={<span className="font-mono text-[9.5px] text-plata-500">Features</span>}>
      <dl className="divide-y divide-borde-suave">
        {filas.map((f) => (
          <div key={f.k} className="flex items-baseline justify-between gap-2 py-2">
            <dt className="text-xs text-plata-300">{f.k}</dt>
            <dd className="text-right">
              <span className="cifra text-[13px] text-white">{f.v}</span>
              <span className="ml-2 font-mono text-[9.5px] text-plata-500">{f.n}</span>
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

const TRABAJOS = [
  { id: 'Walk-Forward', ritmo: 0.9 },
  { id: 'Monte Carlo', ritmo: 1.6 },
  { id: 'Luck test', ritmo: 2.3 },
];

function PruebasEnCurso() {
  const n = usePulso(700);
  return (
    <div className="mt-3 space-y-2 border-t border-borde-suave pt-3">
      {TRABAJOS.map((t, i) => {
        const avance = ((n * t.ritmo + i * 31) % 100) + 0.0;
        return (
          <div key={t.id} className="flex items-center gap-2 text-[10px]">
            <span className="w-[74px] shrink-0 font-mono text-plata-400">{t.id}</span>
            <Barra valor={avance} tenue={i > 0} />
            <span className="cifra w-8 shrink-0 text-right text-plata-300">{Math.floor(avance)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function CadenaFlujo() {
  const { motor, mercado } = useSistema();
  const pasos = [
    { titulo: 'Fuentes de datos', dato: `${num(mercado.dollarBars)} dollar bars`, icono: Database },
    { titulo: 'Cerebro ML / DL', dato: `${num(motor.hipotesis)} hipótesis`, icono: Brain },
    { titulo: 'Juez', dato: `${motor.pruebas} en prueba · reglas bloqueadas`, icono: Gavel },
    { titulo: 'Estrategias', dato: `${ESTRATEGIAS.filter((e) => e.veredicto === 'Aprobada').length} aprobadas en biblioteca`, icono: CheckCheck },
    { titulo: 'Bots', dato: `${BOTS.filter((b) => b.estado === 'Ejecutando').length} ejecutando · Paper`, icono: Activity },
  ];
  return (
    <Panel cuerpo="px-4 py-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-5 sm:gap-0">
        {pasos.map((p, i) => {
          const Icono = p.icono;
          return (
            <div key={p.titulo} className="relative flex items-center gap-3 sm:pr-6">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-borde bg-white/[0.03]">
                <Icono size={15} strokeWidth={1.5} className="text-plata-200" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-white">{p.titulo}</p>
                <p className="cifra truncate text-[10px] text-plata-500">{p.dato}</p>
              </div>
              {i < pasos.length - 1 && (
                <div className="absolute right-1 top-1/2 hidden h-px w-5 -translate-y-1/2 overflow-hidden bg-white/10 sm:block">
                  <motion.span
                    className="absolute top-0 h-px w-2 bg-white"
                    animate={{ x: [-8, 20] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear', delay: i * 0.25 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
