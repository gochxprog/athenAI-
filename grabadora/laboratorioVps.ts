// Juez en el VPS: cada prueba del Laboratorio corre en un PROCESO APARTE (la grabadora sigue grabando mientras tanto)
// sobre lo grabado y la historia importada, con el mismo código que el Laboratorio: velas → estrategia en Python
// (Pyodide) → anti-futuro → Juez.
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AlmacenDisco } from './almacenDisco';
import { cargadorPython } from './botsVps';
import { armarVelas, SERIES, type Serie, type VelaLab } from '../src/motores/laboratorio/velas';
export type { Fuente, PedidoPrueba, ResultadoPrueba, Trabajo };
import { ejecutarEstrategia, mensajeError, type PyodideMinimo } from '../src/motores/laboratorio/python';
import { entradaJuez } from '../src/motores/laboratorio/entradaJuez';
import { juzgar } from '../src/motores/juez/juez';
import { FUENTES, type Fuente, type PedidoPrueba, type ResultadoPrueba, type Trabajo } from '../src/motores/laboratorio/prueba';
import { mercadoId } from '../src/motores/mercado/mercadoId';

/** Velas como máximo por prueba (las más recientes): memoria y tiempo acotados en el VPS. */
export const MAX_VELAS = 120_000;
export const MIN_VELAS = 300;
const MAX_CODIGO = 100_000;
const LIMITE_MS = 30 * 60_000;
export interface ApiLaboratorio {
  accion(nombre: string, cuerpo: Record<string, unknown>): Promise<unknown>;
  trabajo(id: string): Trabajo | { error: string };
}
type Mensaje = { tipo: 'paso'; texto: string } | { tipo: 'listo'; resultado: ResultadoPrueba } | { tipo: 'error'; mensaje: string };

/**
 * Velas de un mercado: primero la historia, luego lo grabado desde donde termina la historia. Se leen día por día
 * (nunca todo junto en memoria) y se guardan las MAX_VELAS más recientes. Los días son múltiplos de todas las series,
 * así que armar las velas por día da lo mismo que armarlas de una vez.
 */
export function cargarVelas(datos: string, simbolo: string, serie: Serie, fuente: Fuente, desde = -Infinity): VelaLab[] {
  // `desde` (ms): solo los días desde ahí (la señal en vivo de los bots no necesita toda la historia).
  const desdeDia = Number.isFinite(desde) ? new Date(desde).toISOString().slice(0, 10) : '';
  const almacenes = [...(fuente !== 'grabado' ? [path.join(datos, 'historia')] : []), ...(fuente !== 'historia' ? [datos] : [])].map((d) => new AlmacenDisco(d));
  let velas: VelaLab[] = [];
  let ultimo = -Infinity;
  for (const a of almacenes)
    for (const d of a.dias(simbolo)) {
      if (d < desdeDia) continue;
      const filas = a.leerDia(simbolo, d).filter((f) => f.cierre > ultimo && f.close > 0);
      if (!filas.length) continue;
      ultimo = filas[filas.length - 1].cierre;
      velas.push(...armarVelas(filas, serie));
      if (velas.length > MAX_VELAS * 1.5) velas = velas.slice(-MAX_VELAS);
    }
  return velas.slice(-MAX_VELAS).map((v, n) => ({ ...v, n }));
}

/** La prueba completa (en el proceso hijo). */
export function correrPrueba(p: PedidoPrueba, datos: string, py: PyodideMinimo, paso: (t: string) => void): ResultadoPrueba {
  paso(`Leyendo ${p.simbolo} (${p.fuente}) y armando velas de ${p.serie}…`);
  const velas = cargarVelas(datos, p.simbolo, p.serie, p.fuente);
  if (velas.length < MIN_VELAS) {
    // Qué hay en disco, para ver a la primera si faltan datos o no se encuentran.
    const visto = (d: string) => {
      const a = new AlmacenDisco(d);
      const dias = a.dias(p.simbolo);
      return `${d}: ${dias.length} días (${dias[0] ?? '—'} → ${dias.at(-1) ?? '—'}), ${dias.reduce((s, x) => s + a.leerDia(p.simbolo, x).length, 0)} filas`;
    };
    throw new Error(`Solo hay ${velas.length} velas de ${p.serie} de ${p.simbolo}: hacen falta al menos ${MIN_VELAS}. Graba más días, importa historia o usa una serie más corta.\nEn disco · ${visto(datos)} · ${visto(path.join(datos, 'historia'))}`);
  }
  let ejec;
  try {
    ejec = ejecutarEstrategia(py, p.codigo, velas, paso);
  } catch (e) {
    throw new Error(`Error en tu código:\n${mensajeError(e)}`);
  }
  paso('El Juez está probando: Walk-Forward, Monte Carlo, Luck test, robustez…');
  const juez = juzgar(entradaJuez(velas, mercadoId('binance', p.simbolo), ejec));
  return { juez, combos: ejec.combos, gestion: ejec.gestion, velas: { total: velas.length, desde: velas[0].inicio, hasta: velas[velas.length - 1].cierre, serie: p.serie, fuente: p.fuente }, tiempos: velas.map((v) => v.cierre) };
}

/** Proceso hijo (`node grabadora.mjs --juez`): recibe un pedido, lo corre y contesta. */
export function atenderJuez(): void {
  process.once('message', async (m: { pedido: PedidoPrueba; datos: string; pyodide: string | null }) => {
    const enviar = (x: Mensaje, fin = false) => process.send?.(x, undefined, {}, () => fin && process.disconnect?.());
    try {
      enviar({ tipo: 'paso', texto: 'Cargando Python…' });
      const py = await cargadorPython(m.pyodide)();
      // El resultado es grande: se desconecta recién cuando terminó de enviarse.
      enviar({ tipo: 'listo', resultado: correrPrueba(m.pedido, m.datos, py, (texto) => enviar({ tipo: 'paso', texto })) }, true);
    } catch (e) {
      enviar({ tipo: 'error', mensaje: e instanceof Error ? e.message : String(e) }, true);
    }
  });
}

function validar(c: Record<string, unknown>): PedidoPrueba {
  const codigo = typeof c.codigo === 'string' ? c.codigo : '';
  const simbolo = String(c.simbolo ?? '').toUpperCase();
  const serie = String(c.serie ?? '5m') as Serie;
  const fuente = String(c.fuente ?? 'todo') as Fuente;
  if (!codigo.trim() || codigo.length > MAX_CODIGO) throw new Error('Falta el código de la estrategia (o pasa de 100 KB).');
  if (!/^[A-Z0-9]{2,20}$/.test(simbolo)) throw new Error('Mercado no válido.');
  if (!SERIES.includes(serie)) throw new Error(`Serie no válida: ${serie}`);
  if (!FUENTES.includes(fuente)) throw new Error(`Fuente no válida: ${fuente}`);
  return { codigo, simbolo, serie, fuente, nombre: typeof c.nombre === 'string' ? c.nombre.slice(0, 80) : undefined };
}

/** En la grabadora: lanza las pruebas (una a la vez) y guarda sus estados (las últimas 20). */
export function crearLaboratorio(o: { datos: string; pyodide: string | null; log?: (t: string) => void; lanzar?: () => ChildProcess; alTerminar?: (p: PedidoPrueba, r: ResultadoPrueba) => void }): ApiLaboratorio {
  const trabajos = new Map<string, Trabajo>();
  const lanzar = o.lanzar ?? (() => fork(process.argv[1], ['--juez'], { execArgv: ['--max-old-space-size=2048'] }));
  let activo: { id: string; hijo: ChildProcess; reloj: ReturnType<typeof setTimeout> } | null = null;
  const terminar = (t: Trabajo, cambio: Partial<Trabajo>) => {
    if (t.estado !== 'corriendo') return;
    Object.assign(t, cambio, { fin: Date.now() });
    if (activo?.id === t.id) {
      clearTimeout(activo.reloj);
      activo.hijo.kill();
      activo = null;
    }
    o.log?.(`Laboratorio · ${t.pedido.nombre ?? 'prueba'} ${t.pedido.simbolo} ${t.pedido.serie}: ${cambio.resultado ? cambio.resultado.juez.veredicto : `error · ${cambio.error}`}`);
  };
  return {
    async accion(nombre, cuerpo) {
      if (nombre === 'cancelar') {
        const t = trabajos.get(String(cuerpo.id));
        if (t) terminar(t, { estado: 'error', error: 'Cancelada.' });
        return { ok: true };
      }
      if (nombre !== 'probar') throw new Error(`Acción desconocida: ${nombre}`);
      if (activo) throw new Error('Ya hay una prueba corriendo: espera a que termine o cancélala.');
      const { codigo, ...pedido } = validar(cuerpo);
      const t: Trabajo = { id: randomUUID().slice(0, 8), estado: 'corriendo', pasos: [], inicio: Date.now(), fin: null, pedido, resultado: null, error: null };
      trabajos.set(t.id, t);
      [...trabajos.keys()].slice(0, -20).forEach((k) => trabajos.delete(k));
      const hijo = lanzar();
      activo = { id: t.id, hijo, reloj: setTimeout(() => terminar(t, { estado: 'error', error: 'La prueba pasó de 30 minutos: usa menos variantes o una serie más larga.' }), LIMITE_MS) };
      hijo.on('message', (m: Mensaje) => {
        if (m.tipo === 'paso') t.pasos = [...t.pasos.slice(-30), m.texto];
        else if (m.tipo === 'listo') {
          // A la Biblioteca (con su código), aprobada o no: cada intento cuenta.
          try {
            o.alTerminar?.({ codigo, ...pedido }, m.resultado);
          } catch (e) {
            o.log?.(`Biblioteca: no se pudo guardar (${e instanceof Error ? e.message : e})`);
          }
          terminar(t, { estado: 'listo', resultado: m.resultado });
        }
        else terminar(t, { estado: 'error', error: m.mensaje });
      });
      hijo.on('exit', (codigoSalida) => terminar(t, { estado: 'error', error: `El proceso del Juez se cerró (${codigoSalida ?? 'sin código'}): probablemente se quedó sin memoria.` }));
      hijo.send({ pedido: { codigo, ...pedido }, datos: o.datos, pyodide: o.pyodide });
      return { id: t.id };
    },
    trabajo: (id) => trabajos.get(id) ?? { error: 'No existe esa prueba.' },
  };
}
