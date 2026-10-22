// Panel general (v2): lo que pasa ahora, con datos reales de la grabadora. En el centro, el cerebro (machine learning)
// con el ojo: cada fila nueva que graba el VPS es un golpe. Alrededor, el anillo de agentes y los hilos a las tarjetas.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { AGENTES, ESTILO_AGENTE } from '@/data/agentes';
import { deHoy, movimientos, useVps, type Fila, type Vps } from '../vps';
import Hilos from './Hilos';
import './panel.css';

const Cerebro = lazy(() => import('@/components/three/EsferaCerebro'));
/** Días de datos con los que el machine learning empieza a aprender algo (docs/CROQUIS.md §5). */
const DIAS_ML = 60;

const num = (v: number, d = 0) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const corto = (s: string) => s.replace(/USDT$/, '');

function saludo(v: Vps) {
  const h = new Date().getHours();
  const hola = h < 12 ? 'Buenos días.' : h < 19 ? 'Buenas tardes.' : 'Buenas noches.';
  if (v.sinSesion) return `${hola} Entra con tu clave para ver tus datos.`;
  if (v.caido) return `${hola} La grabadora no responde.`;
  const caidos = v.mercados.filter((m) => m.conexion !== 'en-vivo');
  return `${hola} ${!v.mercados.length ? 'Conectando…' : caidos.length ? `${caidos.map((m) => corto(m.simbolo)).join(' y ')} sin conexión.` : 'Todo está grabando.'}`;
}

function Linea({ filas }: { filas: Fila[] }) {
  const c = filas.slice(-60).map((f) => f.close);
  if (c.length < 2) return <svg className="linea" />;
  const [lo, hi] = [Math.min(...c), Math.max(...c)];
  const pts = c.map((v, i) => `${(i / (c.length - 1)) * 100},${hi > lo ? 22 - ((v - lo) / (hi - lo)) * 20 : 12}`).join(' ');
  return <svg className="linea" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points={pts} /></svg>;
}

const Tarjeta = ({ titulo, valor, nota, barra, lado, children }: { titulo: string; valor: string; nota?: string; barra?: number; lado?: 'izq' | 'der'; children?: ReactNode }) => (
  <div className={`tarjeta ${lado ?? ''}`}>
    <span className="et">{titulo}</span>
    <div className="fila"><span className="valor cifra">{valor}</span>{nota && <span className="nota">{nota}</span>}</div>
    {children}
    {barra !== undefined && <div className="barra"><i style={{ width: `${Math.min(100, barra * 100)}%` }} /></div>}
  </div>
);

/** El cerebro (three.js, ~500 KB) entra después del primer pintado: las tarjetas salen al instante. */
function useDespues() {
  const [ya, setYa] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setTimeout(() => setYa(true), 60));
    return () => cancelAnimationFrame(id);
  }, []);
  return ya;
}

export default function Panel() {
  const v = useVps();
  const cerebroListo = useDespues();
  const filas = v.almacen.reduce((s, a) => s + a.filas, 0);
  const desde = Math.min(...v.almacen.map((a) => a.desde ?? Infinity));
  const dias = Number.isFinite(desde) ? (Date.now() - desde) / 86_400_000 : 0;
  const historia = v.historia.reduce((s, h) => s + h.dias, 0);
  const vivos = v.mercados.filter((m) => m.conexion === 'en-vivo').length;
  const activos = v.bots.filter((b) => b.estado === 'activo').length;
  const hoy = deHoy(v.ops);
  const pnl = hoy.reduce((s, o) => s + o.pnl, 0);
  // Encendido solo el agente que el orquestador del VPS ve trabajando de verdad.
  const trabajando = Object.fromEntries((v.agentes?.agentes ?? []).map((a) => [a.id, a.estado === 'trabajando']));
  const agentes = AGENTES.map((a) => ({ nombre: a.nombre, activo: !!trabajando[a.id], color: ESTILO_AGENTE[a.id].color }));

  return (
    <div className="panel">
      <div>
        <div className="et">Panel general · lo que está pasando ahora</div>
        <h1>{saludo(v)}</h1>
      </div>
      <div className="kpis">
        <Tarjeta titulo="Filas grabadas" valor={num(filas)} nota={`${v.almacen.length} mercados · ${num(dias, 1)} días`} />
        <Tarjeta titulo="Historia importada" valor={`${historia} d`} nota={historia ? `BTC desde ${v.historia[0]?.desde}` : 'sin importar · importar.sh'} />
        <Tarjeta titulo="Mercados en vivo" valor={`${vivos}/${v.mercados.length}`} nota={`${v.mercados.reduce((s, m) => s + m.cortes, 0)} cortes en la sesión`} />
        <Tarjeta titulo="Bots en Paper" valor={`${activos}/${v.bots.length}`} nota={`${hoy.length} operaciones hoy`} />
        <Tarjeta titulo="Paper hoy" valor={`${pnl >= 0 ? '+' : ''}${num(pnl, 2)} $`} nota="sin dinero real" />
      </div>

      <section className="escena caja">
        <div className="cerebro">
          <Suspense fallback={null}>
            {cerebroListo && <Cerebro ojo haces={false} eventos={filas} actividad={vivos ? 1 : 0.25} />}
          </Suspense>
        </div>
        <Hilos agentes={agentes} pulsos={filas} />
        <div className="col izq">
          {v.mercados.map((m) => {
            const f = v.filas[m.simbolo] ?? [];
            const ult = f.at(-1);
            const cambio = f.length > 1 ? (ult!.close / f[0].close - 1) * 100 : null;
            return (
              <Tarjeta key={m.simbolo} lado="izq" titulo={`Binance · ${m.simbolo}`} valor={ult ? num(ult.close, ult.close < 100 ? 4 : 1) : '—'} nota={cambio === null ? m.conexion : `${cambio >= 0 ? '▲' : '▼'} ${num(Math.abs(cambio), 2)} % · 30 min`}>
                <Linea filas={f} />
              </Tarjeta>
            );
          })}
          <Tarjeta lado="izq" titulo="Historia · Binance" valor={`${historia} días`} nota={v.historia.some((h) => h.importando) ? 'importando…' : historia ? `hasta ${v.historia[0]?.hasta}` : 'sin importar'} barra={historia / 365} />
        </div>
        <div className="col der">
          <Tarjeta lado="der" titulo="Machine learning · sin entrenar" valor={`${num(Math.min(100, (dias / DIAS_ML) * 100))} %`} nota={`${num(dias, 1)} de ${DIAS_ML} días`} barra={dias / DIAS_ML} />
          <Tarjeta lado="der" titulo="Juez" valor="✓" nota="en el Laboratorio" barra={1} />
          <Tarjeta lado="der" titulo="Bots en Paper" valor={String(activos)} nota={`${hoy.length} operaciones hoy`} barra={v.bots.length ? activos / v.bots.length : 0} />
        </div>
      </section>

      <div className="abajo-panel">
        <section className="caja bloque">
          <div className="et">Camino de la estrategia</div>
          <div className="estaciones">
            {([['01 Laboratorio', '✓', 'activo'], ['02 Juez', '✓', 'activo'], ['03 Biblioteca', '✓', 'activa'], ['04 Paper', String(v.bots.length), 'bots'], ['05 Real', '—', 'sin broker']] as const).map(([t, n, s], i) => (
              <div key={t} className={`estacion ${i === 3 && v.bots.length ? 'on' : ''} ${i === 4 ? 'bloq' : ''}`}>
                <span className="et">{t}</span><b className="cifra">{n}</b><small>{s}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="caja bloque registro mono">
          <div className="et">Registro del día</div>
          {movimientos(v).slice(0, 6).map((m, i) => (
            <div key={i}><b>{m.t ? new Date(m.t).toLocaleTimeString('es-ES') : '—'}</b> <span className="quien">{m.quien}</span> {m.texto}</div>
          ))}
        </section>
      </div>
    </div>
  );
}
