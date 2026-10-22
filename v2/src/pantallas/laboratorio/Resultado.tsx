// Resultado del Juez (v2): veredicto, puntuación y cada prueba en su pestaña. Nada se pierde de la versión anterior:
// puertas, métricas fuera de muestra, Walk-Forward, Monte Carlo, Luck test, robustez, DSR/PBO, anti-futuro y operaciones.
import { useMemo, useState, type ReactNode } from 'react';
import Pildora from '@/components/ui/Pildora';
import type { Trabajo } from '@/motores/laboratorio/prueba';
import { horasJuez, type RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import type { OperacionGestionada } from '@/motores/juez/salidas';
// Las vistas animadas del Juez de la primera plataforma, sin cambios: mismo código, mismo aspecto.
import CurvaEquityJuez from '@/components/laboratorio/vista/CurvaEquityJuez';
import WalkForwardJuez from '@/components/laboratorio/vista/WalkForwardJuez';
import LuckTestJuez from '@/components/laboratorio/vista/LuckTestJuez';
import MonteCarlo from './MonteCarlo';

const PESTANAS = ['Resumen', 'Walk-Forward', 'Monte Carlo', 'Suerte', 'Robustez', 'Sobreajuste', 'Operaciones'] as const;
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: d })} %`);
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: d }));
const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Anillo de puntuación 0–100. */
function Anillo({ valor }: { valor: number | null }) {
  const largo = 2 * Math.PI * 44;
  return (
    <svg viewBox="0 0 110 110" className="anillo">
      <circle cx="55" cy="55" r="44" className="fondo" />
      <circle cx="55" cy="55" r="44" className="lleno" strokeDasharray={largo} strokeDashoffset={largo * (1 - (valor ?? 0) / 100)} />
      <text x="55" y="54" className="cifra">{valor === null ? '—' : Math.round(valor)}</text>
      <text x="55" y="72" className="sub">de 100</text>
    </svg>
  );
}

const Dato = ({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) => (
  <div className="dato"><span className="et">{k}</span><b className="cifra">{v}</b>{sub && <small>{sub}</small>}</div>
);

export default function Resultado({ t }: { t: Trabajo }) {
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>('Resumen');
  const r = t.resultado!;
  const j = r.juez;
  const oos = j.oos;
  // Lo que las vistas de la primera plataforma leen (los costos no los usan).
  const resp = useMemo(
    () => ({ resultado: j, combos: r.combos, filas: r.velas.total, desde: r.velas.desde, hasta: r.velas.hasta, ...horasJuez(j, r.tiempos) }) as unknown as RespuestaLaboratorio,
    [r, j],
  );

  return (
    <section className="resultado">
      <div className="veredicto caja">
        <Anillo valor={j.score?.total ?? null} />
        <div className="texto">
          <span className="et">Veredicto del Juez · {j.mercado} · velas de {r.velas.serie}</span>
          <h2 className={j.veredicto.startsWith('APROBADA') ? 'si' : ''}>{j.veredicto}</h2>
          <p>{j.resumen}</p>
          <div className="chips-lab mono">
            <span>{num(r.velas.total, 0)} velas</span>
            <span>{fecha(r.velas.desde)} → {fecha(r.velas.hasta)}</span>
            <span>{r.combos.length} variantes</span>
            <span>{r.gestion ? `stop ${r.gestion.stopAtr} ATR · 1:${r.gestion.rr} · ${r.gestion.gestion}` : 'sin GESTION (sale con la señal)'}</span>
            <span className={j.antiFuturo?.ok ? '' : 'mal'}>anti-futuro {j.antiFuturo?.ok ? 'OK' : 'FALLA'}</span>
          </div>
        </div>
      </div>

      <div className="pestanas-lab" role="tablist">
        {PESTANAS.map((p) => (
          <button key={p} role="tab" aria-selected={p === pestana} className={p === pestana ? 'sel' : ''} onClick={() => setPestana(p)}>
            {p === pestana && <Pildora id="pestana-juez-v2" className="pildora-lab" />}
            <span>{p}</span>
          </button>
        ))}
      </div>

      <div className="caja hoja-lab vista-v1" key={pestana}>
        {pestana === 'Resumen' && (
          <>
            <div className="puertas">
              {j.puertas.map((p) => (
                <div key={p.nombre} className={`puerta ${p.ok === true ? 'ok' : p.ok === false ? 'mal' : ''}`}>
                  <i>{p.ok === true ? '✓' : p.ok === false ? '✕' : '–'}</i><span>{p.nombre}</span><small className="mono">{p.valor} · umbral {p.umbral}</small>
                </div>
              ))}
            </div>
            <div className="datos">
              <Dato k="Sharpe OOS" v={num(oos.sharpe)} />
              <Dato k="Retorno OOS" v={pct(oos.retornoTotal)} />
              <Dato k="Caída máxima" v={pct(oos.maxDrawdown)} />
              <Dato k="Aciertos" v={pct(oos.aciertos, 0)} />
              <Dato k="Factor de beneficio" v={num(oos.factorBeneficio)} />
              <Dato k="Operaciones" v={num(oos.operaciones, 0)} />
              <Dato k="Por operación" v={pct(oos.retornoMedioOperacion, 2)} />
              <Dato k="Exposición" v={pct(oos.exposicion, 0)} />
            </div>
            <CurvaEquityJuez r={resp} />
          </>
        )}
        {pestana === 'Walk-Forward' && <WalkForwardJuez r={resp} />}
        {pestana === 'Monte Carlo' && (j.monteCarlo ? <MonteCarlo mc={j.monteCarlo} /> : <p className="vacio">Hacen falta al menos 5 operaciones fuera de muestra para el Monte Carlo.</p>)}
        {pestana === 'Suerte' && <LuckTestJuez r={resp} />}
        {pestana === 'Robustez' && (
          <div className="datos">
            <Dato k="Estado" v={j.robustez.estado} sub={`${j.robustez.fallas} fallas`} />
            <Dato k="Vecinos que también ganan" v={pct(j.robustez.vecinos.proporcion, 0)} sub={j.robustez.vecinos.isla ? 'es una isla: cuidado' : ''} />
            <Dato k="Consistencia por periodos" v={pct(j.robustez.estabilidad.consistencia, 0)} />
            <Dato k="Concentración" v={pct(j.robustez.estabilidad.concentracion, 0)} sub="del beneficio en el mejor periodo" />
          </div>
        )}
        {pestana === 'Sobreajuste' && (
          <div className="datos">
            <Dato k="Deflated Sharpe" v={pct(j.deflatedSharpe, 0)} sub="prob. de que el Sharpe no sea casualidad" />
            <Dato k="PBO" v={pct(j.pbo, 0)} sub="prob. de haber elegido la variante por azar" />
            <Dato k="Ensayos contados" v={j.ensayos} />
            <Dato k="Anti-futuro" v={j.antiFuturo?.ok ? 'OK' : 'FALLA'} sub={j.antiFuturo?.detalle} />
          </div>
        )}
        {pestana === 'Operaciones' && (
          <div className="tabla-ops mono">
            <div className="fila cab"><span>Entrada</span><span>Lado</span><span>Barras</span><span>Resultado</span><span>R</span><span>Salida</span></div>
            {j.operacionesOos.slice(-150).reverse().map((o, i) => {
              const g = o as Partial<OperacionGestionada>;
              return (
                <div key={i} className="fila">
                  <span>{fecha(r.tiempos[o.entrada])}</span><span>{o.lado > 0 ? 'compra' : 'venta'}</span><span>{o.barras}</span>
                  <span className={o.retorno >= 0 ? 'vivo' : 'baja'}>{pct(o.retorno, 2)}</span><span>{g.r === undefined ? '—' : num(g.r)}</span><span>{g.motivo ?? 'señal'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
