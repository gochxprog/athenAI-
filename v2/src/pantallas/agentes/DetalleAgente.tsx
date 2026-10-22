// Ficha de un agente: qué hace ahora, qué sigue, su actividad de las últimas 24 h, su bitácora y (si tiene
// trabajos propios en el VPS) pausar, reanudar o correr ya.
import { useState } from 'react';
import { AGENTES, CAPAS, ESTILO_AGENTE } from '@/data/agentes';
import type { FichaAgente, Nota } from '@/motores/agentes/sala';
import { pedir } from '../../api';
import { refrescar } from '../../vps';

const ESTADO: Record<FichaAgente['estado'], string> = { trabajando: 'trabajando', esperando: 'esperando', alerta: 'alerta', pausado: 'pausado', dormido: 'sin motor en el VPS' };
const hora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const BOTON: Record<string, string> = { pausar: 'Pausar', reanudar: 'Reanudar', correr: 'Correr ya' };

export default function DetalleAgente({ ficha, notas }: { ficha: FichaAgente; notas: Nota[] }) {
  const a = AGENTES.find((x) => x.id === ficha.id)!;
  const [error, setError] = useState('');
  const max = Math.max(1, ...ficha.actividad);
  const hacer = (accion: string) =>
    pedir(`/api/agentes/${accion}`, { id: a.id })
      .then(() => (setError(''), refrescar()))
      .catch((e: Error) => setError(e.message));

  return (
    <section className={`caja detalle-ag ${ficha.estado}`} style={{ ['--c' as string]: ESTILO_AGENTE[a.id].color }}>
      <div className="cab-ag">
        <div>
          <span className="et">Capa {a.capa} · {CAPAS[a.capa]}</span>
          <h2><i />{a.nombre}</h2>
        </div>
        <span className="pill-ag mono">{ESTADO[ficha.estado]}</span>
      </div>
      <p>{a.rol}.</p>
      <dl className="kv-ag">
        <dt>Ahora</dt><dd>{ficha.ahora}</dd>
        {ficha.siguiente && <><dt>Sigue</dt><dd>{ficha.siguiente}</dd></>}
        <dt>Último</dt><dd>{ficha.ultimo ? `${hora(ficha.ultimo.t)} · ${ficha.ultimo.texto}` : '—'}</dd>
        <dt>Motor</dt><dd>{a.motor}</dd>
      </dl>
      <div>
        <span className="et">Actividad · últimas 24 h</span>
        <div className="act-ag">{ficha.actividad.map((n, i) => <i key={i} title={`${n} cosas hechas`} style={{ height: `${(n / max) * 100}%` }} />)}</div>
      </div>
      {ficha.acciones.length > 0 && <div className="botones-ag">{ficha.acciones.map((x) => <button key={x} className="boton" onClick={() => hacer(x)}>{BOTON[x] ?? x}</button>)}</div>}
      {error && <p className="error-ag">{error}</p>}
      <div className="bitacora-ag mono">
        <span className="et">Su bitácora</span>
        {notas.slice(0, 12).map((n, i) => <div key={i} className={n.grave ? 'grave' : ''}><b>{hora(n.t)}</b> {n.texto}</div>)}
        {!notas.length && <div className="tenue">Todavía no ha anotado nada.</div>}
      </div>
    </section>
  );
}
