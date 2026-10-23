// Operar a mano en Paper (sin dinero real) con el mismo motor del VPS que los bots: el ticket (riesgo, stop en ATR
// de las velas del gráfico o a un precio, objetivo en R, gestión del Juez) y tus posiciones y operaciones.
// Precio del ticket y de las posiciones: el vivo del VPS (/api/vivo). El VPS vigila stop y objetivo a cada tick.
import { useMemo, useState } from 'react';
import { atrSerie, MODOS_GESTION, type ModoGestion } from '@/motores/juez/salidas';
import { COSTOS_POR_DEFECTO } from '@/motores/juez/costos';
import { CAPITAL_MANUAL, idManual } from '@/motores/paper/motorPaper';
import { APALANCAMIENTOS, costosIdaVuelta, MAX_POSICIONES, previaOrden, RIESGO_MAXIMO, tieneObjetivo, type OrdenManual } from '@/motores/paper/manual';
import type { Bot, MercadoVivo } from '@/motores/paper/ejecutor';
import { pedir } from '../../api';
import { dinero, num, usd } from '../../formato';
import { refrescar, useVps } from '../../vps';
import { useVivo } from '../../vivo';
import type { VelaG } from '../mercado/Velas';
import '../paper/paper.css';
import './terminal.css';

const corto = (s: string) => s.replace(/USDT$/, '');
const RIESGOS = [0.0025, 0.005, 0.01, 0.02];
const STOPS = [1, 1.5, 2, 3];
const RRS = [1.5, 2, 3, 5, 0];
const GESTION: Record<ModoGestion, string> = { fija: 'Fija', be1R: 'BE a 1R', escalonada: 'Escalonada' };
const hora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Ticket({ simbolo, serie, velas }: { simbolo: string; serie: string; velas: VelaG[] }) {
  const v = useVps();
  const tick = useVivo(simbolo);
  const [orden, setOrden] = useState({ riesgoPct: 0.005, riesgoUsd: '', stopAtr: 1.5, stopPrecio: '', rr: 2, gestion: 'be1R' as ModoGestion, apalancamiento: 1 });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Tu cuenta de este mercado (sus posiciones extra comparten su capital) y el nocional que ya tiene abierto.
  const capital = v.manuales.find((b) => b.id === idManual(`binance:${simbolo}`))?.capital ?? CAPITAL_MANUAL;
  const abiertas = v.manuales.filter((b) => b.simbolo === simbolo && b.posicion);
  const cuenta = { capital, abierto: abiertas.reduce((s, b) => s + b.posicion!.cantidad * b.posicion!.precioEntrada, 0) };
  // Riesgo en % de la cuenta o en dólares (1 USD, 0,5 USD…): por dentro siempre es una fracción de la cuenta.
  const riesgoUsd = Number(orden.riesgoUsd.replace(',', '.'));
  const riesgoPct = riesgoUsd > 0 ? riesgoUsd / capital : orden.riesgoPct;
  const enVivo = v.mercados.find((m) => m.simbolo === simbolo)?.conexion === 'en-vivo';
  // «k ATR» se mide con las velas que estás viendo (ATR 14 de esa temporalidad), no con las dollar bars del motor.
  const atr = useMemo(() => atrSerie(velas.map(([, , h, l, c]) => ({ high: h, low: l, close: c }))).at(-1) ?? null, [velas]);
  const stopPrecio = Number(orden.stopPrecio.replace(',', '.'));
  const base: Omit<OrdenManual, 'lado'> = { riesgoPct, gestion: orden.gestion, apalancamiento: orden.apalancamiento, ...(stopPrecio > 0 ? { stopPrecio } : { stopAtr: orden.stopAtr, ...(atr ? { atr } : {}) }), ...(orden.rr ? { rr: orden.rr } : {}) };
  const m: MercadoVivo | null = tick ? { t: tick.t, bid: tick.b, ask: tick.a, precio: tick.p, atr, libro10: null, fundingTasa: null, enVivo } : null;
  const pre = previaOrden(cuenta, m, { ...base, lado: 1 });
  const costos = pre ? costosIdaVuelta(COSTOS_POR_DEFECTO, pre.cantidad * pre.entrada) : null;
  const costosR = pre && costos !== null && pre.riesgoUsd > 0 ? costos / pre.riesgoUsd : null;

  const enviar = (lado: 1 | -1) => {
    setError('');
    setEnviando(true);
    pedir('/api/paper/orden', { proveedor: 'binance', simbolo, lado, ...base })
      .then(refrescar, (e: Error) => setError(e.message))
      .finally(() => setEnviando(false));
  };
  const cambiar = (x: Partial<typeof orden>) => setOrden((o) => ({ ...o, ...x }));

  return (
    <section className="caja ticket">
      <span className="et">Orden a mercado · {corto(simbolo)}</span>
      <div className="bidask mono">
        <span>bid <b className="baja">{tick?.b ? num(tick.b, tick.b < 100 ? 4 : 1) : '—'}</b></span>
        <span>ask <b className="sube">{tick?.a ? num(tick.a, tick.a < 100 ? 4 : 1) : '—'}</b></span>
      </div>
      <label>Riesgo por operación</label>
      <div className="seg">{RIESGOS.map((r) => <button key={r} className={!orden.riesgoUsd && r === orden.riesgoPct ? 'sel' : ''} onClick={() => cambiar({ riesgoPct: r, riesgoUsd: '' })}>{num(r * 100, r < 0.01 ? 2 : 0)} %</button>)}</div>
      <input className="mono" inputMode="decimal" placeholder="o en dólares (p. ej. 1 o 0,5)" value={orden.riesgoUsd} onChange={(e) => cambiar({ riesgoUsd: e.target.value })} aria-label="Riesgo en dólares" />
      <label>Stop {atr && !(stopPrecio > 0) ? <span className="mono">· 1 ATR {serie} = {num(atr, atr < 10 ? 2 : 0)}</span> : null}</label>
      <div className="seg">{STOPS.map((k) => <button key={k} className={!orden.stopPrecio && k === orden.stopAtr ? 'sel' : ''} onClick={() => cambiar({ stopAtr: k, stopPrecio: '' })}>{num(k, k % 1 ? 1 : 0)} ATR</button>)}</div>
      <input className="mono" inputMode="decimal" placeholder="o un precio exacto" value={orden.stopPrecio} onChange={(e) => cambiar({ stopPrecio: e.target.value })} aria-label="Precio del stop" />
      <label>Objetivo</label>
      <div className="seg">{RRS.map((r) => <button key={r} className={r === orden.rr ? 'sel' : ''} onClick={() => cambiar({ rr: r })}>{r ? `1:${num(r, r % 1 ? 1 : 0)}` : 'Sin'}</button>)}</div>
      <label>Apalancamiento <span className="mono">· libres {num(Math.max(0, capital * orden.apalancamiento - cuenta.abierto), 0)} USD · {abiertas.length}/{MAX_POSICIONES} abiertas</span></label>
      <div className="seg">{APALANCAMIENTOS.map((a) => <button key={a} className={a === orden.apalancamiento ? 'sel' : ''} onClick={() => cambiar({ apalancamiento: a })}>{a}×</button>)}</div>
      <label>Gestión del stop</label>
      <div className="seg">{MODOS_GESTION.map((g) => <button key={g} className={g === orden.gestion ? 'sel' : ''} onClick={() => cambiar({ gestion: g })}>{GESTION[g]}</button>)}</div>
      {pre && (
        <div className="previa mono">
          <span>tamaño {num(pre.cantidad, 4)} · {num(pre.cantidad * pre.entrada, 0)} USD</span>
          <span>1R = {num(pre.riesgoUsd)} USD{pre.recortada ? ` (no ${num(capital * riesgoPct)}: con ${orden.apalancamiento}× no cabe más)` : ''}</span>
          {costos !== null && <span className={costosR !== null && costosR > 0.3 ? 'alerta-c' : ''}>costos ida y vuelta ≈ {num(costos)} USD{costosR !== null ? ` = ${num(costosR, 2)} R` : ''}</span>}
          {costosR !== null && costosR > 0.3 && <small>Ojo: comisión y deslizamiento se llevan {num(costosR, 2)} R de cada operación. {orden.rr ? `Si llega al objetivo ganas ${num(orden.rr - costosR, 2)} R; si toca el stop pierdes ${num(1 + costosR, 2)} R. ` : ''}Con un stop más lejos pesan menos.</small>}
        </div>
      )}
      <div className="lados">
        <button className="comprar" disabled={enviando || !enVivo} onClick={() => enviar(1)}>Comprar</button>
        <button className="vender" disabled={enviando || !enVivo} onClick={() => enviar(-1)}>Vender</button>
      </div>
      {!enVivo && <small className="nota-t">{corto(simbolo)} no está en vivo ahora: no se puede operar.</small>}
      {error && <pre className="error-lab">{error}</pre>}
      <small className="nota-t">Riesgo máx. {num(RIESGO_MAXIMO * 100, 0)} %. El tamaño sale del riesgo y la distancia al stop; con apalancamiento, el stop tiene que quedar antes de la liquidación. Hasta {MAX_POSICIONES} posiciones a la vez por mercado, con la misma cuenta. El VPS vigila stop y objetivo a cada tick (100 ms) aunque cierres la página.</small>
    </section>
  );
}

function Posicion({ b, cerrar }: { b: Bot; cerrar: (id: string) => void }) {
  const tick = useVivo(b.simbolo);
  const p = b.posicion!;
  const g = b.gestion?.posicion;
  // Al precio por el que saldrías: bid si estás largo, ask si estás corto.
  const ahora = (p.lado > 0 ? tick?.b : tick?.a) ?? tick?.p ?? b.ultimoPrecio ?? p.precioEntrada;
  const pnl = p.lado * p.cantidad * (ahora - p.precioEntrada);
  const r = g && g.riesgo > 0 ? (p.lado * (ahora - g.precioEntrada)) / g.riesgo : null;
  return (
    <div className={`posicion ${p.lado > 0 ? 'largo' : 'corto'}`}>
      <span>{corto(b.simbolo)} {p.lado > 0 ? '▲ largo' : '▼ corto'} {num(p.cantidad, 4)}</span>
      <span className="mono">entrada {num(p.precioEntrada, 1)}{g ? ` · stop ${num(g.stop, 1)}` : ''}{g && tieneObjetivo(g.objetivo) ? ` · objetivo ${num(g.objetivo, 1)}` : ''}</span>
      <b className={pnl >= 0 ? 'sube' : 'baja'}>{dinero(pnl)} USD{r !== null ? ` · ${r >= 0 ? '+' : ''}${num(r, 2)} R` : ''}</b>
      <button className="boton" onClick={() => cerrar(b.id)}>Cerrar</button>
    </div>
  );
}

/** Tus posiciones abiertas a mano (con el precio vivo) y tus últimas operaciones, con lo que se llevaron los costos. */
export function Manuales() {
  const v = useVps();
  const [error, setError] = useState('');
  const abiertas = v.manuales.filter((b) => b.posicion);
  const ops = useMemo(() => v.ops.filter((o) => o.botId.startsWith('manual:')), [v.ops]);
  const cerrar = (id: string) => void pedir('/api/paper/cerrar', { id }).then(refrescar, (e: Error) => setError(e.message));
  return (
    <>
      <section className="caja bloque-t">
        <span className="et">Posiciones abiertas a mano</span>
        {abiertas.length ? abiertas.map((b) => <Posicion key={b.id} b={b} cerrar={cerrar} />) : <p className="nota-t">Ninguna. Abre una con el ticket: verás la entrada, el stop y el objetivo en el gráfico.</p>}
        {error && <pre className="error-lab">{error}</pre>}
      </section>
      <section className="caja bloque-t">
        <span className="et">Tus últimas operaciones · precio − costos = resultado · todas en el Diario</span>
        {ops.length ? ops.slice(-8).reverse().map((o, i) => {
          const precio = o.lado * o.cantidad * (o.precioSalida - o.precioEntrada);
          return (
            <div key={o.id ?? i} className="fila-op mono">
              <span>{hora(o.salidaT)}</span><span>{corto(o.simbolo)} {o.lado > 0 ? '▲' : '▼'}</span>
              <span>{num(o.precioEntrada, 1)} → {num(o.precioSalida, 1)} · {o.motivo}</span>
              <b className={o.pnl >= 0 ? 'sube' : 'baja'}>{dinero(precio)} − {num(o.comisiones + o.funding)} = {usd(o.pnl)}{o.gestion ? ` · ${o.gestion.r >= 0 ? '+' : ''}${num(o.gestion.r, 2)} R` : ''}</b>
            </div>
          );
        }) : <p className="nota-t">Todavía no cerraste ninguna.</p>}
      </section>
    </>
  );
}
