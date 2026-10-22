// Terminal (v2): operar a mano en Paper (sin dinero real) con el mismo motor del VPS que los bots: llenado con
// deslizamiento y comisión, stop (k × ATR o precio), objetivo en R y la gestión del Juez (fija · BE a 1R · escalonada).
// El VPS vigila el stop y el objetivo cada segundo aunque cierres la página.
import { useMemo, useState } from 'react';
import { MS_SERIE } from '@/motores/laboratorio/velas';
import { MODOS_GESTION, type ModoGestion } from '@/motores/juez/salidas';
import { RIESGO_MAXIMO, tieneObjetivo } from '@/motores/paper/manual';
import { pedir } from '../../api';
import { dinero, num, usd } from '../../formato';
import { refrescar, useVps } from '../../vps';
import Velas from '../mercado/Velas';
import { marcasYLineas, SERIES_G, useVelasVps, type SerieG } from '../mercado/grafico';
import '../laboratorio/lab.css';
import '../mercado/mercado.css';
import '../paper/paper.css';
import './terminal.css';

const corto = (s: string) => s.replace(/USDT$/, '');
const RIESGOS = [0.0025, 0.005, 0.01, 0.02];
const STOPS = [1, 1.5, 2, 3];
const RRS = [1.5, 2, 3, 5, 0];
const GESTION: Record<ModoGestion, string> = { fija: 'Fija', be1R: 'BE a 1R', escalonada: 'Escalonada' };
const hora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Terminal() {
  const v = useVps();
  const mercados = v.mercados.length ? v.mercados.map((m) => m.simbolo) : ['BTCUSDT'];
  const [simbolo, setSimbolo] = useState(mercados[0]);
  const [serie, setSerie] = useState<SerieG>('5m');
  const [orden, setOrden] = useState({ riesgoPct: 0.005, stopAtr: 1.5, stopPrecio: '', rr: 2, gestion: 'be1R' as ModoGestion });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const { velas, vivas, error: errorVelas } = useVelasVps(simbolo, serie);

  const cuenta = v.manuales.find((b) => b.simbolo === simbolo) ?? null;
  const opsManuales = useMemo(() => v.ops.filter((o) => o.botId.startsWith('manual:')), [v.ops]);
  const { marcas, lineas } = useMemo(() => marcasYLineas(opsManuales, v.manuales, simbolo, MS_SERIE[serie]), [opsManuales, v.manuales, simbolo, serie]);
  const precio = v.filas[simbolo]?.at(-1)?.close ?? velas.at(-1)?.[4] ?? null;
  const enVivo = v.mercados.find((m) => m.simbolo === simbolo)?.conexion === 'en-vivo';
  const capital = cuenta?.capital ?? 10_000;
  const abiertas = v.manuales.filter((b) => b.posicion);

  const enviar = (lado: 1 | -1) => {
    setError('');
    setEnviando(true);
    const stopPrecio = Number(orden.stopPrecio.replace(',', '.'));
    pedir('/api/paper/orden', { proveedor: 'binance', simbolo, lado, riesgoPct: orden.riesgoPct, gestion: orden.gestion, ...(stopPrecio > 0 ? { stopPrecio } : { stopAtr: orden.stopAtr }), ...(orden.rr ? { rr: orden.rr } : {}) })
      .then(refrescar, (e: Error) => setError(e.message))
      .finally(() => setEnviando(false));
  };
  const cerrar = (id: string) => pedir('/api/paper/cerrar', { id }).then(refrescar, (e: Error) => setError(e.message));
  const cambiar = (x: Partial<typeof orden>) => setOrden((o) => ({ ...o, ...x }));

  return (
    <div className="terminal-v2">
      <div>
        <div className="et">Terminal · operas tú, en Paper (sin dinero real)</div>
        <h1>{corto(simbolo)} {precio ? num(precio, precio < 100 ? 4 : 1) : '—'} <small>cuenta a mano {num(capital)} USD</small></h1>
      </div>
      <div className="terminal-cuerpo">
        <section className="caja grafico-caja">
          <div className="barra-graf">
            <div className="seg">{mercados.map((s) => <button key={s} className={s === simbolo ? 'sel' : ''} onClick={() => setSimbolo(s)}>{corto(s)}</button>)}</div>
            <div className="seg">{SERIES_G.map((s) => <button key={s} className={s === serie ? 'sel' : ''} onClick={() => setSerie(s)}>{s}</button>)}</div>
          </div>
          <Velas velas={velas} vivas={vivas} marcas={marcas} lineas={lineas} clave={`${simbolo}-${serie}`} />
          {errorVelas && <pre className="error-lab">{errorVelas}</pre>}
        </section>

        <section className="caja ticket">
          <span className="et">Orden a mercado</span>
          <label>Riesgo por operación</label>
          <div className="seg">{RIESGOS.map((r) => <button key={r} className={r === orden.riesgoPct ? 'sel' : ''} onClick={() => cambiar({ riesgoPct: r })}>{num(r * 100, r < 0.01 ? 2 : 0)} %</button>)}</div>
          <small className="nota-t">= {num(capital * orden.riesgoPct)} USD si toca el stop (máx. {num(RIESGO_MAXIMO * 100, 0)} %; menos si el tamaño no cabe en la cuenta sin apalancamiento)</small>
          <label>Stop</label>
          <div className="seg">{STOPS.map((k) => <button key={k} className={!orden.stopPrecio && k === orden.stopAtr ? 'sel' : ''} onClick={() => cambiar({ stopAtr: k, stopPrecio: '' })}>{num(k, k % 1 ? 1 : 0)} ATR</button>)}</div>
          <input className="mono" inputMode="decimal" placeholder="o un precio exacto" value={orden.stopPrecio} onChange={(e) => cambiar({ stopPrecio: e.target.value })} aria-label="Precio del stop" />
          <label>Objetivo</label>
          <div className="seg">{RRS.map((r) => <button key={r} className={r === orden.rr ? 'sel' : ''} onClick={() => cambiar({ rr: r })}>{r ? `1:${num(r, r % 1 ? 1 : 0)}` : 'Sin'}</button>)}</div>
          <label>Gestión del stop</label>
          <div className="seg">{MODOS_GESTION.map((g) => <button key={g} className={g === orden.gestion ? 'sel' : ''} onClick={() => cambiar({ gestion: g })}>{GESTION[g]}</button>)}</div>
          <div className="lados">
            <button className="comprar" disabled={enviando || !enVivo} onClick={() => enviar(1)}>Comprar</button>
            <button className="vender" disabled={enviando || !enVivo} onClick={() => enviar(-1)}>Vender</button>
          </div>
          {!enVivo && <small className="nota-t">{corto(simbolo)} no está en vivo ahora: no se puede operar.</small>}
          {error && <pre className="error-lab">{error}</pre>}
          <small className="nota-t">El tamaño sale del riesgo y la distancia al stop, sin apalancamiento. El VPS mueve el stop según la gestión y cierra al tocar stop u objetivo.</small>
        </section>
      </div>

      <section className="caja bloque-t">
        <span className="et">Posiciones abiertas a mano</span>
        {abiertas.length ? abiertas.map((b) => {
          const p = b.posicion!;
          const g = b.gestion?.posicion;
          const ahora = v.filas[b.simbolo]?.at(-1)?.close ?? b.ultimoPrecio ?? p.precioEntrada;
          const pnl = p.lado * p.cantidad * (ahora - p.precioEntrada);
          const r = g && g.riesgo > 0 ? (p.lado * (ahora - g.precioEntrada)) / g.riesgo : null;
          return (
            <div key={b.id} className={`posicion ${p.lado > 0 ? 'largo' : 'corto'}`}>
              <span>{corto(b.simbolo)} {p.lado > 0 ? '▲ largo' : '▼ corto'} {num(p.cantidad, 4)}</span>
              <span className="mono">entrada {num(p.precioEntrada, 1)}{g ? ` · stop ${num(g.stop, 1)}` : ''}{g && tieneObjetivo(g.objetivo) ? ` · objetivo ${num(g.objetivo, 1)}` : ''}</span>
              <b className={pnl >= 0 ? 'sube' : 'baja'}>{dinero(pnl)} USD{r !== null ? ` · ${r >= 0 ? '+' : ''}${num(r, 2)} R` : ''}</b>
              <button className="boton" onClick={() => void cerrar(b.id)}>Cerrar</button>
            </div>
          );
        }) : <p className="nota-t">Ninguna. Abre una con el ticket: verás la entrada, el stop y el objetivo en el gráfico.</p>}
      </section>

      <section className="caja bloque-t">
        <span className="et">Tus últimas operaciones · todas en el Diario</span>
        {opsManuales.length ? opsManuales.slice(-8).reverse().map((o, i) => (
          <div key={o.id ?? i} className="fila-op mono">
            <span>{hora(o.salidaT)}</span><span>{corto(o.simbolo)} {o.lado > 0 ? '▲' : '▼'}</span>
            <span>{num(o.precioEntrada, 1)} → {num(o.precioSalida, 1)}</span>
            <b className={o.pnl >= 0 ? 'sube' : 'baja'}>{usd(o.pnl)}{o.gestion ? ` · ${o.gestion.r >= 0 ? '+' : ''}${num(o.gestion.r, 2)} R` : ''}</b>
          </div>
        )) : <p className="nota-t">Todavía no cerraste ninguna.</p>}
      </section>
    </div>
  );
}
