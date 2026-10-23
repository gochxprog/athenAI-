// Mercado y Terminal (v2), una sola pantalla: velas del VPS (historia + grabado + cada tick) con las entradas y
// salidas de los bots y las tuyas, el ticket para operar a mano al lado, debajo lo que lee cada motor ahora mismo
// (un mercado al lado del otro) y tus posiciones. Ligero: sin footprint ni heatmap.
import { useEffect, useMemo, useState } from 'react';
import { MS_SERIE } from '@/motores/laboratorio/velas';
import { num } from '../../formato';
import { useVps } from '../../vps';
import { useVivo } from '../../vivo';
import Velas from './Velas';
import { marcasYLineas, SERIES_G, useVelasVps, type SerieG } from './grafico';
import { eventos, MOTORES } from './motores';
import { Manuales, Ticket } from '../terminal/Operar';
import '../laboratorio/lab.css';
import './mercado.css';

const CLAVE = 'athenai.v2.mercado';
const hora = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const corto = (s: string) => s.replace(/USDT$/, '');

export default function Mercado() {
  const v = useVps();
  const [sel, setSel] = useState<{ simbolo: string; serie: SerieG }>(() => {
    try {
      return JSON.parse(localStorage.getItem(CLAVE) ?? '') as { simbolo: string; serie: SerieG };
    } catch {
      return { simbolo: 'BTCUSDT', serie: '5m' };
    }
  });
  const [abierto, setAbierto] = useState<string | null>(null);
  const ms = MS_SERIE[sel.serie];
  const clave = `${sel.simbolo}-${sel.serie}`;
  const { velas, vivas, error } = useVelasVps(sel.simbolo, sel.serie);
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(sel));
    } catch {
      // sin almacenamiento: se queda en BTC 5m
    }
  }, [sel]);
  // Bots en este mercado: entradas/salidas cerradas y la posición abierta (entrada, stop y objetivo).
  const { marcas, lineas } = useMemo(() => marcasYLineas(v.ops, [...v.bots, ...v.manuales], sel.simbolo, ms), [v.ops, v.bots, v.manuales, sel.simbolo, ms]);

  const tick = useVivo(sel.simbolo);
  const precio = tick?.p ?? (vivas.at(-1) ?? velas.at(-1))?.[4] ?? null;
  const primera = velas.at(-Math.round(86_400_000 / ms)) ?? velas[0];
  const cambio = precio && primera ? precio / primera[1] - 1 : null;
  const mercados = v.mercados.map((m) => m.simbolo);

  return (
    <div className="mercado-v2">
      <div>
        <div className="et">Terminal</div>
        <h1>{corto(sel.simbolo)} {precio ? num(precio, precio < 100 ? 4 : 1) : '—'} {cambio !== null && <small className={cambio >= 0 ? 'sube' : 'baja'}>{cambio >= 0 ? '▲' : '▼'} {num(Math.abs(cambio) * 100)} % · 24 h</small>}</h1>
      </div>
      <div className="terminal-cuerpo">
        <section className="caja grafico-caja">
          <div className="barra-graf">
            <div className="seg">{(mercados.length ? mercados : ['BTCUSDT']).map((s) => <button key={s} className={s === sel.simbolo ? 'sel' : ''} onClick={() => setSel({ ...sel, simbolo: s })}>{corto(s)}</button>)}</div>
            <div className="seg">{SERIES_G.map((s) => <button key={s} className={s === sel.serie ? 'sel' : ''} onClick={() => setSel({ ...sel, serie: s })}>{s}</button>)}</div>
          </div>
          <Velas velas={velas} vivas={vivas} marcas={marcas} lineas={lineas} clave={clave} simbolo={sel.simbolo} ms={ms} />
          {error && <pre className="error-lab">{error}</pre>}
        </section>
        <Ticket simbolo={sel.simbolo} serie={sel.serie} velas={velas} />
      </div>

      <div className="motores-v2">
        {MOTORES.map((m) => (
          <article key={m.id} className={`caja motor ${abierto === m.id ? 'abierto' : ''}`} onClick={() => setAbierto(abierto === m.id ? null : m.id)}>
            <span className="et">{m.nombre}</span>
            {(mercados.length ? mercados : ['BTCUSDT']).map((s) => {
              const l = m.leer(v.filas[s] ?? []);
              return (
                <div key={s} className="lectura-m">
                  <small className="mono">{corto(s)}</small>
                  <b className={l.lado > 0 ? 'sube' : l.lado < 0 ? 'baja' : ''}>{l.texto}</b>
                  <i className="fuerza"><i style={{ width: `${l.fuerza * 100}%` }} className={l.lado > 0 ? 'sube' : l.lado < 0 ? 'baja' : ''} /></i>
                </div>
              );
            })}
            {abierto === m.id && (
              <div className="explica">
                {mercados.flatMap((s) => eventos(m, v.filas[s] ?? []).map((f) => (
                  <div key={`${s}-${f.cierre}`} className="mono ev">{hora(f.cierre)} · {corto(s)} · {m.clave.filter((k) => f.valores[k]).map((k) => `${k.replace(/_/g, ' ')} ${num(f.valores[k] ?? 0, 0)}`).join(' · ')}</div>
                )))}
              </div>
            )}
          </article>
        ))}
      </div>
      <Manuales />
    </div>
  );
}
