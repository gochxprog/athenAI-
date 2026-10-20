import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, BellRing, Bot as IconoBot, Brain, CalendarClock, Cpu, Gavel, HardDrive, Radio, ScanSearch } from 'lucide-react';
import EsferaCerebro from '@/components/three/EsferaCerebro';
import Panel from '@/components/ui/Panel';
import Punto, { Estado } from '@/components/ui/Punto';
import Consola from '@/components/ui/Consola';
import ResumenMercados from '@/components/orderflow/ResumenMercados';
import { NOMBRE_PROVEEDOR, useEstadoMotor, useFeeds } from '@/components/orderflow/OrderFlowChart';
import { NOMBRE_REGIMEN } from '@/components/orderflow/ResumenMercados';
import { faltaPara, useCalendario } from '@/hooks/useCalendario';
import { leerEstrategias } from '@/components/laboratorio/plantillas';
import { notificador } from '@/motores/notificaciones/notificador';
import { canalesActivos } from '@/motores/notificaciones/canales';
import { useNavegar } from '@/hooks/Navegacion';
import type { Modulo } from '@/types/nav';
import { AGENTES } from '@/data/mock';
import { decimalesDe, hora, num } from '@/lib/format';


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

  // Registro del día: solo cosas reales (motor, conexiones, memoria y veredictos del Juez).
  const lineas = [
    ...registro.slice(0, 40).map((e, i) => ({ id: `r-${e.t}-${i}`, hora: new Date(e.t), etiqueta: 'Datos', texto: e.texto })),
    ...estrategias.filter((e) => e.ultimoVeredicto).map((e) => ({ id: `j-${e.id}`, hora: new Date(e.actualizada), etiqueta: 'Juez', texto: `«${e.nombre}»: ${e.ultimoVeredicto}` })),
  ].sort((a, b) => b.hora.getTime() - a.hora.getTime());

  const izquierda = [<TarjetaMercados key="m" />, <TarjetaGrabacion key="g" />, <TarjetaMemoria key="r" />, <TarjetaEvento key="e" />];
  const derecha = [<TarjetaLaboratorio key="l" />, <TarjetaAgentes key="a" />, <TarjetaAvisos key="n" />, <TarjetaMotor key="s" />];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[236px_minmax(0,1fr)_236px] xl:gap-0">
        {/* IZQUIERDA — lo que entra */}
        <div className="order-2 flex flex-col gap-2 xl:order-1">
          <TituloColumna>Lo que entra</TituloColumna>
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
            <p className="mt-1 text-[11px] text-plata-500">Cada golpe es un dato que entra o una señal que sale · la red neuronal real llega en el Bloque D</p>
          </div>
          <EsferaCerebro anclasIzq={anclasIzq ?? undefined} anclasDer={anclasDer ?? undefined} actividad={vivos ? 1 : 0.25} onListo={setRed} />
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
          <TituloColumna derecha>Lo que sale</TituloColumna>
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
        <span className="cifra text-lg font-light leading-none text-white">{principal}</span>
        {nota && <span className="truncate text-right text-[9.5px] text-plata-500">{nota}</span>}
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

function TarjetaMercados() {
  const { feeds } = useFeeds();
  const vivos = feeds.feeds.filter((f) => f.conexion === 'en-vivo').length;
  return (
    <Mini titulo="Mercados" icono={Radio} destino="datos" conector="der" principal={`${vivos}/${feeds.feeds.length}`} nota="en vivo">
      {feeds.feeds.slice(0, 4).map((f) => (
        <Linea
          key={f.simbolo}
          k={
            <span className="flex items-center gap-1.5">
              <Punto estado={f.conexion === 'en-vivo' ? 'activo' : f.conexion === 'error' || f.conexion === 'detenido' ? 'detenido' : 'espera'} />
              <span className="font-mono">{f.simbolo}</span>
            </span>
          }
          v={f.resumen.precio === null ? '—' : num(f.resumen.precio, decimalesDe(f.tickSize))}
        />
      ))}
      {!feeds.feeds.length && <p className="text-plata-500">Configúralos en el Centro de datos.</p>}
    </Mini>
  );
}

function TarjetaGrabacion() {
  const { feeds } = useFeeds();
  const filas = feeds.feeds.reduce((a, f) => a + f.filas, 0);
  const ritmo = feeds.feeds.reduce((a, f) => a + (f.ritmo[f.ritmo.length - 1] ?? 0), 0);
  const cortes = feeds.feeds.reduce((a, f) => a + f.cortes, 0);
  const guardando = feeds.feeds.filter((f) => f.guardando).length;
  return (
    <Mini titulo="Grabación" icono={HardDrive} destino="datos" conector="der" principal={num(filas)} nota="filas en esta sesión">
      <Linea k="Ritmo" v={`${num(ritmo, 0)} barras/min`} />
      <Linea k="Guardando" v={`${guardando}/${feeds.feeds.length} mercados`} />
      <Linea k="Cortes" v={num(cortes)} />
      <Linea k="Carpetas" v={feeds.proveedores.map((p) => NOMBRE_PROVEEDOR[p].split(' ')[0]).join(' · ') || '—'} />
    </Mini>
  );
}

function TarjetaMemoria() {
  const { feeds } = useFeeds();
  const distintos = feeds.feeds.filter((f) => f.memoria?.memoria?.distinto.aviso);
  return (
    <Mini titulo="Memoria del mercado" icono={ScanSearch} destino="orderflow" conector="der" principal={distintos.length ? 'Hoy es distinto' : 'Normal'} nota={distintos.map((f) => f.simbolo).join(', ')}>
      {feeds.feeds.slice(0, 4).map((f) => {
        const r = f.memoria?.regimen;
        return <Linea key={f.simbolo} k={<span className="font-mono">{f.simbolo}</span>} v={r ? `${NOMBRE_REGIMEN[r.actual]} ${num(r.probabilidades[r.actual] * 100, 0)} %` : f.memoria?.faltan ? 'faltan datos' : '…'} />;
      })}
    </Mini>
  );
}

function TarjetaEvento() {
  const { proximo, enCurso, ahora } = useCalendario();
  const e = enCurso ?? proximo;
  return (
    <Mini titulo="Próximo evento" icono={CalendarClock} destino="datos" conector="der" principal={enCurso ? 'No operar' : e ? faltaPara(e.t, ahora).replace(/^en /, '') : '—'} nota={enCurso ? 'ventana activa' : e ? 'para' : 'sin eventos'}>
      {e && <Linea k={e.nombre} v={new Date(e.t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} />}
      {e && <Linea k="Ventana" v={`−${e.antesMin} / +${e.despuesMin} min`} />}
    </Mini>
  );
}

function TarjetaLaboratorio() {
  const xs = useEstrategias();
  const juzgadas = xs.filter((x) => x.ultimoVeredicto);
  const aprobadas = juzgadas.filter((x) => x.ultimoVeredicto === 'APROBADA').length;
  const ultima = [...juzgadas].sort((a, b) => b.actualizada - a.actualizada)[0];
  return (
    <Mini titulo="Laboratorio · Juez" icono={Gavel} destino="laboratorio" conector="izq" principal={`${aprobadas}/${juzgadas.length}`} nota="aprobadas / juzgadas">
      <Linea k="Estrategias" v={num(xs.length)} />
      <Linea k="Variantes probadas" v={num(xs.reduce((a, x) => a + x.ensayos, 0))} />
      {ultima && <Linea k={`«${ultima.nombre}»`} v={ultima.ultimoVeredicto} />}
    </Mini>
  );
}

function TarjetaAgentes() {
  const reales = AGENTES.filter((a) => a.real);
  return (
    <Mini titulo="Agentes" icono={IconoBot} destino="agentes" conector="izq" principal={`${reales.length}/${AGENTES.length}`} nota="con motor real">
      <p className="text-plata-300">{reales.map((a) => a.nombre).join(' · ')}</p>
      <p className="text-plata-500">Pendientes: {AGENTES.filter((a) => !a.real).map((a) => `${a.nombre} (${a.bloque})`).join(' · ')}</p>
    </Mini>
  );
}

function TarjetaAvisos() {
  const n = useNotificador();
  const canales = canalesActivos(n.config);
  const ultimo = n.historial[0];
  return (
    <Mini titulo="Notificaciones" icono={BellRing} destino="datos" conector="izq" principal={canales.length ? canales.length : 'Off'} nota={canales.length ? canales.join(' · ') : 'configura Discord / Telegram'}>
      {ultimo ? <Linea k={ultimo.aviso.titulo} v={`${ultimo.ok ? '✓' : '✗'} ${hora(new Date(ultimo.t))}`} /> : <p className="text-plata-500">Sin envíos todavía.</p>}
      <Linea k="Enviados" v={num(n.historial.filter((x) => x.ok).length)} />
    </Mini>
  );
}

function TarjetaMotor() {
  const { estado, msProceso } = useEstadoMotor();
  const { feeds } = useFeeds();
  const lat = feeds.feeds.map((f) => f.latenciaMs).filter((x): x is number => x !== null);
  return (
    <Mini titulo="Salud del motor" icono={Cpu} destino="orderflow" conector="izq" principal={`${num(msProceso, 1)} ms`} nota="de cálculo cada 200 ms">
      <Linea k="Latencia media" v={lat.length ? `${num(lat.reduce((a, b) => a + b, 0) / lat.length)} ms` : '—'} />
      <Linea k="Trades en cinta" v={estado ? num(estado.memoria.cinta ?? 0) : '—'} />
      <Linea k="Filas por escribir" v={num(feeds.enCola)} />
    </Mini>
  );
}
