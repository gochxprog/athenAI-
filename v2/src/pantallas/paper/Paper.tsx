// Paper (v2): los bots que operan en el VPS con dinero de mentira, sus operaciones y el Guardián. Sin dinero real.
import { useState } from 'react';
import { BookMarked, Power, ShieldCheck } from 'lucide-react';
import { equity } from '@/motores/paper/ejecutor';
import { pedir } from '../../api';
import { deHoy, refrescar, useVps } from '../../vps';
import TarjetaBot from './TarjetaBot';
import { num, usd } from '../../formato';
import '../laboratorio/lab.css';
import './paper.css';

const MOTIVO: Record<string, string> = { senal: 'señal', guardian: 'Guardián', hueco: 'corte de datos', apagado: 'apagado', manual: 'a mano', stop: 'stop', objetivo: 'objetivo', 'break-even': 'break-even', 'stop-en-ganancia': 'stop en ganancia', tiempo: 'tiempo' };
const hora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Paper() {
  const v = useVps();
  const [error, setError] = useState('');
  const bots = v.bots;
  const accion = (nombre: string, cuerpo: object) => {
    setError('');
    pedir(`/api/paper/${nombre}`, cuerpo).then(refrescar, (e: Error) => setError(e.message));
  };
  const total = bots.reduce((s, b) => s + equity(b, null), 0);
  const abierto = bots.reduce((s, b) => s + (b.posicion ? equity(b, null) - b.capital : 0), 0);
  const hoy = deHoy(v.ops).reduce((s, o) => s + o.pnl, 0);
  const activos = bots.filter((b) => b.estado === 'activo').length;
  const nombre = (id: string) => v.bots.find((b) => b.id === id)?.nombre ?? (id.startsWith('manual:') ? 'Manual' : id);
  const [dd, setDd] = useState<string | null>(null);

  return (
    <div className="paper-v2">
      <div>
        <div className="et">Paper</div>
        <h1>{bots.length ? `${activos}/${bots.length} bots activos` : 'Sin bots'}</h1>
      </div>
      <div className="cuenta">
        {([['Capital Paper', `${num(total)} USD`], ['Abierto ahora', usd(abierto)], ['Cerrado hoy', usd(hoy)], ['Bots activos', `${activos}/${bots.length}`]] as const).map(([k, x]) => (
          <div key={k} className="caja dato"><span className="et">{k}</span><b className="cifra">{x}</b></div>
        ))}
        {v.apagado ? (
          <button className="caja emergencia on" onClick={() => accion('rearmar', {})}><Power size={15} /> Apagado activo · Rearmar</button>
        ) : (
          <button className="caja emergencia" onClick={() => confirm('Apagado de emergencia: cierra todas las posiciones y apaga todos los bots. ¿Seguro?') && accion('apagar', {})}><Power size={15} /> Apagado de emergencia</button>
        )}
      </div>
      {error && <pre className="error-lab">{error}</pre>}

      {!bots.length && (
        <div className="caja vacia-paper">
          <BookMarked size={18} />
          <p><a href="#/biblioteca">Biblioteca</a></p>
        </div>
      )}
      <div className="bots">{bots.map((b) => <TarjetaBot key={b.id} b={b} reglas={v.reglas} accion={accion} />)}</div>

      <div className="abajo-paper">
        <section className="caja bloque">
          <span className="et">Libro de operaciones</span>
          <div className="tabla-ops mono">
            <div className="fila cab"><span>Cierre</span><span>Bot</span><span>Lado</span><span>Entró → salió</span><span>Puntos</span><span>Resultado</span><span>Motivo</span></div>
            {[...v.ops].reverse().slice(0, 60).map((o, i) => {
              const puntos = (o.precioSalida - o.precioEntrada) * o.lado;
              return (
                <div key={o.id ?? i} className="fila">
                  <span>{hora(o.salidaT)}</span><span>{nombre(o.botId)}</span><span>{o.lado > 0 ? 'largo' : 'corto'}</span>
                  <span>{num(o.precioEntrada)} → {num(o.precioSalida)}</span>
                  <span className={puntos >= 0 ? 'vivo' : 'baja'}>{puntos >= 0 ? '+' : ''}{num(puntos)}</span>
                  <span className={o.pnl >= 0 ? 'vivo' : 'baja'}>{usd(o.pnl)}</span><span>{MOTIVO[o.motivo] ?? o.motivo}</span>
                </div>
              );
            })}
            {!v.ops.length && <p className="vacio">Sin operaciones</p>}
          </div>
        </section>
        <div className="col-paper">
          <section className="caja bloque guardian">
            <span className="et"><ShieldCheck size={12} /> Guardián</span>
            {v.reglas && (
              <div className="reglas">
                <label>Caída máxima del día
                  <span><input type="number" min={0.5} max={50} step={0.5} value={dd ?? num(v.reglas.ddDiarioMax * 100, 1).replace(',', '.')} onChange={(e) => setDd(e.target.value)} onBlur={() => dd && (accion('reglas', { ddDiarioMax: Number(dd) / 100 }), setDd(null))} /> %</span>
                </label>
                <label>Pérdidas seguidas máx.<b className="mono">{v.reglas.perdidasSeguidasMax}</b></label>
                <label>Banda del Juez desde<b className="mono">{v.reglas.minOperacionesBanda} ops</b></label>
              </div>
            )}
          </section>
          <section className="caja bloque registro-paper mono">
            <span className="et">Registro</span>
            {v.bitacora.slice(0, 14).map((e, i) => (
              <div key={i} className={e.grave ? 'grave' : ''}><b>{hora(e.t)}</b> <span className="quien">{e.nombre}</span> {e.texto}</div>
            ))}
            {!v.bitacora.length && <p className="vacio">—</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
