// Datos (v2): la salud de la grabadora. Cada mercado en vivo, lo guardado en disco y la historia importada.
import { Database, HardDrive, History, Radio } from 'lucide-react';
import { num } from '../../formato';
import { useVps } from '../../vps';
import '../laboratorio/lab.css';
import './sistema.css';

const corto = (s: string) => s.replace(/^binance_/, '').toUpperCase();
const peso = (b: number) => (b > 1e9 ? `${num(b / 1e9, 2)} GB` : `${num(b / 1e6, 1)} MB`);
const fecha = (t: number | null) => (t ? new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const hace = (t: number | null) => (t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))} s` : '—');

export default function Datos() {
  const v = useVps();
  const vivos = v.mercados.filter((m) => m.conexion === 'en-vivo').length;
  const filas = v.almacen.reduce((s, a) => s + a.filas, 0);
  const bytes = v.almacen.reduce((s, a) => s + a.bytes, 0) + v.historia.reduce((s, h) => s + h.bytes, 0);

  return (
    <div className="sis">
      <div>
        <div className="et">Datos · lo que graba el VPS y lo que ya tiene</div>
        <h1>{v.caido ? 'La grabadora no responde.' : `${vivos} de ${v.mercados.length} mercados grabando en vivo.`}</h1>
      </div>
      <div className="kpis-sis">
        {([['En vivo', `${vivos}/${v.mercados.length}`], ['Filas grabadas', num(filas, 0)], ['Historia', `${v.historia.reduce((s, h) => s + h.dias, 0)} días`], ['En disco', peso(bytes)]] as const).map(([k, x]) => (
          <div key={k} className="caja dato"><span className="et">{k}</span><b className="cifra">{x}</b></div>
        ))}
      </div>

      <section className="caja bloque-sis">
        <span className="et"><Radio size={12} /> Grabando ahora</span>
        <div className="tabla-sis mono">
          <div className="fila cab"><span>Mercado</span><span>Estado</span><span>Filas sesión</span><span>Última fila</span><span>Cortes</span><span>Trades perdidos</span></div>
          {v.mercados.map((m) => (
            <div key={m.simbolo} className="fila">
              <span>{m.simbolo}</span>
              <span className={m.conexion === 'en-vivo' ? 'ok' : 'mal'} title={m.detalle}><i className="punto-sis" />{m.conexion}</span>
              <span>{num(m.filasSesion, 0)}</span><span>hace {hace(m.ultimoCierre)}</span><span>{m.cortes}</span><span>{num(m.tradesPerdidos, 0)}</span>
            </div>
          ))}
        </div>
        <small>Un corte = se cayó la conexión con Binance y se marcó un hueco en los datos (los bots no mantienen posición a través de un hueco).</small>
      </section>

      <div className="dos-sis">
        <section className="caja bloque-sis">
          <span className="et"><HardDrive size={12} /> Grabado en disco</span>
          {v.almacen.map((a) => (
            <div key={a.simbolo} className="linea-sis">
              <b>{a.simbolo}</b><span className="mono">{num(a.filas, 0)} filas · {peso(a.bytes)}</span><small className="mono">{fecha(a.desde)} → {fecha(a.hasta)}</small>
            </div>
          ))}
          {!v.almacen.length && <p className="vacio">Aún no hay nada grabado.</p>}
        </section>
        <section className="caja bloque-sis">
          <span className="et"><History size={12} /> Historia importada (Binance)</span>
          {v.historia.map((h) => (
            <div key={h.carpeta} className="linea-sis">
              <b>{corto(h.carpeta)}</b><span className="mono">{h.dias} días · {peso(h.bytes)}</span><small className="mono">{h.desde ?? '—'} → {h.hasta ?? '—'}</small>
              {h.importando && h.progreso && (
                <div className="avance"><i style={{ width: `${(h.progreso.hechos / Math.max(1, h.progreso.total)) * 100}%` }} /><small className="mono">importando {h.progreso.dia} · {h.progreso.hechos}/{h.progreso.total}</small></div>
              )}
            </div>
          ))}
          {!v.historia.length && <p className="vacio">Sin historia importada.</p>}
          <small className="mono comando">sudo bash importar.sh BTCUSDT 2026-07-01 2026-10-21</small>
          <small>Se corre en el VPS (en la carpeta del ZIP). Va de fondo; los días ya importados se saltan.</small>
        </section>
      </div>
      <p className="nota-sis"><Database size={12} /> Datos reales de Binance. Lo grabado y lo importado van en carpetas separadas: el Juez usa la historia y luego lo grabado desde donde ella termina, sin repetir filas.</p>
    </div>
  );
}
