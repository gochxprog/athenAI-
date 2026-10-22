// Biblioteca (v2): todas las pruebas del Laboratorio, aprobadas o no, con los intentos totales a la vista (probar
// muchas ideas y quedarse con la que salió bien también es sobreajuste). Una aprobada pasa a Paper desde aquí.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { BookMarked, Bot, FlaskConical, Search, Trash2 } from 'lucide-react';
import type { EntradaBiblioteca, ResultadoPrueba, Trabajo } from '@/motores/laboratorio/prueba';
import { pedir } from '../../api';
import { CLAVE_LAB } from '../laboratorio/api';
import '../laboratorio/lab.css';
import './biblioteca.css';

const Resultado = lazy(() => import('../laboratorio/Resultado'));
const FILTROS = ['Todas', 'Aprobadas', 'Rechazadas'] as const;
const aprobada = (e: EntradaBiblioteca) => e.veredicto.startsWith('APROBADA');
const pct = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: d })} %`);
const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Biblioteca() {
  const [datos, setDatos] = useState<{ entradas: EntradaBiblioteca[]; intentos: number } | null>(null);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>('Todas');
  const [busca, setBusca] = useState('');
  const [abierta, setAbierta] = useState<{ id: string; r: ResultadoPrueba | null } | null>(null);
  const [aPaper, setAPaper] = useState<{ id: string; capital: number; exposicion: number; msg: string } | null>(null);

  const cargar = useCallback(() => pedir<{ entradas: EntradaBiblioteca[]; intentos: number }>('/api/biblioteca').then(setDatos, (e: Error) => setError(e.message)), []);
  useEffect(() => void cargar(), [cargar]);

  const lista = useMemo(
    () => (datos?.entradas ?? []).filter((e) => (filtro === 'Todas' || aprobada(e) === (filtro === 'Aprobadas')) && `${e.nombre} ${e.simbolo}`.toLowerCase().includes(busca.toLowerCase())),
    [datos, filtro, busca],
  );
  const n = datos?.entradas ?? [];

  const ver = async (e: EntradaBiblioteca) => {
    if (abierta?.id === e.id) return setAbierta(null);
    setAbierta({ id: e.id, r: null });
    try {
      setAbierta({ id: e.id, r: await pedir<ResultadoPrueba>(`/api/biblioteca/resultado?id=${e.id}`) });
    } catch (err) {
      setError((err as Error).message);
      setAbierta(null);
    }
  };
  // Lleva el código al Laboratorio (para cambiarlo y volver a probarlo: será un intento más).
  const alLab = (e: EntradaBiblioteca) => {
    try {
      localStorage.setItem(CLAVE_LAB, JSON.stringify({ nombre: e.nombre, codigo: e.codigo, serie: e.serie, fuente: e.fuente }));
    } catch {
      // sin almacenamiento: el Laboratorio abre con su plantilla
    }
    location.hash = '/laboratorio';
  };
  const mandar = async () => {
    if (!aPaper) return;
    try {
      await pedir('/api/biblioteca/paper', aPaper);
      setAPaper(null);
      await cargar();
    } catch (e) {
      setAPaper({ ...aPaper, msg: (e as Error).message });
    }
  };
  const borrar = async (e: EntradaBiblioteca) => {
    if (!confirm(`¿Borrar «${e.nombre}» de la Biblioteca? El intento sigue contado.`)) return;
    await pedir('/api/biblioteca/borrar', { id: e.id }).catch((x: Error) => setError(x.message));
    await cargar();
  };

  return (
    <div className="bib">
      <div>
        <div className="et">Biblioteca · cada prueba cuenta</div>
        <h1>Todo lo que probó el Juez. Lo aprobado pasa a Paper.</h1>
      </div>
      <div className="kpis-bib">
        {([['Pruebas guardadas', n.length], ['Intentos contados', datos?.intentos ?? 0], ['Aprobadas', n.filter(aprobada).length], ['En Paper', n.filter((e) => e.botId).length]] as const).map(([k, v]) => (
          <div key={k} className="caja dato"><span className="et">{k}</span><b className="cifra">{v.toLocaleString('es-ES')}</b></div>
        ))}
      </div>
      <div className="barra-bib">
        <div className="seg">{FILTROS.map((f) => <button key={f} className={f === filtro ? 'sel' : ''} onClick={() => setFiltro(f)}>{f}</button>)}</div>
        <label className="busca"><Search size={13} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o mercado" /></label>
      </div>
      {error && <pre className="error-lab">{error}</pre>}
      {datos && !lista.length && (
        <div className="caja vacia-bib"><BookMarked size={18} /><p>{n.length ? 'Nada con ese filtro.' : 'Aún no hay pruebas. Cada vez que el Juez termine una en el Laboratorio, queda aquí.'}</p></div>
      )}
      <div className="fichas">
        {lista.map((e) => (
          <article key={e.id} className={`caja ficha ${aprobada(e) ? 'si' : ''} ${abierta?.id === e.id ? 'abierta' : ''}`}>
            <header>
              <div>
                <b>{e.nombre}</b>
                <span className="mono sub">{e.simbolo} · velas de {e.serie} · {fecha(e.t)}</span>
              </div>
              <span className={`sello mono ${aprobada(e) ? 'si' : ''}`}>{e.veredicto}{e.score !== null ? ` · ${Math.round(e.score)}` : ''}</span>
            </header>
            <div className="metricas mono">
              <span>Sharpe <b>{e.oos.sharpe === null ? '—' : e.oos.sharpe.toFixed(2)}</b></span>
              <span>Retorno <b>{pct(e.oos.retorno)}</b></span>
              <span>Caída <b>{pct(-e.oos.caida)}</b></span>
              <span>Ops <b>{e.oos.operaciones}</b></span>
              <span>Variantes <b>{e.ensayos}</b></span>
            </div>
            <p className="resumen">{e.resumen}</p>
            {e.gestion && <span className="chip-bib mono">stop {e.gestion.stopAtr} ATR · 1:{e.gestion.rr} · {e.gestion.gestion}</span>}
            <footer>
              <button className="boton" onClick={() => void ver(e)} disabled={!e.conResultado} title={e.conResultado ? '' : 'Resultado viejo: solo queda el resumen'}>{abierta?.id === e.id ? 'Cerrar' : 'Ver resultado'}</button>
              <button className="boton" onClick={() => alLab(e)}><FlaskConical size={12} /> Al Laboratorio</button>
              {aprobada(e) && !e.botId && <button className="boton principal" onClick={() => setAPaper({ id: e.id, capital: 10_000, exposicion: 1, msg: '' })}><Bot size={12} /> Mandar a Paper</button>}
              {e.botId && <span className="en-paper mono">● en Paper</span>}
              <button className="boton quitar" onClick={() => void borrar(e)} aria-label="Borrar"><Trash2 size={12} /></button>
            </footer>
            {aPaper?.id === e.id && (
              <div className="a-paper">
                <label>Capital Paper (USD)<input type="number" min={100} value={aPaper.capital} onChange={(x) => setAPaper({ ...aPaper, capital: Number(x.target.value) })} /></label>
                <label>Exposición ×<input type="number" min={0.1} max={1} step={0.1} value={aPaper.exposicion} onChange={(x) => setAPaper({ ...aPaper, exposicion: Number(x.target.value) })} /></label>
                <button className="boton principal" onClick={() => void mandar()}>Crear bot en el VPS</button>
                <button className="boton" onClick={() => setAPaper(null)}>Cancelar</button>
                <small>Usa velas de {e.serie}{e.gestion ? ' y su GESTION (stop, objetivo y manejo)' : ''}, igual que en el Juez. Sin dinero real.</small>
                {aPaper.msg && <pre className="error-lab">{aPaper.msg}</pre>}
              </div>
            )}
          </article>
        ))}
      </div>
      {abierta && (
        <Suspense fallback={null}>
          {abierta.r ? <Resultado t={{ id: abierta.id, estado: 'listo', pasos: [], inicio: 0, fin: 0, pedido: { simbolo: '', serie: abierta.r.velas.serie, fuente: abierta.r.velas.fuente }, resultado: abierta.r, error: null } satisfies Trabajo} /> : <p className="vacio">Cargando el resultado…</p>}
        </Suspense>
      )}
    </div>
  );
}
