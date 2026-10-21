import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Copy, FilePlus2, Gavel, Play, Square, Trash2 } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import Insignia from '@/components/ui/Insignia';
import { NOMBRE_PROVEEDOR } from '@/components/orderflow/OrderFlowChart';
import { laboratorio } from '@/motores/laboratorio/laboratorioCliente';
import { notificador } from '@/motores/notificaciones/notificador';
import type { RespuestaLaboratorio } from '@/motores/laboratorio/protocolo';
import { COSTOS_POR_DEFECTO } from '@/motores/juez/backtest';
import { claveFuente, useFuentesGuardadas } from './fuentesGuardadas';
import { NOMBRE_OBJETIVO, type ObjetivoWfo } from '@/motores/juez/walkForward';
import { MC_POR_DEFECTO, type MetodoMc } from '@/motores/juez/monteCarlo';
import { LUCK_POR_DEFECTO, NOMBRE_METODO_LUCK, NOMBRE_METRICA_LUCK, type MetodoLuck, type MetricaLuck } from '@/motores/juez/luckTest';
import { DEFINICIONES_FEATURES } from '@/motores/nucleo/features';
import { num } from '@/lib/format';
import { guardarEstrategias, leerEstrategias, PLANTILLAS, type EstrategiaGuardada } from './plantillas';
import ResultadoJuezVista from './ResultadoJuez';
import BibliotecaPapers, { AccionesPaper, VisorPaper } from './BibliotecaPapers';
import { crearPaper, guardarPaper, type Paper } from '@/motores/papers/paper';

const clave = claveFuente;

/** Laboratorio real: estrategias en Python sobre tus Features guardadas, juzgadas por el Juez. */
export default function EstrategiasPython() {
  const [estrategias, setEstrategias] = useState<EstrategiaGuardada[]>(leerEstrategias);
  const [selId, setSelId] = useState(estrategias[0].id);
  const sel = estrategias.find((x) => x.id === selId) ?? estrategias[0];
  const fuentes = useFuentesGuardadas();
  const [datos, setDatos] = useState('');
  const [otro, setOtro] = useState('');
  const [comision, setComision] = useState(COSTOS_POR_DEFECTO.comisionPb);
  const [deslizamiento, setDeslizamiento] = useState(COSTOS_POR_DEFECTO.deslizamientoPb);
  // Walk-Forward: automático salvo que se cambie en «Avanzado» (0 = automático).
  const [objetivoWfo, setObjetivoWfo] = useState<ObjetivoWfo>('sharpe');
  const [lIs, setLIs] = useState(0);
  const [lOos, setLOos] = useState(0);
  const [metodoMc, setMetodoMc] = useState<MetodoMc>(MC_POR_DEFECTO.metodo);
  const [simulaciones, setSimulaciones] = useState(MC_POR_DEFECTO.simulaciones);
  const [ruinaPct, setRuinaPct] = useState(MC_POR_DEFECTO.umbralRuina * 100);
  const [capital, setCapital] = useState(MC_POR_DEFECTO.capitalInicial);
  const [metodoLuck, setMetodoLuck] = useState<MetodoLuck>(LUCK_POR_DEFECTO.metodo);
  const [metricaLuck, setMetricaLuck] = useState<MetricaLuck>(LUCK_POR_DEFECTO.metrica);
  const [permutaciones, setPermutaciones] = useState(LUCK_POR_DEFECTO.permutaciones);
  const [corriendo, setCorriendo] = useState(false);
  const [progreso, setProgreso] = useState<string[]>([]);
  const [resultado, setResultado] = useState<RespuestaLaboratorio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [viendo, setViendo] = useState<Paper | null>(null);
  const [versionPapers, setVersionPapers] = useState(0);
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => guardarEstrategias(estrategias), [estrategias]);
  useEffect(() => {
    if (fuentes[0]) setDatos((d) => d || clave(fuentes[0]));
  }, [fuentes]);

  const cambiar = (cambios: Partial<EstrategiaGuardada>) => setEstrategias((xs) => xs.map((x) => (x.id === sel.id ? { ...x, ...cambios, actualizada: Date.now() } : x)));
  // Un duplicado hereda las variantes ya probadas: sigue siendo la misma idea sobre los mismos datos.
  const nueva = (nombre: string, codigo: string, ensayos = 0) => {
    const e: EstrategiaGuardada = { id: `e-${Date.now()}`, nombre, codigo, ensayos, actualizada: Date.now() };
    setEstrategias((xs) => [e, ...xs]);
    setSelId(e.id);
    setResultado(null);
  };
  const borrar = () => {
    if (estrategias.length <= 1 || !window.confirm(`¿Borrar «${sel.nombre}»?`)) return;
    const resto = estrategias.filter((x) => x.id !== sel.id);
    setEstrategias(resto);
    setSelId(resto[0].id);
  };
  const insertar = (texto: string) => {
    const t = editor.current;
    if (!t) return;
    const { selectionStart: a, selectionEnd: b } = t;
    cambiar({ codigo: sel.codigo.slice(0, a) + texto + sel.codigo.slice(b) });
    requestAnimationFrame(() => {
      t.focus();
      t.selectionStart = t.selectionEnd = a + texto.length;
    });
  };

  const ejecutar = async () => {
    const f = fuentes.find((x) => clave(x) === datos);
    if (!f) return;
    const o = fuentes.find((x) => clave(x) === otro && clave(x) !== datos) ?? null;
    setCorriendo(true);
    setError(null);
    setResultado(null);
    setProgreso([]);
    try {
      const r = await laboratorio.ejecutar(
        { codigo: sel.codigo, proveedor: f.proveedor, simbolo: f.simbolo, otro: o && { proveedor: o.proveedor, simbolo: o.simbolo }, costos: { comisionPb: comision, deslizamientoPb: deslizamiento }, ensayosPrevios: sel.ensayos, wfo: { objetivo: objetivoWfo, lIs, lOos }, monteCarlo: { metodo: metodoMc, simulaciones: Math.min(10_000, Math.max(100, simulaciones)), umbralRuina: ruinaPct / 100, capitalInicial: capital }, luck: { metodo: metodoLuck, metrica: metricaLuck, permutaciones: Math.min(10_000, Math.max(100, permutaciones)) } },
        (t) => setProgreso((p) => [...p.slice(-6), t]),
      );
      setResultado(r);
      // Cada prueba del Juez queda como paper en la biblioteca.
      const paper = crearPaper({ estrategia: sel.nombre, codigo: sel.codigo, simbolo: f.simbolo, proveedor: NOMBRE_PROVEEDOR[f.proveedor], costos: { comisionPb: comision, deslizamientoPb: deslizamiento }, respuesta: r });
      guardarPaper(paper);
      setPaper(paper);
      setVersionPapers((v) => v + 1);
      notificador.juez(sel.nombre, f.simbolo, r.resultado.veredicto, r.resultado.resumen);
      cambiar({ ensayos: sel.ensayos + r.combos.length, ultimoVeredicto: r.resultado.veredicto, juzgada: { proveedor: f.proveedor, simbolo: f.simbolo, combo: r.combos[r.resultado.dentroMuestra.combo] ?? {} } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCorriendo(false);
    }
  };

  const lineas = useMemo(() => sel.codigo.split('\n').length, [sel.codigo]);

  return (
    <div className="space-y-4" data-laboratorio-python>
      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <Panel titulo="Mis estrategias" icono={Code2} cuerpo="space-y-1 p-2">
          {estrategias.map((x) => (
            <button key={x.id} onClick={() => {
                setSelId(x.id);
                setResultado(null);
                setError(null);
              }} className={`block w-full rounded-lg px-2.5 py-2 text-left ${x.id === sel.id ? 'bg-white/[0.07] text-white' : 'text-plata-300 hover:bg-white/[0.03]'}`}>
              <span className="block truncate text-xs">{x.nombre}</span>
              <span className="text-[10px] text-plata-500">
                {x.ultimoVeredicto ?? 'sin probar'} · {x.ensayos} {x.ensayos === 1 ? 'variante probada' : 'variantes probadas'}
              </span>
            </button>
          ))}
          <div className="border-t border-borde-suave pt-2">
            <p className="etiqueta px-1 pb-1">Nueva desde plantilla</p>
            {PLANTILLAS.map((p) => (
              <button key={p.nombre} onClick={() => nueva(p.nombre, p.codigo)} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] text-plata-400 hover:text-white">
                <FilePlus2 size={11} /> {p.nombre}
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          titulo="Editor · Python"
          icono={Code2}
          accion={
            <div className="flex items-center gap-2">
              <button onClick={() => nueva(`${sel.nombre} (copia)`, sel.codigo, sel.ensayos)} className="flex items-center gap-1 text-[10.5px] text-plata-400 hover:text-white" title="Duplicar (conserva el contador de variantes probadas)">
                <Copy size={11} /> Duplicar
              </button>
              <button onClick={borrar} className="flex items-center gap-1 text-[10.5px] text-plata-400 hover:text-white">
                <Trash2 size={11} /> Borrar
              </button>
            </div>
          }
          cuerpo="space-y-3 p-4"
        >
          <input value={sel.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} aria-label="Nombre de la estrategia" className="w-full rounded-md border border-borde bg-black px-2.5 py-1.5 text-sm text-white outline-none focus:border-plata-400" />
          <div className="flex overflow-hidden rounded-lg border border-borde bg-black">
            <pre aria-hidden className="select-none border-r border-borde-suave px-2 py-2 text-right font-mono text-[11.5px] leading-[1.55] text-plata-600">
              {Array.from({ length: lineas }, (_, i) => i + 1).join('\n')}
            </pre>
            <textarea
              ref={editor}
              value={sel.codigo}
              spellCheck={false}
              aria-label="Código de la estrategia"
              onChange={(e) => cambiar({ codigo: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  insertar('    ');
                }
              }}
              className="min-h-[360px] flex-1 resize-y whitespace-pre bg-transparent px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-plata-100 outline-none"
              wrap="off"
            />
          </div>
          <details className="text-[11px] text-plata-400">
            <summary className="cursor-pointer select-none text-plata-300">Cómo se escribe una estrategia y qué datos hay ({DEFINICIONES_FEATURES.length} Features)</summary>
            <div className="mt-2 space-y-2">
              <p>
                Define <span className="font-mono text-plata-100">estrategia(filas, p)</span>: recibe todas las dollar bars en orden (cada fila es un diccionario) y devuelve una posición por fila: <span className="font-mono">1</span> largo, <span className="font-mono">-1</span> corto, <span className="font-mono">0</span> fuera. La posición de una fila solo puede usar esa fila y las anteriores: el Juez lo comprueba. <span className="font-mono text-plata-100">PARAMETROS</span> (opcional) es la rejilla de valores que el Walk-Forward elige tramo a tramo. Python estándar (sin numpy).
              </p>
              <div className="flex flex-wrap gap-1">
                {['cierre', 'close', ...DEFINICIONES_FEATURES.map((d) => d.clave)].map((k) => (
                  <button key={k} onClick={() => insertar(`f.get("${k}")`)} title={DEFINICIONES_FEATURES.find((d) => d.clave === k)?.descripcion ?? k} className="rounded border border-borde-suave px-1.5 py-0.5 font-mono text-[10px] text-plata-300 hover:border-plata-400 hover:text-white">
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </details>
        </Panel>
      </div>

      <Panel titulo="Probar con el Juez" icono={Gavel} accion={<Insignia variante="contorno">{sel.ensayos} {sel.ensayos === 1 ? 'variante probada' : 'variantes probadas'} con esta idea</Insignia>} cuerpo="space-y-3 p-4">
        {!fuentes.length && <p className="text-xs text-plata-400">No hay datos guardados todavía. Activa una fuente en el Centro de datos con «Guardar las Features» y deja grabando el mercado.</p>}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_auto_auto]">
          <label className="block">
            <span className="etiqueta">Datos</span>
            <select value={datos} onChange={(e) => setDatos(e.target.value)} aria-label="Datos para la prueba" className="mt-1 w-full rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
              {fuentes.map((f) => (
                <option key={clave(f)} value={clave(f)}>
                  {f.simbolo} · {NOMBRE_PROVEEDOR[f.proveedor]} · {num(f.filas)} filas
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="etiqueta">Otro mercado (robustez)</span>
            <select value={otro} onChange={(e) => setOtro(e.target.value)} aria-label="Otro mercado" className="mt-1 w-full rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
              <option value="">Automático (otro de la misma familia, si hay datos)</option>
              {fuentes
                .filter((f) => clave(f) !== datos)
                .map((f) => (
                  <option key={clave(f)} value={clave(f)}>
                    {f.simbolo} · {NOMBRE_PROVEEDOR[f.proveedor]}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            <span className="etiqueta">Comisión (pb/lado)</span>
            <input type="number" min={0} step={0.5} value={comision} onChange={(e) => setComision(Number(e.target.value))} aria-label="Comisión" className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
          </label>
          <label className="block">
            <span className="etiqueta">Deslizamiento (pb/lado)</span>
            <input type="number" min={0} step={0.5} value={deslizamiento} onChange={(e) => setDeslizamiento(Number(e.target.value))} aria-label="Deslizamiento" className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
          </label>
        </div>
        <details className="text-[11px] text-plata-400">
          <summary className="cursor-pointer text-plata-300">Avanzado · Walk-Forward, Monte Carlo y Luck test</summary>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="etiqueta">Objetivo para elegir parámetros</span>
              <select value={objetivoWfo} onChange={(e) => setObjetivoWfo(e.target.value as ObjetivoWfo)} aria-label="Objetivo Walk-Forward" className="mt-1 block rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
                {Object.entries(NOMBRE_OBJETIVO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="etiqueta">IS (barras, 0 = auto)</span>
              <input type="number" min={0} step={100} value={lIs} onChange={(e) => setLIs(Number(e.target.value))} aria-label="Barras IS" className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
            </label>
            <label className="block">
              <span className="etiqueta">OOS (barras, 0 = auto)</span>
              <input type="number" min={0} step={100} value={lOos} onChange={(e) => setLOos(Number(e.target.value))} aria-label="Barras OOS" className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
            </label>
            <label className="block">
              <span className="etiqueta">Monte Carlo · método</span>
              <select value={metodoMc} onChange={(e) => setMetodoMc(e.target.value as MetodoMc)} aria-label="Método Monte Carlo" className="mt-1 block rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
                <option value="bootstrap">Con reemplazo (bootstrap)</option>
                <option value="shuffle">Sin reemplazo (shuffle)</option>
              </select>
            </label>
            <label className="block">
              <span className="etiqueta">Simulaciones</span>
              <input type="number" min={0} step={1000} value={simulaciones} onChange={(e) => setSimulaciones(Number(e.target.value))} aria-label="Simulaciones" className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
            </label>
            <label className="block">
              <span className="etiqueta">Ruina (% de caída)</span>
              <input type="number" min={0} step={5} value={ruinaPct} onChange={(e) => setRuinaPct(Number(e.target.value))} aria-label="Umbral de ruina" className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
            </label>
            <label className="block">
              <span className="etiqueta">Capital inicial (USD)</span>
              <input type="number" min={0} step={1000} value={capital} onChange={(e) => setCapital(Number(e.target.value))} aria-label="Capital inicial" className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
            </label>
            <label className="block">
              <span className="etiqueta">Luck test · método</span>
              <select value={metodoLuck} onChange={(e) => setMetodoLuck(e.target.value as MetodoLuck)} aria-label="Método Luck test" className="mt-1 block rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
                {Object.entries(NOMBRE_METODO_LUCK).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="etiqueta">Luck test · métrica</span>
              <select value={metricaLuck} onChange={(e) => setMetricaLuck(e.target.value as MetricaLuck)} aria-label="Métrica Luck test" className="mt-1 block rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
                {Object.entries(NOMBRE_METRICA_LUCK).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="etiqueta">Permutaciones</span>
              <input type="number" min={0} step={1000} value={permutaciones} onChange={(e) => setPermutaciones(Number(e.target.value))} aria-label="Permutaciones" className="mt-1 w-24 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
            </label>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={ejecutar} disabled={corriendo || !datos} className="flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black disabled:opacity-40">
            <Play size={13} /> Probar con el Juez
          </button>
          {corriendo && (
            <button onClick={() => laboratorio.cancelar()} className="flex items-center gap-1.5 rounded-lg border border-borde px-3 py-2 text-xs text-plata-200 hover:border-plata-400">
              <Square size={12} /> Cancelar
            </button>
          )}
          <span className="text-[10.5px] text-plata-500">Cada ejecución suma sus variantes al contador: probar muchas ideas sobre los mismos datos aumenta el riesgo de encontrar algo por suerte, y el Juez lo descuenta.</span>
        </div>
        {(corriendo || progreso.length > 0) && !resultado && !error && (
          <div className="rounded-lg border border-borde-suave bg-black/60 p-2 font-mono text-[10.5px] text-plata-300" data-progreso>
            {progreso.map((t, i) => (
              <p key={i}>› {t}</p>
            ))}
          </div>
        )}
        {error && (
          <pre className="whitespace-pre-wrap rounded-lg border border-plata-500 p-3 font-mono text-[11px] text-white" data-error>
            {error}
          </pre>
        )}
      </Panel>

      {resultado && paper && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-borde p-3" data-paper-generado>
          <span className="text-xs text-white">Paper generado</span>
          <AccionesPaper p={paper} alVer={setViendo} />
        </div>
      )}
      {resultado && <ResultadoJuezVista r={resultado} />}
      <BibliotecaPapers version={versionPapers} />
      <VisorPaper p={viendo} alCerrar={() => setViendo(null)} />
    </div>
  );
}
