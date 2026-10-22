// Riesgo (v2): lo que vigila el Guardián en el VPS. Reglas (caída máxima del día, pérdidas seguidas, banda del
// Juez), cuánto le queda a cada cuenta antes de que actúe, la exposición por mercado, el VPS y el apagado.
import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import { equity, type Bot } from '@/motores/paper/ejecutor';
import { NOMBRE_ESTADO } from '@/motores/paper/guardian';
import { pedir } from '../../api';
import { num } from '../../formato';
import { refrescar, useVps } from '../../vps';
import '../laboratorio/lab.css';
import '../paper/paper.css';
import './riesgo.css';

const corto = (s: string) => s.replace(/USDT$/, '');
const hora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Caída desde el máximo del día (UTC) de una cuenta, en fracción. */
const caida = (b: Bot) => Math.max(0, 1 - equity(b, null) / Math.max(b.dia.pico, 1e-9));

function Barra({ valor, limite }: { valor: number; limite: number }) {
  const x = Math.min(1, valor / limite);
  return <i className="barra-r"><i style={{ width: `${x * 100}%` }} className={x >= 0.75 ? 'baja' : ''} /></i>;
}

export default function Riesgo() {
  const v = useVps();
  const [reglas, setReglas] = useState(v.reglas);
  const [error, setError] = useState('');
  useEffect(() => setReglas(v.reglas), [v.reglas]);
  const accion = (nombre: string, cuerpo: object) => {
    setError('');
    return pedir(`/api/paper/${nombre}`, cuerpo).then(refrescar, (e: Error) => setError(e.message));
  };
  const cuentas = [...v.bots, ...v.manuales];
  const total = cuentas.reduce((s, b) => s + equity(b, null), 0);
  const expuesto = Object.entries(
    cuentas.filter((b) => b.posicion).reduce<Record<string, number>>((m, b) => ({ ...m, [b.simbolo]: (m[b.simbolo] ?? 0) + b.posicion!.lado * b.posicion!.cantidad * (b.ultimoPrecio ?? b.posicion!.precioEntrada) }), {}),
  );
  const r = v.agentes?.recursos;
  const graves = v.bitacora.filter((e) => e.grave).slice(0, 12);

  return (
    <div className="riesgo-v2">
      <div>
        <div className="et">Riesgo · lo que vigila el Guardián en tu VPS</div>
        <h1>{v.apagado ? 'Apagado de emergencia activo: nada opera.' : `Vigila ${cuentas.length} ${cuentas.length === 1 ? 'cuenta' : 'cuentas'} y el VPS.`}</h1>
      </div>
      {v.apagado ? (
        <button className="caja emergencia on" onClick={() => void accion('rearmar', {})}><Power size={15} /> Apagado activo · Rearmar</button>
      ) : (
        <button className="caja emergencia" onClick={() => confirm('Apagado de emergencia: cierra todas las posiciones y apaga todos los bots. ¿Seguro?') && void accion('apagar', {})}><Power size={15} /> Apagado de emergencia</button>
      )}
      {error && <pre className="error-lab">{error}</pre>}

      <div className="riesgo-grid">
        <section className="caja bloque-r">
          <span className="et">Reglas del Guardián</span>
          {reglas ? (
            <>
              <label>Caída máxima del día (cierra y pausa hasta mañana)<input className="mono" type="number" min={0.5} step={0.5} value={num(reglas.ddDiarioMax * 100, 1).replace(',', '.')} onChange={(e) => setReglas({ ...reglas, ddDiarioMax: Math.max(0.005, Number(e.target.value) / 100) })} /> %</label>
              <label>Pérdidas seguidas → cuarentena<input className="mono" type="number" min={1} step={1} value={reglas.perdidasSeguidasMax} onChange={(e) => setReglas({ ...reglas, perdidasSeguidasMax: Math.max(1, Math.round(Number(e.target.value))) })} /></label>
              <label>Operaciones antes de juzgar la banda del Juez<input className="mono" type="number" min={5} step={1} value={reglas.minOperacionesBanda} onChange={(e) => setReglas({ ...reglas, minOperacionesBanda: Math.max(5, Math.round(Number(e.target.value))) })} /></label>
              <button className="boton principal" disabled={JSON.stringify(reglas) === JSON.stringify(v.reglas)} onClick={() => void accion('reglas', reglas)}>Guardar en el VPS</button>
            </>
          ) : <p className="nota-r">Cargando…</p>}
          <p className="nota-r">Sin datos en vivo, nadie abre. Un bot por debajo del P5 de la banda del Juez se pausa. Exposición máxima: aprobada 1×, con reserva 0,5×.</p>
        </section>

        <section className="caja bloque-r">
          <span className="et">Exposición abierta · {num(total)} USD en total</span>
          {expuesto.length ? expuesto.map(([s, n]) => (
            <div key={s} className="fila-r"><span>{corto(s)} {n >= 0 ? '▲ largo' : '▼ corto'}</span><b className="mono">{num(Math.abs(n))} USD · {num((Math.abs(n) / Math.max(total, 1)) * 100, 1)} %</b></div>
          )) : <p className="nota-r">Nada abierto ahora.</p>}
          {r && (
            <>
              <span className="et" style={{ marginTop: 10 }}>El VPS</span>
              <div className="fila-r"><span>Memoria {num(((r.memTotal - r.memLibre) / r.memTotal) * 100, 0)} %</span><Barra valor={(r.memTotal - r.memLibre) / r.memTotal} limite={0.9} /></div>
              {r.discoLibre !== null && <div className="fila-r"><span>Disco libre {num(r.discoLibre / 1024 ** 3, 1)} GB</span><b className="mono">{r.discoLibre < 5 * 1024 ** 3 ? 'poco' : 'bien'}</b></div>}
            </>
          )}
        </section>
      </div>

      <section className="caja bloque-r">
        <span className="et">Cada cuenta frente a sus límites</span>
        {cuentas.length ? cuentas.map((b) => (
          <div key={b.id} className="cuenta-r">
            <b>{b.origen === 'manual' ? `A mano · ${corto(b.simbolo)}` : b.nombre}</b>
            <span className="estado-r">{NOMBRE_ESTADO[b.estado]}</span>
            <span>Caída del día {num(caida(b) * 100, 2)} % de {num((v.reglas?.ddDiarioMax ?? 0.03) * 100, 1)} %</span>
            <Barra valor={caida(b)} limite={v.reglas?.ddDiarioMax ?? 0.03} />
            <span>Pérdidas seguidas {b.perdidasSeguidas} de {v.reglas?.perdidasSeguidasMax ?? '—'}</span>
            <Barra valor={b.perdidasSeguidas} limite={v.reglas?.perdidasSeguidasMax ?? 3} />
          </div>
        )) : <p className="nota-r">No hay bots ni operaciones a mano todavía: crea un bot desde la Biblioteca o abre una orden en la Terminal.</p>}
      </section>

      <section className="caja bloque-r">
        <span className="et">Cuando el Guardián actuó</span>
        {graves.length ? graves.map((e, i) => <div key={i} className="fila-r mono"><span>{hora(e.t)} · {e.nombre}</span><span>{e.texto}</span></div>) : <p className="nota-r">Nunca ha tenido que actuar.</p>}
      </section>
    </div>
  );
}
