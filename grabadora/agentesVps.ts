// Orquestador de los agentes en el VPS (la «sala»). Cada 5 s lee lo que hacen de verdad los motores que ya viven
// aquí (grabadora, bots, Juez, importador) y de ahí saca el estado de cada agente, sus notas (la radio de la sala)
// y su actividad por hora. Ningún agente aparece trabajando sin un motor detrás.
// Los trabajos propios de los agentes (Rastreador, Etiquetador, Lector… desde la fase A2) van EN FILA, de uno en
// uno: el VPS tiene 4 GB y la grabadora nunca se frena. Todo queda en {datos}/agentes/estado.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENTES, type AgenteId } from '../src/data/agentes';
import { HORA_MS, sumar, ultimas24, type Cubos, type EstadoAgente, type EstadoSala, type FichaAgente, type Nota, type Recursos } from '../src/motores/agentes/sala';
import type { EventoPaper } from '../src/motores/paper/motorPaper';
import type { EstadoSimbolo } from './servidor';

/** Lo que el orquestador lee de los motores en cada latido. */
export interface Lectura {
  mercados: EstadoSimbolo[];
  bots: { total: number; activos: number; enPosicion: number; apagado: boolean; bitacora: EventoPaper[] } | null;
  prueba: { nombre: string; simbolo: string; serie: string; paso: string } | null;
  historia: { carpeta: string; importando: boolean; dia: string | null; hechos: number; total: number }[];
}
/** Un trabajo propio de un agente: corre cada `cadaMs` (o cuando lo pides) y devuelve una frase con lo que hizo. */
export interface Tarea { id: AgenteId; nombre: string; cadaMs: number; correr: () => Promise<string> }
export interface ApiAgentes {
  estado(): EstadoSala;
  accion(nombre: string, cuerpo: Record<string, unknown>): Promise<unknown>;
  latir(l: Lectura): void;
  notar(id: AgenteId, texto: string, grave?: boolean): void;
  tarea(t: Tarea): void;
  guardar(): void;
}

const MAX_NOTAS = 400;
const NOTAS_API = 150;
const GUARDAR_CADA_MS = 15_000;
/** Los que aún no tienen trabajo en el VPS: en qué fase llegan. */
const LLEGA: Partial<Record<AgenteId, string>> = { rastreador: 'A2', etiquetador: 'A2', lector: 'A3', sintetizador: 'A4' };
const corto = (s: string) => s.replace(/USDT$/, '');
const hhmm = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

export function recursosVps(datos: string): Recursos {
  let disco: fs.StatsFs | null = null;
  try {
    disco = fs.statfsSync(datos);
  } catch {
    /* sin datos de disco */
  }
  return { memTotal: os.totalmem(), memLibre: os.freemem(), rss: process.memoryUsage().rss, carga: os.loadavg()[0], nucleos: os.cpus().length, discoLibre: disco ? disco.bavail * disco.bsize : null, discoTotal: disco ? disco.blocks * disco.bsize : null };
}

export function crearSala(o: { datos: string; reloj?: () => number; recursos?: () => Recursos; log?: (t: string) => void }): ApiAgentes {
  const ahora = o.reloj ?? Date.now;
  const archivo = path.join(o.datos, 'agentes', 'estado.json');
  const desde = ahora();
  let notas: Nota[] = [];
  let cubos = {} as Record<AgenteId, Cubos>;
  const pausados = new Set<AgenteId>();
  try {
    const x = JSON.parse(fs.readFileSync(archivo, 'utf8')) as { notas?: Nota[]; cubos?: Record<AgenteId, Cubos>; pausados?: AgenteId[] };
    notas = x.notas ?? [];
    cubos = x.cubos ?? cubos;
    x.pausados?.forEach((id) => pausados.add(id));
  } catch {
    /* primera vez */
  }
  const vivo = Object.fromEntries(AGENTES.map((a) => [a.id, { estado: 'dormido' as EstadoAgente, ahora: 'arrancando…', siguiente: null as string | null }])) as Record<AgenteId, { estado: EstadoAgente; ahora: string; siguiente: string | null }>;
  const tareas = new Map<AgenteId, Tarea & { ultima: number }>();
  const fila: { espera: AgenteId[]; actual: { id: AgenteId; desde: number } | null } = { espera: [], actual: null };
  // Lo visto en el latido anterior (para anotar solo los cambios).
  const previo = { conexion: new Map<string, string>(), filas: new Map<string, number>(), hora: Math.floor(ahora() / HORA_MS), filasHora: new Map<string, number>(), bitacora: notas.length ? Math.max(...notas.map((n) => n.t)) : -1, importando: new Set<string>() };
  let sucio = false;
  let guardado = 0;

  const contar = (id: AgenteId, n = 1) => {
    cubos[id] = sumar(cubos[id] ?? [], ahora(), n);
    sucio = true;
  };
  const notar = (id: AgenteId, texto: string, grave = false, t = ahora()) => {
    notas = [{ t, id, texto, ...(grave ? { grave } : {}) }, ...notas].slice(0, MAX_NOTAS);
    contar(id);
  };
  const guardar = () => {
    if (!sucio) return;
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, JSON.stringify({ notas, cubos, pausados: [...pausados] }));
    sucio = false;
    guardado = ahora();
  };
  const poner = (id: AgenteId, estado: EstadoAgente, texto: string, siguiente: string | null = null) => (vivo[id] = { estado, ahora: texto, siguiente });

  /** La fila de trabajos pesados: uno a la vez. */
  const avanzarFila = () => {
    if (fila.actual) return;
    const id = fila.espera.shift();
    const t = id && tareas.get(id);
    if (!id || !t) return;
    fila.actual = { id, desde: ahora() };
    t.ultima = ahora();
    t.correr()
      .then((texto) => notar(id, texto))
      .catch((e) => notar(id, `${t.nombre}: falló · ${e instanceof Error ? e.message : e}`, true))
      .finally(() => {
        fila.actual = null;
        avanzarFila();
      });
  };
  const encolar = (id: AgenteId) => {
    if (fila.actual?.id !== id && !fila.espera.includes(id)) fila.espera.push(id);
    avanzarFila();
  };

  function latir(l: Lectura) {
    const t = ahora();
    // Vigía: conexiones y cortes.
    const vivos = l.mercados.filter((m) => m.conexion === 'en-vivo');
    for (const m of l.mercados) {
      const antes = previo.conexion.get(m.simbolo);
      if (antes !== undefined && antes !== m.conexion) notar('vigia', `${m.simbolo}: ${antes} → ${m.conexion}${m.detalle ? ` · ${m.detalle}` : ''}`, m.conexion !== 'en-vivo');
      previo.conexion.set(m.simbolo, m.conexion);
    }
    const caido = l.mercados.find((m) => m.conexion !== 'en-vivo');
    if (!l.mercados.length) poner('vigia', 'esperando', 'sin mercados configurados');
    else if (caido) poner('vigia', 'alerta', `${caido.simbolo} ${caido.conexion}${caido.detalle ? ` · ${caido.detalle}` : ''}`);
    else poner('vigia', 'trabajando', `${vivos.length} mercados en vivo · ${l.mercados.reduce((s, m) => s + m.cortes, 0)} cortes`);

    // Flujo: filas de Features (lo grabado) y la historia que se importa.
    for (const m of l.mercados) {
      const d = m.filasSesion - (previo.filas.get(m.simbolo) ?? m.filasSesion);
      if (d > 0) {
        contar('flujo', d);
        previo.filasHora.set(m.simbolo, (previo.filasHora.get(m.simbolo) ?? 0) + d);
      }
      previo.filas.set(m.simbolo, m.filasSesion);
    }
    const hora = Math.floor(t / HORA_MS);
    if (hora !== previo.hora) {
      const total = [...previo.filasHora.values()].reduce((s, x) => s + x, 0);
      if (total) notar('flujo', `Última hora: +${total.toLocaleString('es-ES')} filas de Features (${[...previo.filasHora].map(([s, x]) => `${corto(s)} ${x.toLocaleString('es-ES')}`).join(' · ')}).`);
      previo.filasHora.clear();
      previo.hora = hora;
    }
    for (const h of l.historia) {
      const era = previo.importando.has(h.carpeta);
      if (h.importando && !era) notar('flujo', `Empieza a importar historia de ${h.carpeta}: ${h.total} días.`);
      if (!h.importando && era) notar('flujo', `Historia de ${h.carpeta}: importados ${h.hechos} de ${h.total} días.`);
      if (h.importando) previo.importando.add(h.carpeta);
      else previo.importando.delete(h.carpeta);
    }
    const imp = l.historia.find((h) => h.importando);
    const filas = l.mercados.reduce((s, m) => s + m.filasSesion, 0);
    if (imp) poner('flujo', 'trabajando', `importando ${imp.carpeta}: ${imp.dia ?? '…'} (${imp.hechos}/${imp.total})`);
    else poner('flujo', vivos.length ? 'trabajando' : 'esperando', vivos.length ? `${filas.toLocaleString('es-ES')} filas de Features en esta sesión` : 'sin mercados en vivo');

    // Programador y Juez: la prueba del Laboratorio (Python primero, luego el Juez) y las señales de los bots.
    const p = l.prueba;
    const juzgando = !!p && /Juez/.test(p.paso);
    const b = l.bots;
    if (p && !juzgando) poner('programador', 'trabajando', `«${p.nombre}» ${p.simbolo} ${p.serie}: ${p.paso}`);
    else if (b?.activos) poner('programador', 'trabajando', `calcula la señal de ${b.activos} bots en cada vela cerrada`);
    else poner('programador', 'esperando', 'sin estrategias que correr');
    if (p && juzgando) poner('juez', 'trabajando', `«${p.nombre}» ${p.simbolo} ${p.serie}: ${p.paso}`);
    else poner('juez', 'esperando', 'espera una prueba del Laboratorio');

    // Guardián y Ejecutor: los bots de Paper (la bitácora nueva va a la radio).
    if (!b) {
      poner('guardian', 'dormido', 'los bots están apagados en esta grabadora');
      poner('ejecutor', 'dormido', 'los bots están apagados en esta grabadora');
    } else {
      // La primera vez (sin notas guardadas) solo marca hasta dónde ya se vio: no repite lo viejo en la radio.
      if (previo.bitacora < 0) previo.bitacora = Math.max(0, ...b.bitacora.map((e) => e.t));
      for (const e of [...b.bitacora].filter((e) => e.t > previo.bitacora).sort((x, y) => x.t - y.t)) notar(e.grave ? 'guardian' : 'ejecutor', `${e.nombre}: ${e.texto}`, e.grave, e.t);
      previo.bitacora = Math.max(previo.bitacora, ...b.bitacora.map((e) => e.t));
      if (b.apagado) poner('guardian', 'alerta', 'apagado de emergencia activo');
      else poner('guardian', b.total ? 'trabajando' : 'esperando', b.total ? `vigila ${b.total} bots · caída del día y pérdidas seguidas` : 'sin bots que vigilar');
      poner('ejecutor', b.activos ? 'trabajando' : 'esperando', b.activos ? `${b.activos} bots en Paper · ${b.enPosicion} en posición` : 'sin bots activos');
    }

    // Los agentes con trabajo propio: la fila decide; los demás duermen hasta su fase.
    for (const a of AGENTES) {
      const tarea = tareas.get(a.id);
      if (!tarea) {
        if (LLEGA[a.id]) poner(a.id, 'dormido', `llega en la fase ${LLEGA[a.id]}`);
        continue;
      }
      const prox = tarea.ultima + tarea.cadaMs;
      if (!pausados.has(a.id) && t >= prox) encolar(a.id);
      if (pausados.has(a.id)) poner(a.id, 'pausado', 'pausado por ti');
      else if (fila.actual?.id === a.id) poner(a.id, 'trabajando', tarea.nombre);
      else if (fila.espera.includes(a.id)) poner(a.id, 'esperando', `${tarea.nombre} · en fila`);
      else poner(a.id, 'esperando', tarea.nombre, `a las ${hhmm(prox)}`);
    }
    if (t - guardado > GUARDAR_CADA_MS) guardar();
  }

  return {
    latir,
    notar: (id, texto, grave) => notar(id, texto, grave),
    tarea(t) {
      tareas.set(t.id, { ...t, ultima: ahora() });
    },
    guardar,
    estado(): EstadoSala {
      const t = ahora();
      const agentes: FichaAgente[] = AGENTES.map((a) => ({
        id: a.id,
        ...vivo[a.id],
        ultimo: notas.find((n) => n.id === a.id) ?? null,
        actividad: ultimas24(cubos[a.id] ?? [], t),
        acciones: tareas.has(a.id) ? [pausados.has(a.id) ? 'reanudar' : 'pausar', 'correr'] : [],
      }));
      const nombre = (id: AgenteId) => tareas.get(id)?.nombre ?? id;
      return { t, desde, agentes, notas: notas.slice(0, NOTAS_API), fila: { actual: fila.actual && { ...fila.actual, nombre: nombre(fila.actual.id) }, espera: fila.espera.map((id) => ({ id, nombre: nombre(id) })) }, recursos: (o.recursos ?? (() => recursosVps(o.datos)))() };
    },
    async accion(nombre, cuerpo) {
      const id = String(cuerpo.id) as AgenteId;
      const a = AGENTES.find((x) => x.id === id);
      if (!a) throw new Error('Ese agente no existe.');
      if (!tareas.has(id)) throw new Error(`${a.nombre} no tiene trabajos propios todavía${LLEGA[id] ? ` (llegan en la fase ${LLEGA[id]})` : ''}.`);
      if (nombre === 'pausar') pausados.add(id);
      else if (nombre === 'reanudar') pausados.delete(id);
      else if (nombre === 'correr') encolar(id);
      else throw new Error(`Acción desconocida: ${nombre}`);
      if (nombre !== 'correr') notar(id, nombre === 'pausar' ? 'Pausado por ti.' : 'Reanudado por ti.');
      sucio = true;
      guardar();
      return { ok: true };
    },
  };
}
