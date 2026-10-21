import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Bot as IconoBot, Download, Power, ShieldAlert, ShieldCheck } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import { Explicacion, Linea } from '@/components/laboratorio/graficos';
import { juiciosDe, leerEstrategias } from '@/components/laboratorio/plantillas';
import { leerPapers } from '@/motores/papers/paper';
import { motorPaper } from '@/motores/paper/iniciar';
import { equity, operacionesCsv, type Bot, type EstadoBot, type OperacionPaper } from '@/motores/paper/ejecutor';
import { bandaJuez, exposicionMaxima } from '@/motores/paper/guardian';
import { COSTOS_POR_DEFECTO } from '@/motores/juez/costos';
import { descargarCsv } from '@/motores/worker/motorCliente';
import { conSigno, num } from '@/lib/format';

const pct = (v: number, d = 2) => conSigno(v * 100, d, '%');
const usd = (v: number) => `${conSigno(v, 2)} USD`;
const hora = (t: number) => new Date(t).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const NOMBRE_ESTADO: Record<EstadoBot, string> = {
  activo: 'Activo',
  'sin-datos': 'Sin datos',
  'pausado-dia': 'Pausado hasta mañana',
  cuarentena: 'Cuarentena',
  'fuera-de-banda': 'Fuera de la banda del Juez',
  pausado: 'Pausado',
  apagado: 'Apagado',
};

/** Re-renderiza con cada revisión del motor de Paper (1 vez por segundo). */
function useMotorPaper() {
  const [, setN] = useState(0);
  useEffect(() => motorPaper.suscribir(() => setN((n) => n + 1)), []);
  return motorPaper;
}

function useOperaciones(total: number): OperacionPaper[] {
  const [ops, setOps] = useState<OperacionPaper[]>([]);
  useEffect(() => {
    let vivo = true;
    void motorPaper.operaciones().then((x) => vivo && setOps(x));
    return () => {
      vivo = false;
    };
  }, [total]);
  return ops;
}

const ahoraSuscribir = (cb: () => void) => {
  const id = setInterval(cb, 1_000);
  return () => clearInterval(id);
};

function NuevoBot() {
  const motor = useMotorPaper();
  // Candidatas = pares estrategia + mercado que el Juez aprobó EN ESE mercado (un bot nunca sale de él).
  const candidatas = useMemo(() => {
    const papers = leerPapers();
    return leerEstrategias().flatMap((e) =>
      juiciosDe(e)
        .filter((j) => exposicionMaxima(j.veredicto) > 0)
        .map((j) => ({
          clave: `${e.id}|${j.mercado}`,
          e,
          j,
          p: papers.find((x) => x.id === j.paperId) ?? papers.filter((x) => x.estrategia === e.nombre && (x.mercado ? x.mercado === j.mercado : x.simbolo === j.simbolo)).sort((a, b) => b.creado - a.creado)[0],
        })),
    );
  }, []);
  const [sel, setSel] = useState(candidatas[0]?.clave ?? '');
  const [capital, setCapital] = useState(10_000);
  const elegida = candidatas.find((x) => x.clave === sel);
  const max = exposicionMaxima(elegida?.j.veredicto);
  const [exposicion, setExposicion] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    if (!elegida) return;
    setError(null);
    try {
      await motor.crearBot({
        nombre: elegida.e.nombre,
        estrategiaId: elegida.e.id,
        codigo: elegida.e.codigo,
        combo: elegida.j.combo,
        proveedor: elegida.j.proveedor,
        simbolo: elegida.j.simbolo,
        mercadoAprobado: elegida.j.mercado,
        veredicto: elegida.j.veredicto,
        score: elegida.p?.respuesta.resultado.score?.total ?? null,
        capital,
        exposicion: Math.min(max, exposicion),
        costos: elegida.p?.costos ?? COSTOS_POR_DEFECTO,
        retornosJuez: (elegida.p?.respuesta.operaciones ?? []).map((o) => o.retorno),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Panel titulo="Nuevo bot" icono={IconoBot} cuerpo="space-y-3 p-4">
      {!candidatas.length ? (
        <p className="text-xs text-plata-400">Todavía no tienes estrategias aprobadas por el Juez. Pruébalas en el Laboratorio: solo las APROBADAS (o con reserva) pueden tener bot.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="etiqueta">Estrategia y mercado aprobados</span>
            <select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Estrategia" className="mt-1 block rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
              {candidatas.map(({ clave, e, j }) => (
                <option key={clave} value={clave}>
                  {e.nombre} · {j.simbolo} · {j.veredicto}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="etiqueta">Capital (USD, sin dinero real)</span>
            <input type="number" min={100} step={1000} value={capital} onChange={(e) => setCapital(Number(e.target.value))} aria-label="Capital" className="mt-1 w-28 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
          </label>
          <label className="block">
            <span className="etiqueta">Exposición (máx. {max}×)</span>
            <input type="number" min={0.1} max={max} step={0.1} value={Math.min(max, exposicion)} onChange={(e) => setExposicion(Number(e.target.value))} aria-label="Exposición" className="mt-1 w-20 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
          </label>
          <button onClick={crear} disabled={motor.apagado || !elegida} className="rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black disabled:opacity-40">
            Crear bot
          </button>
        </div>
      )}
      {elegida && (
        <p className="text-[11px] text-plata-400" data-solo-mercado={elegida.j.mercado}>
          Este bot solo opera <span className="text-white">{elegida.j.simbolo}</span> ({elegida.j.mercado}), el mercado donde el Juez aprobó la estrategia. Nunca opera otro activo.
        </p>
      )}
      {elegida && !elegida.p?.respuesta.operaciones?.length && <p className="text-[11px] text-plata-400">⚠ No hay operaciones guardadas de su prueba del Juez: el bot funcionará, pero sin banda para comparar. Vuelve a pasarla por el Juez para tenerla.</p>}
      {error && <p className="text-xs text-white">{error}</p>}
    </Panel>
  );
}

function TarjetaBot({ b }: { b: Bot }) {
  const motor = useMotorPaper();
  const m = motor.mercado(b);
  const e = equity(b, m?.enVivo ? m : null);
  const pos = b.posicion;
  const banda = b.operaciones > 0 ? bandaJuez(b, b.operaciones) : null;
  const sinPnlHoy = b.dia.pico > 0 ? e / b.dia.pico - 1 : 0;
  const parado = b.estado !== 'activo' && b.estado !== 'sin-datos' && b.estado !== 'pausado-dia';
  return (
    <Panel
      titulo={
        <span>
          {b.nombre} <span className="text-plata-500">· {b.simbolo} · {b.exposicion}×</span>
        </span>
      }
      accion={<span className={`rounded border px-2 py-0.5 text-[10px] ${b.estado === 'activo' ? 'border-plata-300 text-white' : 'border-borde text-plata-300'}`} data-estado-bot={b.estado}>{NOMBRE_ESTADO[b.estado]}</span>}
      cuerpo="space-y-3 p-4"
    >
      {b.motivo && <p className="text-[11px] text-plata-300">{b.motivo}</p>}
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          ['Capital ahora', `${num(e, 2)} USD`, `${pct(e / b.capitalInicial - 1)} desde ${num(b.capitalInicial)} USD`],
          ['Hoy', pct(sinPnlHoy), `caída desde el máximo del día`],
          ['Posición', pos ? `${pos.lado > 0 ? 'Largo' : 'Corto'} ${num(pos.cantidad, 4)}` : 'Fuera', pos ? `entrada ${num(pos.precioEntrada, 2)} · ${usd(pos.lado * pos.cantidad * ((m?.precio ?? pos.precioEntrada) - pos.precioEntrada))}` : '—'],
          ['Operaciones', num(b.operaciones), `${b.perdidasSeguidas} pérdidas seguidas`],
        ].map(([k, v, n]) => (
          <div key={k} className="rounded-lg border border-borde-suave p-2.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-plata-500">{k}</p>
            <p className="cifra text-base font-light text-white">{v}</p>
            <p className="text-[10.5px] text-plata-400">{n}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-borde-suave p-2.5 text-[11px] text-plata-300" data-banda>
        <p className="text-[10px] uppercase tracking-[0.12em] text-plata-500">¿Se comporta como dijo el Juez?</p>
        {banda ? (
          <p>
            Tras {b.operaciones} operaciones va <span className="text-white">{pct(b.retornoUnidadAcum)}</span> (a exposición 1×). El Juez esperaba entre <span className="text-white">{pct(banda.p5)}</span> (P5) y <span className="text-white">{pct(banda.p95)}</span> (P95), lo normal {pct(banda.p50)}.{' '}
            {b.operaciones < motor.reglas.minOperacionesBanda ? `Aún son pocas: el Guardián lo juzga desde ${motor.reglas.minOperacionesBanda} operaciones.` : b.retornoUnidadAcum < banda.p5 ? <b className="text-white">Por debajo de lo esperado.</b> : 'Dentro de lo esperado.'}
          </p>
        ) : (
          <p>{b.retornosJuez.length ? 'Aún sin operaciones cerradas.' : 'Sin operaciones del Juez para comparar.'}</p>
        )}
      </div>
      {b.curva.length > 1 && <Linea datos={[...b.curva.map((x) => x.e), e]} base={b.capitalInicial} alto={120} />}
      <div className="flex flex-wrap gap-2">
        {parado || b.estado === 'pausado-dia' ? (
          <button onClick={() => void motor.reanudar(b.id)} disabled={motor.apagado} className="rounded-md border border-borde px-3 py-1.5 text-[11px] text-plata-200 hover:text-white disabled:opacity-40">
            Reanudar
          </button>
        ) : (
          <button onClick={() => void motor.pausar(b.id)} className="rounded-md border border-borde px-3 py-1.5 text-[11px] text-plata-200 hover:text-white">
            Pausar (cierra la posición)
          </button>
        )}
        <button onClick={() => window.confirm(`¿Borrar el bot «${b.nombre}» y sus operaciones?`) && void motor.borrar(b.id)} className="rounded-md border border-borde px-3 py-1.5 text-[11px] text-plata-400 hover:text-white">
          Borrar
        </button>
      </div>
    </Panel>
  );
}

export default function PaperTradingView() {
  const motor = useMotorPaper();
  useSyncExternalStore(ahoraSuscribir, () => Math.floor(Date.now() / 1_000));
  const totalOps = motor.bots.reduce((s, b) => s + b.operaciones, 0);
  const ops = useOperaciones(totalOps);
  const pnl = ops.reduce((s, o) => s + o.pnl, 0);
  const dentro = motor.bots.filter((b) => b.posicion).length;
  const nombre = (id: string) => motor.bots.find((b) => b.id === id)?.nombre ?? '—';

  return (
    <div className="space-y-4">
      <Encabezado modulo="Paper Trading" titulo="Bots en Paper (sin dinero real)" descripcion="Las estrategias aprobadas por el Juez operan sin dinero real sobre el mercado en vivo, con comisión, deslizamiento y funding, vigiladas por el Guardián.">
        {motor.apagado ? (
          <button onClick={() => motor.rearmar()} className="flex items-center gap-2 rounded-lg border border-white px-3.5 py-2 text-xs text-white" data-rearmar>
            <ShieldCheck size={13} /> Apagado activo · Rearmar
          </button>
        ) : (
          <button onClick={() => window.confirm('¿Cerrar todas las posiciones y apagar todos los bots?') && void motor.apagarTodo()} className="flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black" data-apagado>
            <Power size={13} /> Apagado de emergencia
          </button>
        )}
      </Encabezado>

      <p className={`rounded-lg border px-3 py-2 text-[11px] ${motor.enVps ? 'border-white/40 text-white' : 'border-borde text-plata-400'}`} data-donde-bots={motor.enVps ? 'vps' : 'navegador'}>
        {motor.enVps ? 'Bots en tu VPS · 24/7: siguen operando aunque cierres la plataforma.' : 'Bots en este navegador: se detienen si lo cierras. Conecta la grabadora del VPS (Datos → Grabadora 24/7) para que corran 24/7.'}
      </p>

      <Explicacion
        que="cada bot es una estrategia que el Juez aprobó, operando sola sobre el precio real (compra al precio de venta del libro, vende al de compra) sin dinero real. Paga comisión, deslizamiento y funding como en la realidad."
        sirve="ver si la estrategia hace en vivo lo que prometió en la prueba. Si se sale de lo esperado, el Guardián la frena antes de pensar en dinero real."
        mirar="que el capital suba con el tiempo y que «¿Se comporta como dijo el Juez?» diga «dentro de lo esperado». Los bots necesitan semanas y muchas operaciones para concluir algo."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Bots', num(motor.bots.length)],
          ['En posición', num(dentro)],
          ['Resultado de las operaciones', usd(pnl)],
          ['Operaciones', num(ops.length)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-borde-suave p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-plata-500">{k}</p>
            <p className="cifra text-xl font-light text-white">{v}</p>
          </div>
        ))}
      </div>

      <NuevoBot />

      {motor.bots.length ? <div className="grid gap-4 xl:grid-cols-2">{motor.bots.map((b) => <TarjetaBot key={b.id} b={b} />)}</div> : null}

      <Panel
        titulo="Libro de operaciones"
        accion={
          <button onClick={() => descargarCsv(operacionesCsv(ops), 'operaciones-paper.csv')} disabled={!ops.length} className="flex items-center gap-1 rounded-md border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:text-white disabled:opacity-40">
            <Download size={11} /> CSV
          </button>
        }
        cuerpo="overflow-x-auto px-4 py-2"
      >
        {ops.length ? (
          <table className="w-full min-w-[820px] text-left text-[11px]" data-operaciones={ops.length}>
            <thead>
              <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
                <th className="py-1 font-normal">Bot</th>
                <th className="py-1 font-normal">Lado</th>
                <th className="py-1 font-normal">Entrada → salida</th>
                <th className="py-1 text-right font-normal">Precios</th>
                <th className="py-1 text-right font-normal">Costos (com. + desl. + funding)</th>
                <th className="py-1 text-right font-normal">Resultado</th>
                <th className="py-1 font-normal">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {ops.slice(-50).reverse().map((o) => (
                <tr key={o.id} className="border-t border-borde-suave">
                  <td className="py-1 text-plata-200">{nombre(o.botId)} <span className="text-plata-500">{o.simbolo}</span></td>
                  <td className="py-1 text-plata-200">{o.lado > 0 ? 'Largo' : 'Corto'}</td>
                  <td className="py-1 text-plata-400">{hora(o.entradaT)} → {hora(o.salidaT)}</td>
                  <td className="cifra py-1 text-right text-plata-300">{num(o.precioEntrada, 2)} → {num(o.precioSalida, 2)}</td>
                  <td className="cifra py-1 text-right text-plata-400">{num(o.comisiones, 2)} + {num(o.deslizamientoUsd, 2)} + {num(o.funding, 2)}</td>
                  <td className="cifra py-1 text-right text-white">{usd(o.pnl)} · {pct(o.retorno)}</td>
                  <td className="py-1 text-plata-400">{o.motivo === 'senal' ? 'señal' : o.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-3 text-center text-xs text-plata-500">Aún no hay operaciones cerradas.</p>
        )}
      </Panel>

      <Panel titulo="Guardián" icono={ShieldAlert} cuerpo="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="etiqueta">Caída máxima del día (%)</span>
            <input type="number" min={0.5} step={0.5} value={motor.reglas.ddDiarioMax * 100} onChange={(e) => motor.setReglas({ ddDiarioMax: Math.max(0.005, Number(e.target.value) / 100) })} aria-label="Caída máxima del día" className="mt-1 w-20 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
          </label>
          <label className="block">
            <span className="etiqueta">Pérdidas seguidas → cuarentena</span>
            <input type="number" min={1} step={1} value={motor.reglas.perdidasSeguidasMax} onChange={(e) => motor.setReglas({ perdidasSeguidasMax: Math.max(1, Math.round(Number(e.target.value))) })} aria-label="Pérdidas seguidas" className="mt-1 w-20 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
          </label>
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-borde-suave p-2 font-mono text-[10.5px]" data-bitacora>
          {motor.bitacora.length ? (
            motor.bitacora.slice(0, 60).map((x, i) => (
              <p key={`${x.t}-${i}`} className={x.grave ? 'text-white' : 'text-plata-400'}>
                {hora(x.t)} · {x.nombre}: {x.texto}
              </p>
            ))
          ) : (
            <p className="text-plata-500">Sin novedades. Aquí aparece cada entrada, salida y cada vez que el Guardián actúa (también se envía a Discord / Telegram / ntfy si los configuraste en Datos).</p>
          )}
        </div>
        <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
          <summary className="cursor-pointer text-plata-100">Cómo se calcula</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Señal: al cerrar cada barra se calcula la posición de la estrategia con la variante que eligió el Juez. El bot solo actúa cuando la señal cambia (no se sube a una posición ya empezada).</li>
            <li>Compra = ask × (1 + d) y venta = bid × (1 − d). d = deslizamiento base + 10 % del ATR relativo + (tamaño de la orden ÷ liquidez de 10 niveles) × distancia del 10.º nivel, con tope de 0,5 %.</li>
            <li>Tamaño = capital × exposición. Comisión taker en la entrada y en la salida. Funding a las 00, 08 y 16 UTC: lado × cantidad × precio × tasa (con tasa positiva el largo paga y el corto cobra).</li>
            <li>Resultado = lado × cantidad × (salida − entrada) − comisiones − funding. Retorno = resultado ÷ capital antes de entrar.</li>
            <li>Banda del Juez: se toman al azar k operaciones del Juez (con reemplazo), se encadenan, 2.000 veces, y se miran el P5, P50 y P95. Si el bot va por debajo del P5 tras ≥ {motor.reglas.minOperacionesBanda} operaciones, el Guardián lo pausa.</li>
            <li>Guardián: caída del día ≥ {num(motor.reglas.ddDiarioMax * 100, 1)} % desde el máximo del día (UTC) → cierra y pausa hasta mañana. {motor.reglas.perdidasSeguidasMax} pérdidas seguidas → cuarentena. Sin datos en vivo → no opera, y una posición abierta se cierra al volver. Exposición máxima: APROBADA 1×, con reserva 0,5×.</li>
            <li>Apagado de emergencia: cierra todas las posiciones al precio de ese momento y apaga todos los bots.</li>
          </ul>
        </details>
      </Panel>
    </div>
  );
}
