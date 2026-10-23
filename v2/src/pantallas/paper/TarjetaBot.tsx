// Un bot de Paper (v2): capital y curva, posición con su stop y objetivo, si se comporta como prometió el Juez y
// sus botones. Todo con lo que manda el VPS (/api/paper); las acciones van a /api/paper/{accion}.
import { Pause, Play, Trash2 } from 'lucide-react';
import { equity, type Bot } from '@/motores/paper/ejecutor';
import { bandaJuez, NOMBRE_ESTADO, type ReglasGuardian } from '@/motores/paper/guardian';
import { tieneObjetivo } from '@/motores/paper/manual';
import { num, pct, usd } from '../../formato';


/** Curva de capital del bot (SVG fino, sin ejes). */
function Curva({ puntos }: { puntos: { e: number }[] }) {
  if (puntos.length < 2) return <svg className="curva-bot" />;
  const es = puntos.map((p) => p.e);
  const [lo, hi] = [Math.min(...es), Math.max(...es)];
  const pts = es.map((e, i) => `${(i / (es.length - 1)) * 100},${hi > lo ? 30 - ((e - lo) / (hi - lo)) * 28 : 15}`).join(' ');
  return (
    <svg className="curva-bot" viewBox="0 0 100 32" preserveAspectRatio="none">
      {hi > lo && <polyline points={`0,32 ${pts} 100,32`} className="area" />}
      <polyline points={pts} />
    </svg>
  );
}

export default function TarjetaBot({ b, reglas, accion }: { b: Bot; reglas: ReglasGuardian | null; accion: (nombre: string, cuerpo: object) => void }) {
  const e = equity(b, null);
  const p = b.posicion;
  const g = b.gestion?.posicion;
  const abierto = p ? p.lado * p.cantidad * ((b.ultimoPrecio ?? p.precioEntrada) - p.precioEntrada) : 0;
  const banda = b.operaciones > 0 ? bandaJuez(b, b.operaciones) : null;
  const minimo = reglas?.minOperacionesBanda ?? 5;
  const activo = b.estado === 'activo';
  const decimales = (b.ultimoPrecio ?? 0) < 100 ? 4 : 2;
  return (
    <article className={`caja bot ${activo ? 'activo' : ''}`}>
      <header>
        <div>
          <b>{b.nombre}</b>
          <span className="mono sub">{b.simbolo} · {b.serie ? `velas de ${b.serie}` : 'filas'} · {b.exposicion}× · {b.veredicto}{b.reglasSalida ? ` · stop ${b.reglasSalida.stopAtr} ATR · 1:${b.reglasSalida.rr} · ${b.reglasSalida.gestion}` : ''}</span>
        </div>
        <span className={`estado mono ${activo ? 'on' : ''}`}><i />{NOMBRE_ESTADO[b.estado]}</span>
      </header>
      {b.motivo && <p className="motivo">{b.motivo}</p>}
      <div className="cifras">
        <div><span className="et">Capital</span><b className="cifra">{num(e)}</b><small className={e >= b.capitalInicial ? 'sube' : 'baja'}>{pct(e / b.capitalInicial - 1)}</small></div>
        <div><span className="et">Hoy</span><b className="cifra">{pct(b.dia.pico > 0 ? e / b.dia.pico - 1 : 0)}</b><small>desde el máximo del día</small></div>
        <div><span className="et">Operaciones</span><b className="cifra">{b.operaciones}</b><small>{b.perdidasSeguidas} pérdidas seguidas</small></div>
      </div>
      <Curva puntos={b.curva} />
      <div className={`posicion ${p ? (p.lado > 0 ? 'largo' : 'corto') : ''}`}>
        {p ? (
          <>
            <span className="mono">{p.lado > 0 ? '▲ Largo' : '▼ Corto'} · entró {num(p.precioEntrada, decimales)} · ahora {num(b.ultimoPrecio ?? p.precioEntrada, decimales)}</span>
            <b className={`mono ${abierto >= 0 ? 'sube' : 'baja'}`}>{usd(abierto)}</b>
            {g && <span className="mono sub">stop {num(g.stop, decimales)}{tieneObjetivo(g.objetivo) ? ` · objetivo ${num(g.objetivo, decimales)}` : ''} · {b.gestion!.reglas.gestion}</span>}
          </>
        ) : (
          <span className="mono sub">Fuera del mercado · esperando su señal</span>
        )}
      </div>
      <p className="banda">
        <span className="et">¿Cumple lo que prometió el Juez?</span>
        {!banda ? (
          ' Aún sin operaciones cerradas para comparar.'
        ) : (
          <>
            {' '}Tras {b.operaciones} operaciones va <b>{pct(b.retornoUnidadAcum)}</b>. El Juez esperaba entre <b>{pct(banda.p5)}</b> y <b>{pct(banda.p95)}</b>.{' '}
            {b.operaciones < minimo ? `Se juzga desde ${minimo} operaciones.` : b.retornoUnidadAcum < banda.p5 ? <b className="baja">Por debajo de lo esperado.</b> : <b className="sube">Dentro de lo esperado.</b>}
          </>
        )}
      </p>
      <footer>
        {activo ? (
          <button className="boton" onClick={() => accion('pausar', { id: b.id })}><Pause size={12} /> Pausar</button>
        ) : (
          <button className="boton" onClick={() => accion('reanudar', { id: b.id })}><Play size={12} /> Reanudar</button>
        )}
        <button className="boton quitar" onClick={() => confirm(`¿Borrar el bot «${b.nombre}»? Si tiene una posición, se cierra.`) && accion('borrar', { id: b.id })}><Trash2 size={12} /> Borrar</button>
      </footer>
    </article>
  );
}
