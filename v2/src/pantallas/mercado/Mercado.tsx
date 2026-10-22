// Mercado (v2): velas del VPS (historia + grabado) con las entradas y salidas de los bots, y debajo lo que lee cada
// motor ahora mismo, un mercado al lado del otro. Ligero: sin footprint ni heatmap.
import { useEffect, useMemo, useState } from 'react';
import { armarVelas, MS_SERIE, type Serie } from '@/motores/laboratorio/velas';
import type { FilaFeatures } from '@/motores/nucleo/features';
import { tieneObjetivo } from '@/motores/paper/manual';
import { pedir } from '../../api';
import { num, usd } from '../../formato';
import { useVps } from '../../vps';
import Velas, { type Linea, type Marca, type VelaG } from './Velas';
import { eventos, MOTORES } from './motores';
import '../laboratorio/lab.css';
import './mercado.css';

const SERIES_G = ['1m', '5m', '15m', '1h', '4h'] as const satisfies readonly Exclude<Serie, 'dollar'>[];
const CLAVE = 'athenai.v2.mercado';
const hora = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const corto = (s: string) => s.replace(/USDT$/, '');

export default function Mercado() {
  const v = useVps();
  const [sel, setSel] = useState<{ simbolo: string; serie: (typeof SERIES_G)[number] }>(() => {
    try {
      return JSON.parse(localStorage.getItem(CLAVE) ?? '') as { simbolo: string; serie: (typeof SERIES_G)[number] };
    } catch {
      return { simbolo: 'BTCUSDT', serie: '5m' };
    }
  });
  const [velas, setVelas] = useState<VelaG[]>([]);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const ms = MS_SERIE[sel.serie];
  const clave = `${sel.simbolo}-${sel.serie}`;

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(sel));
    } catch {
      // sin almacenamiento: se queda en BTC 5m
    }
    let vivo = true;
    setVelas([]);
    const cargar = () =>
      pedir<{ velas: VelaG[] }>(`/api/velas?simbolo=${sel.simbolo}&serie=${sel.serie}&n=600`).then(
        (x) => vivo && (setVelas(x.velas), setError('')),
        (e: Error) => vivo && setError(e.message),
      );
    void cargar();
    const id = setInterval(cargar, 120_000);
    return () => ((vivo = false), clearInterval(id));
  }, [sel]);

  // Las últimas velas, con las filas que el VPS acaba de grabar (se actualizan cada 5 s).
  const vivas = useMemo<VelaG[]>(() => armarVelas((v.filas[sel.simbolo] ?? []) as unknown as FilaFeatures[], sel.serie).map((x) => [x.inicio, x.open, x.high, x.low, x.close]), [v.filas, sel]);

  // Bots en este mercado: entradas/salidas cerradas y la posición abierta (entrada, stop y objetivo).
  const { marcas, lineas } = useMemo(() => {
    const balde = (t: number) => Math.floor(t / ms) * ms;
    const ops = v.ops.filter((o) => o.simbolo === sel.simbolo).slice(-40);
    const marcas: Marca[] = ops.flatMap((o) => [
      { t: balde(o.entradaT), lado: o.lado, tipo: 'entrada' as const, texto: o.lado > 0 ? 'L' : 'C' },
      { t: balde(o.salidaT), lado: o.lado, tipo: 'salida' as const, texto: usd(o.pnl).replace(' USD', ''), gana: o.pnl >= 0 },
    ]);
    const lineas: Linea[] = v.bots
      .filter((b) => b.simbolo === sel.simbolo && b.posicion)
      .flatMap((b) => {
        const g = b.gestion?.posicion;
        return [
          { precio: b.posicion!.precioEntrada, titulo: `${b.nombre} ${b.posicion!.lado > 0 ? '▲' : '▼'}`, tipo: 'entrada' as const },
          ...(g ? [{ precio: g.stop, titulo: 'stop', tipo: 'stop' as const }] : []),
          ...(g && tieneObjetivo(g.objetivo) ? [{ precio: g.objetivo, titulo: 'objetivo', tipo: 'objetivo' as const }] : []),
        ];
      });
    return { marcas, lineas };
  }, [v.ops, v.bots, sel.simbolo, ms]);

  const ultima = vivas.at(-1) ?? velas.at(-1);
  const primera = velas.at(-Math.round(86_400_000 / ms)) ?? velas[0];
  const cambio = ultima && primera ? ultima[4] / primera[1] - 1 : null;
  const mercados = v.mercados.map((m) => m.simbolo);

  return (
    <div className="mercado-v2">
      <div>
        <div className="et">Mercado · velas y lo que leen los motores ahora</div>
        <h1>{corto(sel.simbolo)} {ultima ? num(ultima[4], ultima[4] < 100 ? 4 : 1) : '—'} {cambio !== null && <small className={cambio >= 0 ? 'sube' : 'baja'}>{cambio >= 0 ? '▲' : '▼'} {num(Math.abs(cambio) * 100)} % · 24 h</small>}</h1>
      </div>
      <section className="caja grafico-caja">
        <div className="barra-graf">
          <div className="seg">{(mercados.length ? mercados : ['BTCUSDT']).map((s) => <button key={s} className={s === sel.simbolo ? 'sel' : ''} onClick={() => setSel({ ...sel, simbolo: s })}>{corto(s)}</button>)}</div>
          <div className="seg">{SERIES_G.map((s) => <button key={s} className={s === sel.serie ? 'sel' : ''} onClick={() => setSel({ ...sel, serie: s })}>{s}</button>)}</div>
          <span className="pista-g mono">rueda o dos dedos: zoom · arrastra: moverte · ▲▼ bots</span>
        </div>
        <Velas velas={velas} vivas={vivas} marcas={marcas} lineas={lineas} clave={clave} />
        {error && <pre className="error-lab">{error}</pre>}
      </section>

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
                <p>{m.explica}</p>
                {mercados.flatMap((s) => eventos(m, v.filas[s] ?? []).map((f) => (
                  <div key={`${s}-${f.cierre}`} className="mono ev">{hora(f.cierre)} · {corto(s)} · {m.clave.filter((k) => f.valores[k]).map((k) => `${k.replace(/_/g, ' ')} ${num(f.valores[k] ?? 0, 0)}`).join(' · ')}</div>
                )))}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
