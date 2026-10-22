// Diario (v2): cada operación cerrada de Paper (bots y a mano) en tu hora: calendario del mes, métricas y la ficha
// de cada una (entrada, salida, puntos, R, lo máximo a favor y en contra, motivo). Verde = ganancia, morado = pérdida.
import { useMemo, useState } from 'react';
import { fichaDeOperacion } from '@/motores/diario/desdePaper';
import { pnlNeto, resultadoPct, resultadoR, resumirDiario, type FichaOperacion } from '@/motores/diario/diario';
import { dinero, num, pct } from '../../formato';
import { useVps } from '../../vps';
import Calendario from './Calendario';
import '../laboratorio/lab.css';
import './diario.css';

const MOTIVO: Record<string, string> = { senal: 'cambio de señal', stop: 'stop', objetivo: 'objetivo', 'break-even': 'break-even', 'stop-en-ganancia': 'stop en ganancia', tiempo: 'tiempo', manual: 'a mano', guardian: 'Guardián / corte' };
const hora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const duracion = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : ms < 86_400_000 ? `${num(ms / 3_600_000, 1)} h` : `${num(ms / 86_400_000, 1)} d`);
const claveLocal = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const signo = (v: number) => (v > 0 ? 'gana' : v < 0 ? 'pierde' : '');

function Ficha({ f }: { f: FichaOperacion }) {
  const neto = pnlNeto(f);
  const r = resultadoR(f);
  const puntos = f.salida ? (f.salida.precio - f.entrada.precio) * f.lado : 0;
  return (
    <article className={`caja ficha-d borde-${signo(neto)}`}>
      <header>
        <b>{f.estrategia}</b>
        <span className="mono sub">{f.mercado.replace('binance:', '')} · {f.lado > 0 ? '▲ largo' : '▼ corto'}</span>
        <b className={`mono res ${signo(neto)}`}>{dinero(neto)} USD</b>
      </header>
      <div className="linea-d mono">
        <span>entró {num(f.entrada.precio)} · {hora(f.entrada.t)}</span>
        <span>salió {num(f.salida!.precio)} · {hora(f.salida!.t)}</span>
      </div>
      <div className="chips-d mono">
        <span className={signo(puntos)}>{puntos >= 0 ? '+' : ''}{num(puntos)} puntos</span>
        <span className={signo(neto)}>{pct(resultadoPct(f) ?? 0)}</span>
        {r !== null && <span className={signo(r)}>{r >= 0 ? '+' : ''}{num(r)} R</span>}
        {f.riesgoUsd > 0 && <span>a favor máx. +{num(f.mfe)} R · en contra {num(-Math.abs(f.mae))} R</span>}
        <span>{duracion(f.salida!.t - f.entrada.t)}</span>
        <span>salió por {MOTIVO[f.salida!.motivo] ?? f.salida!.motivo}</span>
        {f.movimientosStop.length > 0 && <span>stop movido ×{f.movimientosStop.length}</span>}
      </div>
    </article>
  );
}

export default function Diario() {
  const v = useVps();
  const hoy = new Date();
  const [quien, setQuien] = useState('todos');
  const [ym, setYm] = useState({ y: hoy.getFullYear(), m: hoy.getMonth() });
  const [dia, setDia] = useState<string | null>(null);
  const todas = useMemo(() => v.ops.map((o) => fichaDeOperacion(o, v.bots.find((b) => b.id === o.botId))), [v.ops, v.bots]);
  const quienes = useMemo(() => [...new Set(todas.map((f) => f.estrategia))], [todas]);
  const fichas = todas.filter((f) => quien === 'todos' || f.estrategia === quien);
  const r = useMemo(() => resumirDiario(fichas, -new Date().getTimezoneOffset()), [fichas]);
  const x = r.metricas;
  const lista = (dia ? fichas.filter((f) => claveLocal(f.salida!.t) === dia) : fichas.slice(-30)).slice().reverse();
  const mover = (d: number) => {
    const t = new Date(ym.y, ym.m + d, 1);
    setYm({ y: t.getFullYear(), m: t.getMonth() });
    setDia(null);
  };
  const maxH = Math.max(1, ...x.porHora.map((h) => Math.abs(h.pnl)));

  return (
    <div className="diario-v2">
      <div>
        <div className="et">Diario · cada operación cerrada de Paper, en tu hora</div>
        <h1>{x.operaciones ? <>Vas <span className={signo(x.pnlNeto)}>{dinero(x.pnlNeto)} USD</span> en {x.operaciones} operaciones.</> : 'Aún no hay operaciones cerradas.'}</h1>
      </div>
      <div className="seg">{['todos', ...quienes].map((q) => <button key={q} className={q === quien ? 'sel' : ''} onClick={() => setQuien(q)}>{q === 'todos' ? 'Todos' : q}</button>)}</div>
      <div className="kpis-d">
        {([['Aciertos', x.aciertos === null ? '—' : pct(x.aciertos, 0).replace('+', ''), ''], ['Profit factor', x.profitFactor === null ? '—' : num(x.profitFactor), ''], ['Esperanza', x.esperanzaR === null ? '—' : `${num(x.esperanzaR)} R`, signo(x.esperanzaR ?? 0)], ['Caída máxima', `${dinero(-Math.abs(x.maxDrawdown))} USD`, x.maxDrawdown ? 'pierde' : ''], ['Mejor racha', `${x.rachaGanadora} ganadas`, ''], ['Peor racha', `${x.rachaPerdedora} perdidas`, '']] as const).map(([k, val, c]) => (
          <div key={k} className="caja dato"><span className="et">{k}</span><b className={`cifra ${c}`}>{val}</b></div>
        ))}
      </div>
      <div className="dos-d">
        <Calendario dias={r.dias} y={ym.y} m={ym.m} mover={mover} dia={dia} elegir={setDia} />
        <section className="caja horas-d">
          <span className="et">Resultado por hora del día</span>
          <div className="barras-h">
            {x.porHora.map((h, i) => (
              <div key={i} title={`${i}:00 · ${dinero(h.pnl)} USD · ${h.operaciones} ops`}><i className={signo(h.pnl)} style={{ height: `${(Math.abs(h.pnl) / maxH) * 100}%` }} /><small>{i % 6 === 0 ? i : ''}</small></div>
            ))}
          </div>
          <div className="chips-d mono">
            <span className={signo(x.largos.pnl)}>largos {dinero(x.largos.pnl)} · {x.largos.operaciones}</span>
            <span className={signo(x.cortos.pnl)}>cortos {dinero(x.cortos.pnl)} · {x.cortos.operaciones}</span>
            <span>comisiones −{num(x.comisiones)}</span>
          </div>
        </section>
      </div>
      <span className="et">{dia ? `Operaciones del ${dia}` : 'Últimas operaciones'}</span>
      <div className="fichas-d">{lista.map((f) => <Ficha key={f.id} f={f} />)}</div>
      {!lista.length && <p className="vacio">Nada en {dia ? 'ese día' : 'el Diario todavía'}.</p>}
    </div>
  );
}
