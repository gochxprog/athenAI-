// Terminal de un agente: se abre al lado al tocarlo (en la sala o en su ficha). Arriba, qué hace ahora, qué sigue y su
// actividad de 24 h; abajo, su consola en vivo (lo que anotó en el VPS) y, si tiene trabajos propios, pausar o correr.
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AGENTES, CAPAS, ESTILO_AGENTE } from '@/data/agentes';
import type { FichaAgente, Nota } from '@/motores/agentes/sala';
import { pedir } from '../../api';
import { refrescar } from '../../vps';

const ESTADO: Record<FichaAgente['estado'], string> = { trabajando: 'trabajando', esperando: 'esperando', alerta: 'alerta', pausado: 'pausado', dormido: 'sin motor en el VPS' };
const hora = (t: number) => new Date(t).toLocaleTimeString('es-ES');
const dia = (t: number) => new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
const BOTON: Record<string, string> = { pausar: 'Pausar', reanudar: 'Reanudar', correr: 'Correr ya' };

export default function DetalleAgente({ ficha, notas, cerrar }: { ficha: FichaAgente; notas: Nota[]; cerrar: () => void }) {
  const a = AGENTES.find((x) => x.id === ficha.id)!;
  const [error, setError] = useState('');
  const consola = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...ficha.actividad);
  const lineas = notas.slice(0, 80).reverse();
  const hacer = (accion: string) =>
    pedir(`/api/agentes/${accion}`, { id: a.id })
      .then(() => (setError(''), refrescar()))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && cerrar();
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [cerrar]);
  // La consola baja sola a lo último, como una terminal.
  useEffect(() => consola.current?.scrollTo({ top: consola.current.scrollHeight }), [lineas.length, a.id]);

  return (
    <>
      <div className="fondo-ag" onClick={cerrar} />
      <aside className={`cajon-ag ${ficha.estado}`} style={{ ['--c' as string]: ESTILO_AGENTE[a.id].color }} role="dialog" aria-label={`Terminal de ${a.nombre}`}>
        <header className="cab-ag">
          <div>
            <span className="et">Capa {a.capa} · {CAPAS[a.capa]}</span>
            <h2><i />{a.nombre}</h2>
          </div>
          <span className="pill-ag mono">{ESTADO[ficha.estado]}</span>
          <button className="cerrar-ag" onClick={cerrar} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <p className="rol-ag">{a.rol}.</p>
        <dl className="kv-ag">
          <dt>Ahora</dt><dd>{ficha.ahora}</dd>
          {ficha.siguiente && <><dt>Sigue</dt><dd>{ficha.siguiente}</dd></>}
          <dt>Motor</dt><dd>{a.motor}</dd>
        </dl>
        <div>
          <span className="et">Actividad · últimas 24 h</span>
          <div className="act-ag">{ficha.actividad.map((n, i) => <i key={i} title={`${n} cosas hechas`} style={{ height: `${(n / max) * 100}%` }} />)}</div>
        </div>
        {ficha.acciones.length > 0 && <div className="botones-ag">{ficha.acciones.map((x) => <button key={x} className="boton" onClick={() => hacer(x)}>{BOTON[x] ?? x}</button>)}</div>}
        {error && <p className="error-ag">{error}</p>}
        <div className="terminal-ag mono" ref={consola} role="log" aria-live="polite">
          <div className="tenue">{a.id}@vps:~$ tail -f bitacora</div>
          {lineas.map((n, i) => (
            <div key={`${n.t}-${i}`} className={n.grave ? 'grave' : ''}>
              <b title={dia(n.t)}>{hora(n.t)}</b> {n.texto}
            </div>
          ))}
          {!lineas.length && <div className="tenue">{ficha.estado === 'dormido' ? `Sin motor en el VPS todavía: ${ficha.ahora}.` : 'Todavía no ha anotado nada.'}</div>}
          <div><span className="cursor-ag">▌</span></div>
        </div>
      </aside>
    </>
  );
}
