// Resultado del Juez (v2): veredicto, puntuación y cada prueba en su pestaña. Nada se pierde de la versión anterior:
// puertas, métricas fuera de muestra, Walk-Forward, Monte Carlo, Luck test, robustez, DSR/PBO, anti-futuro y operaciones.
import { useMemo, useState, type ReactNode } from 'react';
import type { AlignedData } from 'uplot';
import Pildora from '@/components/ui/Pildora';
import type { Trabajo } from '@/motores/laboratorio/prueba';
import type { OperacionGestionada } from '@/motores/juez/salidas';
import { Anillo, BarrasWf, Curvas, Histograma } from './Graficos';

const PESTANAS = ['Resumen', 'Walk-Forward', 'Monte Carlo', 'Suerte', 'Robustez', 'Sobreajuste', 'Operaciones'] as const;
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: d })} %`);
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: d }));
const fecha = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Como mucho `n` puntos para dibujar (el detalle sobra en pantalla). */
const reducir = <T,>(xs: T[], n = 2_000) => (xs.length <= n ? xs : xs.filter((_, i) => i % Math.ceil(xs.length / n) === 0));

const Dato = ({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) => (
  <div className="dato"><span className="et">{k}</span><b className="cifra">{v}</b>{sub && <small>{sub}</small>}</div>
);

export default function Resultado({ t }: { t: Trabajo }) {
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>('Resumen');
  const r = t.resultado!;
  const j = r.juez;
  const oos = j.oos;
  const equity = useMemo((): AlignedData => {
    const tiempos = r.tiempos.slice(j.inicioOos);
    const eq = j.equityOos.length === r.tiempos.length ? j.equityOos.slice(j.inicioOos) : j.equityOos;
    const idx = reducir(tiempos.map((_, i) => i));
    return [idx.map((i) => tiempos[i] / 1000), idx.map((i) => eq[i] ?? 1)];
  }, [r, j]);
  const mc = useMemo((): AlignedData | null => {
    if (!j.monteCarlo) return null;
    const { bandas, caminos } = j.monteCarlo;
    const base = bandas.p50[0] || 1;
    return [bandas.p50.map((_, i) => i), ...caminos.map((c) => c.map((v) => v / base)), bandas.p5.map((v) => v / base), bandas.p50.map((v) => v / base), bandas.p95.map((v) => v / base)];
  }, [j]);

  return (
    <section className="resultado">
      <div className="veredicto caja">
        <Anillo valor={j.score?.total ?? null} texto="de 100" />
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

      <div className="caja hoja-lab" key={pestana}>
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
            <span className="et">Capital fuera de muestra (lo que cuenta)</span>
            <Curvas datos={equity} series={[{}, { stroke: '#fff', width: 1.5, fill: 'rgba(255,255,255,.05)' }]} />
          </>
        )}
        {pestana === 'Walk-Forward' && (
          <>
            <div className="datos">
              <Dato k="Eficiencia (WFE)" v={pct(j.wfo.wfe, 0)} sub={j.wfo.clase ?? ''} />
              <Dato k="Ventanas" v={j.tramos.length} />
              <Dato k="Entrena / prueba" v={`${j.wfo.lIs} / ${j.wfo.lOos}`} sub="velas" />
              <Dato k="Embargo" v={j.wfo.embargo} sub="velas" />
            </div>
            <span className="et">Rendimiento anual fuera de muestra de cada ventana</span>
            <BarrasWf valores={j.tramos.map((x) => x.anualOos)} />
          </>
        )}
        {pestana === 'Monte Carlo' &&
          (j.monteCarlo && mc ? (
            <>
              <div className="datos">
                <Dato k="Retorno P5 · P50 · P95" v={`${pct(j.monteCarlo.p5, 0)} · ${pct(j.monteCarlo.p50, 0)} · ${pct(j.monteCarlo.p95, 0)}`} />
                <Dato k="Caída P95" v={pct(j.monteCarlo.ddP95)} sub={`la real fue ${pct(j.monteCarlo.ddOriginal)}`} />
                <Dato k="Prob. de ruina" v={pct(j.monteCarlo.probRuina)} sub={`caer ${pct(j.monteCarlo.umbralRuina, 0)}`} />
                <Dato k="Simulaciones" v={num(j.monteCarlo.simulaciones, 0)} />
              </div>
              <span className="et">{j.monteCarlo.caminos.length} futuros posibles barajando tus operaciones · bandas P5 / P50 / P95</span>
              <Curvas x="paso" datos={mc} series={[{}, ...j.monteCarlo.caminos.map(() => ({ stroke: 'rgba(255,255,255,.08)', width: 1 })), { stroke: '#8e929a', width: 1, dash: [4, 4] }, { stroke: '#fff', width: 2 }, { stroke: '#8e929a', width: 1, dash: [4, 4] }]} />
            </>
          ) : <p className="vacio">Pocas operaciones para el Monte Carlo.</p>)}
        {pestana === 'Suerte' &&
          (j.suerte ? (
            <>
              <div className="datos">
                <Dato k="p (suerte)" v={num(j.suerte.p, 3)} sub={j.suerte.p < 0.05 ? 'no parece suerte' : 'puede ser suerte'} />
                <Dato k="Escenarios mejores" v={`${j.suerte.superiores} / ${j.suerte.permutaciones}`} />
                <Dato k="Métrica" v={j.suerte.metrica} />
              </div>
              <span className="et">Tu estrategia contra el mismo mercado barajado al azar</span>
              <Histograma muestra={j.suerte.simulaciones} real={j.suerte.real} />
            </>
          ) : <p className="vacio">Pocas operaciones para el Luck test.</p>)}
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
