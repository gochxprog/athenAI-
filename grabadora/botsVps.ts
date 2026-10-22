// Bots de Paper Trading 24/7 en el VPS, junto a la grabadora. Usa el MISMO motor que la plataforma
// (src/motores/paper/motorPaper.ts): Ejecutor + Guardián. Aquí solo cambian las piezas de alrededor:
//   · libro de bots y operaciones en disco:  {datos}/paper/bots.json · operaciones.jsonl · estado.json
//   · señales: Python (Pyodide para Node) sobre las últimas filas grabadas en disco, igual que el Laboratorio;
//   · mercado en vivo: los pipelines de la grabadora (1 vez por segundo).
// La plataforma los ve y los maneja por la API (/api/paper…); si el navegador está cerrado, siguen operando.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MotorPaper, type NuevoBot } from '../src/motores/paper/motorPaper';
import type { Bot, OperacionPaper } from '../src/motores/paper/ejecutor';
import type { LibroPaper } from '../src/motores/paper/almacenPaper';
import type { EstadoFeed } from '../src/motores/worker/protocolo';
import type { Pipeline } from '../src/motores/nucleo/pipeline';
import type { EstrategiaEnVivo, SenalEstrategia } from '../src/motores/laboratorio/protocolo';
import { ejecutarEstrategia, mensajeError, type PyodideMinimo } from '../src/motores/laboratorio/python';
import { armarVelas, MS_SERIE, type Serie, type VelaLab } from '../src/motores/laboratorio/velas';
import { atrSerie } from '../src/motores/juez/salidas';
import type { AlmacenDisco } from './almacenDisco';
import { leerLineas } from './almacenDisco';

/** Filas que se dan a la estrategia para su señal actual (igual que el Laboratorio del navegador). */
export const FILAS_SENAL = 1_500;
/** Velas de su serie que recibe una estrategia en vivo (de historia + grabado). */
export const VELAS_SENAL = 500;

/** Escribe un archivo de una vez (temporal + rename): un apagón nunca deja medio JSON. */
function escribirAtomico(archivo: string, texto: string): void {
  const tmp = `${archivo}.tmp`;
  fs.writeFileSync(tmp, texto);
  fs.renameSync(tmp, archivo);
}

/** Libro de Paper en disco (mismas operaciones que el de IndexedDB del navegador). */
export class LibroPaperDisco implements LibroPaper {
  private readonly bots: string;
  private readonly ops: string;
  private siguienteId: number;

  constructor(readonly carpeta: string) {
    fs.mkdirSync(carpeta, { recursive: true });
    this.bots = path.join(carpeta, 'bots.json');
    this.ops = path.join(carpeta, 'operaciones.jsonl');
    this.siguienteId = this.todas().reduce((m, o) => Math.max(m, o.id ?? 0), 0) + 1;
  }

  private mapa(): Record<string, Bot> {
    try {
      return fs.existsSync(this.bots) ? (JSON.parse(fs.readFileSync(this.bots, 'utf8')) as Record<string, Bot>) : {};
    } catch {
      return {};
    }
  }

  private todas(): OperacionPaper[] {
    return fs.existsSync(this.ops) ? leerLineas<OperacionPaper>(this.ops) : [];
  }

  async leerBots(): Promise<Bot[]> {
    return Object.values(this.mapa());
  }

  async guardarBot(b: Bot): Promise<void> {
    const m = this.mapa();
    m[b.id] = b;
    escribirAtomico(this.bots, JSON.stringify(m));
  }

  async borrarBot(id: string): Promise<void> {
    const m = this.mapa();
    delete m[id];
    escribirAtomico(this.bots, JSON.stringify(m));
    const quedan = this.todas().filter((o) => o.botId !== id);
    escribirAtomico(this.ops, quedan.map((o) => JSON.stringify(o)).join('\n') + (quedan.length ? '\n' : ''));
  }

  async agregarOperacion(o: OperacionPaper): Promise<number> {
    const id = this.siguienteId++;
    fs.appendFileSync(this.ops, `${JSON.stringify({ ...o, id })}\n`);
    return id;
  }

  async leerOperaciones(botId?: string): Promise<OperacionPaper[]> {
    return this.todas()
      .filter((o) => !botId || o.botId === botId)
      .sort((a, b) => a.salidaT - b.salidaT || (a.id ?? 0) - (b.id ?? 0));
  }
}

/** «localStorage» en un archivo (apagado de emergencia y reglas del Guardián). */
export function almacenLocalDisco(archivo: string): Pick<Storage, 'getItem' | 'setItem'> {
  const leer = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(archivo, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  };
  return {
    getItem: (k) => leer()[k] ?? null,
    setItem: (k, v) => escribirAtomico(archivo, JSON.stringify({ ...leer(), [k]: v })),
  };
}

/** Carga Pyodide para Node: junto a grabadora.mjs (pyodide/) o, en desarrollo, node_modules/pyodide. */
export function cargadorPython(dir: string | null): () => Promise<PyodideMinimo> {
  let py: Promise<PyodideMinimo> | null = null;
  return () => {
    if (!py) {
      const candidatos = [dir, path.resolve('node_modules/pyodide')].filter((x): x is string => !!x && fs.existsSync(path.join(x, 'pyodide.mjs')));
      if (!candidatos.length) return Promise.reject(new Error('No está Python (carpeta pyodide/ junto a la grabadora).'));
      const base = candidatos[0];
      py = import(pathToFileURL(path.join(base, 'pyodide.mjs')).href).then((m: { loadPyodide: (o: { indexURL: string }) => Promise<PyodideMinimo> }) => m.loadPyodide({ indexURL: `${base}${path.sep}` }));
      py.catch(() => (py = null));
    }
    return py;
  };
}

/** Señal actual de cada estrategia: la variante del Juez sobre las últimas filas grabadas (mismo código que el Laboratorio). */
export function senalesDisco(almacen: Pick<AlmacenDisco, 'leerUltimas'>, python: () => Promise<PyodideMinimo>, cargar?: (simbolo: string, serie: Serie, desde: number) => VelaLab[]) {
  // Con velas de tiempo, la señal solo cambia cuando cierra una vela: se calcula una vez por vela y se guarda.
  const cache = new Map<string, { balde: number; senal: SenalEstrategia }>();
  return async (xs: EstrategiaEnVivo[]): Promise<SenalEstrategia[]> => {
    const py = await python();
    const salida: SenalEstrategia[] = [];
    for (const x of xs) {
      try {
        if (x.proveedor !== 'binance') throw new Error(`La grabadora solo tiene Binance (pidió ${x.proveedor}).`);
        const filas = almacen.leerUltimas(x.simbolo, FILAS_SENAL).filter((f) => Number.isFinite(f.close) && f.close > 0);
        if (!filas.length) {
          salida.push({ id: x.id, posicion: null, t: null, error: `Sin filas grabadas de ${x.simbolo}` });
          continue;
        }
        // Las mismas velas con las que el Juez la aprobó, y solo las CERRADAS: la que se está formando se quita
        // (el Juez decide al cierre de cada vela; usarla a medias sería otra estrategia).
        const ms = x.serie && x.serie !== 'dollar' ? MS_SERIE[x.serie] : null;
        const ultima = filas[filas.length - 1].cierre;
        const balde = ms ? Math.floor(ultima / ms) : -1;
        const guardada = cache.get(x.id);
        if (ms && guardada?.balde === balde) {
          salida.push(guardada.senal);
          continue;
        }
        const velas = ms && x.serie ? (cargar ? cargar(x.simbolo, x.serie, ultima - (VELAS_SENAL + 2) * ms) : armarVelas(filas, x.serie)).filter((v) => v.cierre < balde * ms).slice(-VELAS_SENAL) : armarVelas(filas, 'dollar');
        if (!velas.length) {
          salida.push({ id: x.id, posicion: null, t: null, error: `Aún no hay una vela de ${x.serie} cerrada` });
          continue;
        }
        const fijo = `${x.codigo}\nPARAMETROS = ${JSON.stringify(Object.fromEntries(Object.entries(x.combo).map(([k, v]) => [k, [v]])))}\n`;
        const ejec = ejecutarEstrategia(py, fijo, velas);
        const pos = ejec.posiciones[0];
        const senal: SenalEstrategia = { id: x.id, posicion: pos[pos.length - 1] ?? 0, t: velas[velas.length - 1].cierre, ...(ejec.gestion ? { atr: atrSerie(velas, ejec.gestion.periodoAtr ?? 14).at(-1) ?? null } : {}) };
        if (ms) cache.set(x.id, { balde, senal });
        salida.push(senal);
      } catch (err) {
        salida.push({ id: x.id, posicion: null, t: null, error: mensajeError(err) });
      }
    }
    return salida;
  };
}

/** Resumen de un mercado con la forma que espera el motor de Paper (solo lo que usa: precio, libro, ATR, funding, filas). */
export function feedDe(simbolo: string, p: Pipeline, filas: number, guardando: boolean, cortes: number): EstadoFeed {
  const dollar = p.parametros.temporalidades.dollar;
  return {
    simbolo,
    proveedor: 'binance',
    conexion: p.conexion,
    detalle: p.detalleConexion,
    tradesPorSeg: 0,
    latenciaMs: null,
    precio: p.mercado.ultimoPrecio,
    filas,
    tickSize: p.tickSize,
    dollarBarUsd: dollar.tipo === 'dolar' ? dollar.usd : 0,
    calibrado: guardando,
    guardando,
    cortes,
    tradesPerdidos: p.tradesPerdidos,
    historial: [],
    ritmo: [],
    cvdVelocidad: null,
    resumen: p.resumen(),
    memoria: null,
    eventos: [],
    extremas: [],
  };
}

export type AccionPaper = 'crear' | 'pausar' | 'reanudar' | 'borrar' | 'apagar' | 'rearmar' | 'reglas' | 'orden' | 'cerrar';

/** Lo que la API de la grabadora expone de los bots. */
export interface ApiPaper {
  estado(): unknown;
  operaciones(botId?: string): Promise<OperacionPaper[]>;
  accion(nombre: string, cuerpo: Record<string, unknown>): Promise<unknown>;
}

export function crearApiPaper(motor: MotorPaper): ApiPaper {
  return {
    estado: () => ({ cargado: motor.cargado, apagado: motor.apagado, reglas: motor.reglas, bots: motor.bots, bitacora: motor.bitacora.slice(0, 100) }),
    operaciones: (botId) => motor.operaciones(botId),
    async accion(nombre, c) {
      const id = typeof c.id === 'string' ? c.id : '';
      switch (nombre as AccionPaper) {
        case 'crear':
          return { bot: await motor.crearBot(c as unknown as NuevoBot) };
        case 'pausar':
          await motor.pausar(id);
          return { ok: true };
        case 'reanudar':
          await motor.reanudar(id);
          return { ok: true };
        case 'borrar':
          await motor.borrar(id);
          return { ok: true };
        case 'apagar':
          await motor.apagarTodo();
          return { ok: true };
        case 'rearmar':
          motor.rearmar();
          return { ok: true };
        case 'orden':
          return { bot: await motor.ordenManual(c as unknown as Parameters<MotorPaper['ordenManual']>[0]) };
        case 'cerrar':
          await motor.cerrarManual(id);
          return { ok: true };
        case 'reglas':
          motor.setReglas(c as Partial<MotorPaper['reglas']>);
          return { ok: true };
        default:
          throw new Error(`Acción desconocida: ${nombre}`);
      }
    },
  };
}
