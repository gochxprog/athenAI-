import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, BellRing, Brain, Compass, FlaskConical, Gauge, History, MessageSquareText, Radio, Siren, TriangleAlert } from 'lucide-react';
import EsferaCerebro from '@/components/three/EsferaCerebro';
import Panel from '@/components/ui/Panel';
import Punto, { Estado } from '@/components/ui/Punto';
import Consola from '@/components/ui/Consola';
import ResumenMercados from '@/components/orderflow/ResumenMercados';
import { useFeeds } from '@/components/orderflow/OrderFlowChart';
import { NOMBRE_REGIMEN } from '@/components/orderflow/ResumenMercados';
import { faltaPara, useCalendario } from '@/hooks/useCalendario';
import { leerEstrategias, type EstrategiaGuardada } from '@/components/laboratorio/plantillas';
import { notificador } from '@/motores/notificaciones/notificador';
import { canalesActivos } from '@/motores/notificaciones/canales';
import { senalesLaboratorio } from '@/motores/laboratorio/laboratorioCliente';
import type { SenalEstrategia } from '@/motores/laboratorio/protocolo';
import { lecturaDe } from '@/motores/investigacion/lectura';
import type { EstadoFeed, EventoMotor } from '@/motores/worker/protocolo';
import { useNavegar } from '@/hooks/Navegacion';
import type { Modulo } from '@/types/nav';
import { conSigno, hora, num } from '@/lib/format';


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

/** Estrategias del Laboratorio (guardadas en este navegador), releídas cada pocos segundos. */
function useEstrategias() {
  const [xs, setXs] = useState(leerEstrategias);
  useEffect(() => {
    const id = setInterval(() => setXs(leerEstrategias()), 5_000);
    return () => clearInterval(id);
  }, []);
  return xs;
}

/** Eventos reales de los motores en todos los mercados (sin repetir), últimos 5 min. Cada nuevo suma al contador. */
function useEventosVivos(feeds: readonly EstadoFeed[]) {
  const vistos = useRef(new Map<string, EventoMotor & { simbolo: string }>());
  const [estado, setEstado] = useState({ lista: [] as (EventoMotor & { simbolo: string })[], total: 0 });
  useEffect(() => {
    let nuevos = 0;
    for (const f of feeds)
      for (const e of f.eventos ?? []) {
        const k = `${f.simbolo}:${e.id}`;
        if (!vistos.current.has(k)) {
          vistos.current.set(k, { ...e, simbolo: f.simbolo });
          nuevos += 1;
        }
      }
    const limite = Date.now() - 5 * 60_000;
    for (const [k, e] of vistos.current) if (e.disponibleEn < limite && vistos.current.size > 40) vistos.current.delete(k);
    if (!nuevos) return;
    setEstado((p) => ({ lista: [...vistos.current.values()].sort((a, b) => b.disponibleEn - a.disponibleEn), total: p.total + nuevos }));
  }, [feeds]);
  return estado;
}

/** Mercado principal: el que se ve en el gráfico, o el primero en vivo. */
function mercadoPrincipal(feeds: readonly EstadoFeed[], visible: string | null): EstadoFeed | undefined {
  return feeds.find((f) => f.simbolo === visible && f.conexion === 'en-vivo') ?? feeds.find((f) => f.conexion === 'en-vivo') ?? feeds[0];
}

function useNotificador() {
  const [, setN] = useState(0);
  useEffect(() => notificador.suscribir(() => setN((x) => x + 1)), []);
  return notificador;
}

export default function DashboardView() {
  const { feeds, registro } = useFeeds();
  const estrategias = useEstrategias();
  const centroRef = useRef<HTMLDivElement>(null);
  const izqRefs = useRef<(HTMLElement | null)[]>([]);
  const derRefs = useRef<(HTMLElement | null)[]>([]);
  const anclasIzq = useAnclas(centroRef, izqRefs);
  const anclasDer = useAnclas(centroRef, derRefs);
  const [red, setRed] = useState({ nodos: 0, sinapsis: 0 });
  const navegar = useNavegar();
  const vivos = feeds.feeds.filter((f) => f.conexion === 'en-vivo').length;
  const eventos = useEventosVivos(feeds.feeds);

  // Registro del día: solo cosas reales (motor, conexiones, memoria y veredictos del Juez).
  const lineas = [
    ...registro.slice(0, 40).map((e, i) => ({ id: `r-${e.t}-${i}`, hora: new Date(e.t), etiqueta: 'Datos', texto: e.texto })),
    ...estrategias.filter((e) => e.ultimoVeredicto).map((e) => ({ id: `j-${e.id}`, hora: new Date(e.actualizada), etiqueta: 'Juez', texto: `«${e.nombre}»: ${e.ultimoVeredicto}` })),
  ].sort((a, b) => b.hora.getTime() - a.hora.getTime());

  const izquierda = [<TarjetaPulso key="p" />, <TarjetaSenales key="s" eventos={eventos.lista} />, <TarjetaExtremas key="x" />, <TarjetaContexto key="c" />];
  const derecha = [<TarjetaLectura key="l" />, <TarjetaGemelo key="g" />, <TarjetaEstrategias key="e" estrategias={estrategias} />, <TarjetaAlertas key="a" estrategias={estrategias} />];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[236px_minmax(0,1fr)_236px] xl:gap-0">
        {/* IZQUIERDA — lo que entra */}
        <div className="order-2 flex flex-col gap-2 xl:order-1">
          <TituloColumna>Lo que siente</TituloColumna>
          <div className="flex flex-1 flex-col justify-between gap-2">
            {izquierda.map((t, i) => (
              <div key={i} ref={(el) => (izqRefs.current[i] = el)}>
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* CENTRO — Cerebro */}
        <div ref={centroRef} className="relative order-1 h-[440px] sm:h-[520px] xl:order-2 xl:h-auto xl:min-h-[600px]">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 text-center">
            <p className="etiqueta flex items-center justify-center gap-2">
              <Brain size={12} /> Cerebro · {vivos ? `${vivos} ${vivos === 1 ? 'mercado' : 'mercados'} en vivo` : 'sin datos'}
            </p>
            <p className="mt-1 text-[11px] text-plata-500">Cada golpe fuerte es un evento real de los motores · {num(eventos.total)} desde que abriste</p>
          </div>
          <EsferaCerebro anclasIzq={anclasIzq ?? undefined} anclasDer={anclasDer ?? undefined} actividad={vivos ? 1 : 0.25} eventos={eventos.total} onListo={setRed} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-plata-500 sm:flex">
            <span>Nodos {num(red.nodos)}</span>
            <span>Sinapsis {num(red.sinapsis)}</span>
            <span>{num(feeds.feeds.reduce((a, f) => a + f.filas, 0))} filas de Features hoy</span>
            <span className="flex items-center gap-1.5 text-plata-300">
              <Punto estado={vivos ? 'activo' : 'detenido'} /> {vivos ? 'Grabando' : 'En espera'}
            </span>
          </div>
        </div>

        {/* DERECHA — lo que sale */}
        <div className="order-3 flex flex-col gap-2">
          <TituloColumna derecha>Lo que concluye</TituloColumna>
          <div className="flex flex-1 flex-col justify-between gap-2">
            {derecha.map((t, i) => (
              <div key={i} ref={(el) => (derRefs.current[i] = el)}>
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="space-y-2">
        <TituloColumna>Mercados · de un vistazo</TituloColumna>
        <ResumenMercados alElegir={() => navegar('orderflow')} />
      </section>

      <Panel titulo="Registro del día" icono={Activity} accion={<Estado estado={vivos ? 'activo' : 'detenido'} texto={`${lineas.length} entradas`} />}>
        <Consola lineas={lineas} alto="h-64" />
      </Panel>
    </div>
  );
}

function TituloColumna({ children, derecha = false }: { children: string; derecha?: boolean }) {
  return <h2 className={`text-[11px] font-semibold uppercase tracking-[0.2em] text-white ${derecha ? 'xl:text-right' : ''}`}>{children}</h2>;
}

/** Tarjeta compacta: título, dato principal y unas pocas líneas. */
function Mini({ titulo, icono: Icono, destino, conector, principal, nota, children }: { titulo: string; icono: typeof Radio; destino: Modulo; conector: 'izq' | 'der'; principal: React.ReactNode; nota?: React.ReactNode; children?: React.ReactNode }) {
  const navegar = useNavegar();
  return (
    <Panel titulo={titulo} icono={Icono} conector={conector} onClick={() => navegar(destino)} cuerpo="px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-light leading-tight text-white ${typeof principal === 'string' && principal.length > 12 ? 'text-[13px]' : 'cifra text-lg leading-none'}`}>{principal}</span>
        {nota && <span className="shrink-0 truncate text-right text-[9.5px] text-plata-500">{nota}</span>}
      </div>
      {children && <div className="mt-2 space-y-0.5 text-[10px]">{children}</div>}
    </Panel>
  );
}

function Linea({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-plata-400">{k}</span>
      <span className="cifra shrink-0 text-plata-100">{v}</span>
    </div>
  );
}

const NOMBRE_EVENTO: Record<EventoMotor['tipo'], string> = {
  absorcion: 'Absorción',
  agotamiento: 'Agotamiento',
  iceberg: 'Iceberg',
  stoprun: 'Stop run',
  bigtrade: 'Big trade',
  'pool-barrido': 'Pool barrido',
  liquidacion: 'Liquidación',
};

const corto = (s: string) => s.replace(/USDT$|USD$/, '');

/** Barra divergente −1 … 1 (izquierda vende, derecha compra). */
function Balanza({ v }: { v: number }) {
  const x = Math.max(-1, Math.min(1, v));
  return (
    <span className="relative inline-block h-1.5 w-14 rounded-full bg-white/10">
      <span className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
      <span className="absolute inset-y-0 rounded-full bg-white/80" style={x >= 0 ? { left: '50%', width: `${x * 50}%` } : { right: '50%', width: `${-x * 50}%` }} />
    </span>
  );
}

function MiniLinea({ serie }: { serie: number[] }) {
  if (serie.length < 2) return null;
  const min = Math.min(...serie);
  const max = Math.max(...serie);
  const d = serie.map((v, i) => `${(i / (serie.length - 1)) * 40},${max > min ? 10 - ((v - min) / (max - min)) * 10 : 5}`).join(' ');
  return (
    <svg width="40" height="11" viewBox="-1 -1 42 12" className="shrink-0">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1" className="text-plata-300" />
    </svg>
  );
}

const presionDe = (f: EstadoFeed) => {
  const b = f.resumen.barrasFlujo.slice(-5);
  const c = b.reduce((a, x) => a + x.compra, 0);
  const v = b.reduce((a, x) => a + x.venta, 0);
  return c + v > 0 ? (c - v) / (c + v) : 0;
};

// --- Lo que siente -------------------------------------------------------------

function TarjetaPulso() {
  const { feeds } = useFeeds();
  const m = mercadoPrincipal(feeds.feeds, feeds.visible);
  const p = m ? presionDe(m) : 0;
  return (
    <Mini titulo="Pulso del flujo" icono={Gauge} destino="orderflow" conector="der" principal={m?.conexion === 'en-vivo' ? conSigno(p * 100, 0, ' %') : '—'} nota={m ? `presión ${corto(m.simbolo)} · 5 barras` : 'sin mercados'}>
      {feeds.feeds.slice(0, 3).map((f) => (
        <Linea
          key={f.simbolo}
          k={
            <span className="flex items-center gap-1.5">
              <span className="w-10 font-mono">{corto(f.simbolo)}</span>
              <Balanza v={presionDe(f)} />
            </span>
          }
          v={`${num(f.tradesPorSeg, 0)} t/s · CVD ${f.cvdVelocidad === null ? '…' : conSigno(f.cvdVelocidad, Math.abs(f.cvdVelocidad) < 10 ? 1 : 0)}`}
        />
      ))}
      {!feeds.feeds.length && <p className="text-plata-500">Conecta un mercado en el Centro de datos.</p>}
    </Mini>
  );
}

function TarjetaSenales({ eventos }: { eventos: (EventoMotor & { simbolo: string })[] }) {
  const ultimo = eventos[0];
  return (
    <Mini titulo="Señales en vivo" icono={Radio} destino="orderflow" conector="der" principal={num(eventos.length)} nota="eventos de los motores · 5 min">
      {eventos.slice(0, 4).map((e) => (
        <Linea key={`${e.simbolo}${e.id}`} k={`${hora(new Date(e.disponibleEn))} ${corto(e.simbolo)} · ${NOMBRE_EVENTO[e.tipo]} ${e.lado}`} v={e.tipo === 'bigtrade' || e.tipo === 'liquidacion' ? `$${num(e.magnitud / 1000, 0)}k` : num(e.magnitud, 0)} />
      ))}
      {!ultimo && <p className="text-plata-500">Aún no hay eventos. Cada uno golpea el cerebro.</p>}
    </Mini>
  );
}

function TarjetaExtremas() {
  const { feeds } = useFeeds();
  const m = mercadoPrincipal(feeds.feeds, feeds.visible);
  const xs = m?.extremas ?? [];
  return (
    <Mini titulo="Fuera de lo normal" icono={TriangleAlert} destino="investigacion" conector="der" principal={xs.length ? `${num(Math.abs(xs[0].z), 1)} σ` : '—'} nota={m ? `${corto(m.simbolo)} · última barra` : ''}>
      {xs.map((x) => (
        <Linea
          key={x.clave}
          k={
            <span className="flex items-center gap-1.5">
              <MiniLinea serie={x.serie} />
              <span className="truncate">{x.nombre}</span>
            </span>
          }
          v={`${conSigno(x.z, 1)}σ · p${Math.round(x.percentil * 100)}`}
        />
      ))}
      {!xs.length && <p className="text-plata-500">Necesita ~30 barras para comparar.</p>}
    </Mini>
  );
}

function TarjetaContexto() {
  const { feeds } = useFeeds();
  const { proximo, enCurso, ahora } = useCalendario();
  const distintos = feeds.feeds.filter((f) => f.memoria?.memoria?.distinto.aviso);
  const e = enCurso ?? proximo;
  return (
    <Mini titulo="Contexto" icono={Compass} destino="datos" conector="der" principal={enCurso ? 'No operar' : distintos.length ? 'Hoy es distinto' : 'Normal'} nota={distintos.map((f) => corto(f.simbolo)).join(', ')}>
      {feeds.feeds.slice(0, 3).map((f) => {
        const r = f.memoria?.regimen;
        return <Linea key={f.simbolo} k={<span className="font-mono">{corto(f.simbolo)}</span>} v={r ? `${NOMBRE_REGIMEN[r.actual]} ${num(r.probabilidades[r.actual] * 100, 0)} %` : f.memoria?.faltan ? 'faltan datos' : '…'} />;
      })}
      {e && <Linea k={e.nombre} v={enCurso ? 'ventana activa' : faltaPara(e.t, ahora)} />}
    </Mini>
  );
}

// --- Lo que concluye ----------------------------------------------------------

function TarjetaLectura() {
  const { feeds } = useFeeds();
  const ahora = Date.now();
  const m = mercadoPrincipal(feeds.feeds, feeds.visible);
  const l = m ? lecturaDe(m, ahora) : null;
  return (
    <Mini titulo="Lectura del momento" icono={MessageSquareText} destino="orderflow" conector="izq" principal={l ? l.titular : '—'} nota={m ? corto(m.simbolo) : ''}>
      {l?.motivos.slice(0, 2).map((t) => <p key={t} className="truncate text-plata-400">{t}</p>)}
      {feeds.feeds
        .filter((f) => f !== m)
        .slice(0, 2)
        .map((f) => (
          <Linea key={f.simbolo} k={<span className="font-mono">{corto(f.simbolo)}</span>} v={lecturaDe(f, ahora).titular} />
        ))}
    </Mini>
  );
}

function TarjetaGemelo() {
  const { feeds } = useFeeds();
  const m = mercadoPrincipal(feeds.feeds, feeds.visible);
  const mem = m?.memoria?.memoria;
  const r = mem?.resumen;
  return (
    <Mini titulo="Memoria · día gemelo" icono={History} destino="orderflow" conector="izq" principal={r && mem ? `${r.subieron}/${mem.gemelos.length} subieron` : '—'} nota={m ? corto(m.simbolo) : ''}>
      {r ? (
        <>
          <Linea k="Mediana 20 barras después" v={conSigno(r.retornoMediano * 100, 2, ' %')} />
          <Linea k="Parecido a hoy" v={`p${Math.round((mem?.distinto.percentil ?? 0) * 100)}`} />
        </>
      ) : (
        <p className="text-plata-500">{m?.memoria?.faltan ?? 'Se calcula con lo grabado (cada 2 min).'}</p>
      )}
    </Mini>
  );
}

const NOMBRE_POS = (p: number | null) => (p === null ? '—' : p > 0 ? 'Largo' : p < 0 ? 'Corto' : 'Fuera');

/** Señal actual de las estrategias juzgadas (aprobadas primero), recalculada como mucho cada 30 s. */
function useSenales(estrategias: EstrategiaGuardada[]) {
  const [senales, setSenales] = useState<Map<string, SenalEstrategia>>(new Map());
  const juzgadas = estrategias
    .filter((e) => e.juzgada)
    .sort((a, b) => Number(b.ultimoVeredicto === 'APROBADA') - Number(a.ultimoVeredicto === 'APROBADA'))
    .slice(0, 4);
  const clave = juzgadas.map((e) => `${e.id}:${e.actualizada}`).join('|');
  useEffect(() => {
    if (!juzgadas.length) return;
    let vivo = true;
    const pedir = () =>
      senalesLaboratorio
        .senales(juzgadas.map((e) => ({ id: e.id, codigo: e.codigo, combo: e.juzgada!.combo, proveedor: e.juzgada!.proveedor, simbolo: e.juzgada!.simbolo })))
        .then((xs) => vivo && setSenales(new Map(xs.map((x) => [x.id, x]))));
    void pedir();
    const id = setInterval(pedir, 30_000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [clave]); // eslint-disable-line react-hooks/exhaustive-deps
  return { juzgadas, senales };
}

function TarjetaEstrategias({ estrategias }: { estrategias: EstrategiaGuardada[] }) {
  const { juzgadas, senales } = useSenales(estrategias);
  const aprobadas = juzgadas.filter((e) => e.ultimoVeredicto === 'APROBADA');
  const dentro = juzgadas.filter((e) => (senales.get(e.id)?.posicion ?? 0) !== 0).length;
  return (
    <Mini titulo="Tus estrategias ahora" icono={FlaskConical} destino="laboratorio" conector="izq" principal={juzgadas.length ? `${dentro}/${juzgadas.length}` : '—'} nota={juzgadas.length ? `en posición · ${aprobadas.length} aprobadas` : 'ninguna juzgada'}>
      {juzgadas.map((e) => {
        const s = senales.get(e.id);
        return (
          <Linea
            key={e.id}
            k={
              <span title={s?.error}>
                {e.ultimoVeredicto === 'APROBADA' ? '✓ ' : '· '}
                {e.nombre} <span className="text-plata-500">{corto(e.juzgada!.simbolo)}</span>
              </span>
            }
            v={s ? (s.error ? 'error' : NOMBRE_POS(s.posicion)) : '…'}
          />
        );
      })}
      {!juzgadas.length && <p className="text-plata-500">Prueba una estrategia con el Juez y aquí verás su señal en vivo.</p>}
      {juzgadas.length > 0 && !aprobadas.length && <p className="text-plata-500">Ninguna aprobada: señales solo informativas.</p>}
    </Mini>
  );
}

function TarjetaAlertas({ estrategias }: { estrategias: EstrategiaGuardada[] }) {
  const n = useNotificador();
  const canales = canalesActivos(n.config);
  const lineas = [
    ...n.historial.filter((x) => x.aviso.tipo !== 'juez').slice(0, 6).map((x) => ({ t: x.t, texto: x.aviso.titulo, v: x.canal ? (x.ok ? '✓' : '✗') : '—' })),
    ...estrategias.filter((e) => e.ultimoVeredicto).map((e) => ({ t: e.actualizada, texto: `Juez: «${e.nombre}»`, v: e.ultimoVeredicto === 'APROBADA' ? 'aprobada' : e.ultimoVeredicto === 'APROBADA CON RESERVA' ? 'reserva' : e.ultimoVeredicto === 'RECHAZADA' ? 'rechazada' : 'insuf.' })),
  ]
    .sort((a, b) => b.t - a.t)
    .slice(0, 4);
  return (
    <Mini titulo="Alertas" icono={canales.length ? BellRing : Siren} destino="datos" conector="izq" principal={num(n.historial.filter((x) => x.ok).length)} nota={canales.length ? `enviadas · ${canales.join(' · ')}` : 'sin canales · configúralos'}>
      {lineas.map((x, i) => (
        <Linea key={i} k={`${hora(new Date(x.t))} ${x.texto}`} v={x.v} />
      ))}
      {!lineas.length && <p className="text-plata-500">Sin alertas todavía.</p>}
    </Mini>
  );
}
