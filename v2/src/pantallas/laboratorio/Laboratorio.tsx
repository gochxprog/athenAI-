// Laboratorio (v2): escribes la estrategia en Python y el Juez la prueba en el VPS con lo grabado y la historia.
import { lazy, Suspense, useEffect, useState } from 'react';
import { FlaskConical, Play, Square } from 'lucide-react';
import { SERIES, type Serie } from '@/motores/laboratorio/velas';
import { FUENTES, type Fuente, type Trabajo } from '@/motores/laboratorio/prueba';
import { useVps } from '../../vps';
import { cancelar, CLAVE_LAB, probar, trabajo } from './api';
import { PLANTILLAS } from './plantillas';
import Resultado from './Resultado';
import '../../tw.css';
import './lab.css';

// CodeMirror y uPlot se bajan solo al abrir el Laboratorio.
const Editor = lazy(() => import('./Editor'));
const NOMBRE_FUENTE: Record<Fuente, string> = { todo: 'Historia + grabado', historia: 'Solo historia', grabado: 'Solo grabado' };

const leer = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_LAB) ?? '') as { nombre: string; codigo: string; serie: Serie; fuente: Fuente; id?: string };
  } catch {
    return { nombre: PLANTILLAS[0].nombre, codigo: PLANTILLAS[0].codigo, serie: '5m' as Serie, fuente: 'todo' as Fuente };
  }
};

function Seg<T extends string>({ opciones, valor, cambiar, nombre = (x: T) => x }: { opciones: readonly T[]; valor: T; cambiar: (x: T) => void; nombre?: (x: T) => string }) {
  return (
    <div className="seg">
      {opciones.map((o) => <button key={o} className={o === valor ? 'sel' : ''} onClick={() => cambiar(o)}>{nombre(o)}</button>)}
    </div>
  );
}

export default function Laboratorio() {
  const v = useVps();
  const [estado, setEstado] = useState(leer);
  const [simbolo, setSimbolo] = useState('BTCUSDT');
  const [t, setT] = useState<Trabajo | null>(null);
  const [error, setError] = useState('');
  const cambiar = (x: Partial<ReturnType<typeof leer>>) => setEstado((e) => ({ ...e, ...x }));

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_LAB, JSON.stringify(estado));
    } catch {
      // sin almacenamiento (modo privado): no pasa nada
    }
  }, [estado]);

  // Sigue la prueba en curso cada 1,5 s hasta que termine (también al volver a la pantalla).
  useEffect(() => {
    if (!estado.id) return;
    let vivo = true;
    const mirar = () =>
      trabajo(estado.id!).then(
        (x) => {
          if (!vivo) return;
          setT(x);
          if (x.estado === 'corriendo') setTimeout(mirar, 1_500);
        },
        (e: Error) => vivo && setError(e.message),
      );
    void mirar();
    return () => void (vivo = false);
  }, [estado.id]);

  const corriendo = t?.estado === 'corriendo';
  const lanzar = async () => {
    setError('');
    try {
      const { id } = await probar({ codigo: estado.codigo, simbolo, serie: estado.serie, fuente: estado.fuente, nombre: estado.nombre });
      setT(null);
      cambiar({ id });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="lab">
      <div>
        <div className="et">Laboratorio</div>
        <h1>Laboratorio</h1>
      </div>

      <div className="lab-arriba">
        <section className="caja editor-caja">
          <div className="barra-ed">
            <FlaskConical size={14} />
            <input value={estado.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} aria-label="Nombre de la estrategia" />
            <div className="plantillas">
              {PLANTILLAS.map((p) => <button key={p.nombre} onClick={() => cambiar({ nombre: p.nombre, codigo: p.codigo })}>{p.nombre}</button>)}
            </div>
          </div>
          <Suspense fallback={<div className="editor" />}>
            <Editor codigo={estado.codigo} cambiar={(codigo) => cambiar({ codigo })} />
          </Suspense>
          <div className="pie-ed">
            <Seg opciones={v.mercados.map((m) => m.simbolo).length ? v.mercados.map((m) => m.simbolo) : ['BTCUSDT']} valor={simbolo} cambiar={setSimbolo} />
            <Seg opciones={SERIES} valor={estado.serie} cambiar={(serie) => cambiar({ serie })} />
            <Seg opciones={FUENTES} valor={estado.fuente} cambiar={(fuente) => cambiar({ fuente })} nombre={(f) => NOMBRE_FUENTE[f]} />
            {corriendo ? (
              <button className="boton" onClick={() => void cancelar(t!.id)}><Square size={13} /> Cancelar</button>
            ) : (
              <button className="boton principal" onClick={() => void lanzar()}><Play size={13} /> Probar con el Juez</button>
            )}
          </div>
        </section>

        <aside className="caja guia">
          <span className="et">Referencia</span>
          <p className="mono">señal: 1 · -1 · 0 · True/False · buy/sell/exit</p>
          <div className="campos mono">{['open', 'high', 'low', 'close', 'volumen', 'delta', 'flujo_5_ratio', 'absorcion_bid', 'stoprun_bajo', 'oi_delta_pct', '+ 30 Features'].map((c) => <span key={c}>{c}</span>)}</div>
          <p className="mono">GESTION = {'{'}"stopAtr": 1.5, "rr": [2, 3], "gestion": "be1R"{'}'}</p>
          <p className="mono">PARAMETROS = {'{'}"n": [20, 40]{'}'}</p>
          {(corriendo || error || t?.estado === 'error') && (
            <div className="progreso">
              <span className="et">{corriendo ? 'Probando en el VPS…' : 'No se pudo probar'}</span>
              {t?.pasos.slice(-6).map((p, i, xs) => <div key={i} className={i === xs.length - 1 && corriendo ? 'paso-lab vivo' : 'paso-lab'}><i />{p}</div>)}
              {(error || t?.error) && <pre className="error-lab">{error || t?.error}</pre>}
            </div>
          )}
        </aside>
      </div>

      {t?.estado === 'listo' && t.resultado && <Resultado t={t} />}
    </div>
  );
}
