// Bots de la Terminal: crear bot (solo estrategias aprobadas por el Juez en ese mercado) y la tarjeta de cada bot.
// Movido tal cual desde la antigua pantalla de Paper Trading.
import { useMemo, useState } from 'react';
import { Bot as IconoBot } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import { Linea } from '@/components/laboratorio/graficos';
import { juiciosDe, leerEstrategias } from '@/components/laboratorio/plantillas';
import { leerPapers } from '@/motores/papers/paper';
import { equity, type Bot } from '@/motores/paper/ejecutor';
import { bandaJuez, exposicionMaxima } from '@/motores/paper/guardian';
import { COSTOS_POR_DEFECTO } from '@/motores/juez/costos';
import { num } from '@/lib/format';
import { NOMBRE_ESTADO, pct, useMotorPaper, usd } from './comun';

export function NuevoBot() {
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

export function TarjetaBot({ b }: { b: Bot }) {
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

