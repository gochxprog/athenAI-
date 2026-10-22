// Grabadora 24/7 de athenAI (corre en el VPS con Node 22).
// Usa los MISMOS motores que la plataforma: fuente Binance → Vigía → dollar bars → 39 Features, y guarda cada fila
// en disco. La plataforma descarga lo grabado (Datos → Grabadora 24/7) aunque el computador haya estado apagado.
//
// Variables (todas opcionales):
//   SIMBOLOS=BTCUSDT,ETHUSDT   PUERTO=8080   HOST=127.0.0.1 (solo detrás de Caddy, ver asegurar.sh; por defecto todas)
//   DATOS=/var/lib/athenai-grabadora   WEB=<carpeta de la plataforma>
//   PYODIDE=<carpeta de Pyodide para los bots> (por defecto pyodide/ junto a grabadora.mjs)   BOTS=0 (los apaga)
//   BINANCE_REST / BINANCE_WS  (solo para pruebas con un servidor propio)
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { FuenteBinance } from '../src/motores/fuentes/binance';
import { Pipeline } from '../src/motores/nucleo/pipeline';
import { inferirTick, parametrosParaSimbolo, parametrosPorDefecto, type ParametrosSimbolo } from '../src/motores/nucleo/parametros';
import { EVENTOS_PREDEFINIDOS } from '../src/motores/nucleo/calendario';
import type { MensajeMercado } from '../src/motores/nucleo/tipos';
import { AlmacenDisco, RECIENTES } from './almacenDisco';
import { resumenHistoria } from './importador';
import { atenderJuez, cargarVelas, crearLaboratorio } from './laboratorioVps';
import { crearAvisos } from './avisosVps';
import { crearBiblioteca } from './bibliotecaVps';
import { crearSala } from './agentesVps';
import { atenderTrabajo, correrTrabajo } from './trabajosVps';
import { armarVelas, MS_SERIE, type Serie } from '../src/motores/laboratorio/velas';
import { crearServidor, type EstadoSimbolo } from './servidor';
import { almacenLocalDisco, cargadorPython, crearApiPaper, feedDe, LibroPaperDisco, senalesDisco } from './botsVps';
import { MotorPaper } from '../src/motores/paper/motorPaper';

export const VERSION = '1.0.0';

interface Activo {
  pipeline: Pipeline;
  calibrado: boolean;
  sesion: number;
  filas: number;
  ultimoCierre: number | null;
  cortes: number;
}

export interface OpcionesGrabadora {
  simbolos: string[];
  puerto: number;
  /** Interfaz en la que escucha (por defecto todas). */
  host?: string;
  datos: string;
  web: string | null;
  /** Bots de Paper 24/7 (por defecto sí). */
  bots?: boolean;
  /** Carpeta de Pyodide para las señales de los bots. */
  pyodide?: string | null;
  rest?: string;
  ws?: string;
  /** Mensajes al registro (journald en el VPS). */
  log?: (texto: string) => void;
}

/** Recuerda el resultado de `f` por clave durante `ms`: lo que se lee del disco no se relee en cada sondeo. */
export function recordar<A extends unknown[], R>(f: (...a: A) => R, ms: number, reloj = Date.now): (...a: A) => R {
  const memo = new Map<string, { t: number; r: R }>();
  return (...a) => {
    const k = JSON.stringify(a);
    const x = memo.get(k);
    if (x && reloj() - x.t < ms) return x.r;
    const r = f(...a);
    if (memo.size > 100) memo.clear();
    memo.set(k, { t: reloj(), r });
    return r;
  };
}

/** Clave de acceso: se crea una vez (aleatoria) y se guarda en la carpeta de datos. */
export function leerOCrearClave(datos: string): string {
  const f = path.join(datos, 'clave.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const clave = randomBytes(18).toString('base64url');
  fs.mkdirSync(datos, { recursive: true });
  fs.writeFileSync(f, `${clave}\n`, { mode: 0o600 });
  return clave;
}

export function iniciarGrabadora(o: OpcionesGrabadora) {
  const log = o.log ?? ((t: string) => console.log(`[${new Date().toISOString()}] ${t}`));
  const almacen = new AlmacenDisco(path.join(o.datos));
  if (almacen.migracion) log(almacen.migracion.error ? `Migración a carpetas por mercado incompleta (no se borró nada): ${almacen.migracion.error}` : `Datos pasados a una carpeta por mercado: ${almacen.migracion.filas} archivos de días y ${almacen.migracion.sesiones} sesiones.`);
  const clave = leerOCrearClave(o.datos);
  const inicio = Date.now();
  const activos = new Map<string, Activo>();
  let siguienteSesion = inicio;

  const crear = (simbolo: string, p: ParametrosSimbolo, calibrado: boolean, previo?: Activo): Activo => {
    const pipeline = new Pipeline(p);
    pipeline.calendario = EVENTOS_PREDEFINIDOS;
    if (previo) {
      pipeline.conexion = previo.pipeline.conexion;
      pipeline.detalleConexion = previo.pipeline.detalleConexion;
    }
    const sesion = siguienteSesion++;
    if (calibrado) almacen.nuevaSesion(simbolo, p, Date.now(), sesion);
    const a: Activo = { pipeline, calibrado, sesion, filas: previo?.filas ?? 0, ultimoCierre: previo?.ultimoCierre ?? null, cortes: previo?.cortes ?? 0 };
    activos.set(simbolo, a);
    return a;
  };
  for (const s of o.simbolos) crear(s, parametrosPorDefecto(s), false);

  const procesar = (simbolo: string, m: MensajeMercado) => {
    let a = activos.get(simbolo);
    if (!a) return;
    if (m.tipo === 'trades' && m.trades.length && !a.calibrado) {
      const precios = m.trades.map((t) => t.price);
      a = crear(simbolo, parametrosParaSimbolo(simbolo, inferirTick(simbolo, precios), precios[precios.length - 1], 0), true, a);
    }
    if (m.tipo === 'conexion' && m.estado !== a.pipeline.conexion) {
      log(`${simbolo}: ${m.estado}${m.detalle ? ` · ${m.detalle}` : ''}`);
      if ((m.estado === 'reconectando' || m.estado === 'error') && a.pipeline.conexion === 'en-vivo') a.cortes += 1;
    }
    const nuevas = a.pipeline.procesar(m);
    if (nuevas.length && a.calibrado) {
      almacen.guardar(simbolo, a.sesion, nuevas);
      a.filas += nuevas.length;
      a.ultimoCierre = nuevas[nuevas.length - 1].cierre;
    }
  };

  const fuente = new FuenteBinance({
    simbolos: o.simbolos,
    rest: o.rest,
    ws: o.ws,
    onMensaje: (s, m) => procesar(s, m),
    onInfo: (i) => {
      const a = activos.get(i.simbolo);
      if (a) crear(i.simbolo, parametrosParaSimbolo(i.simbolo, i.tickSize, i.precio, i.volumen24hUsd), true, a);
      const p = activos.get(i.simbolo)!.pipeline.parametros;
      log(`${i.simbolo}: tick ${p.tickSize} · dollar bar ${p.temporalidades.dollar.tipo === 'dolar' ? p.temporalidades.dollar.usd : 0} USD`);
    },
  });

  const escritura = setInterval(() => {
    try {
      almacen.vaciar();
    } catch (e) {
      log(`Error al escribir en disco: ${e instanceof Error ? e.message : e}`);
    }
  }, 2_000);
  const resumen = setInterval(() => {
    log([...activos].map(([s, a]) => `${s} ${a.pipeline.conexion} · ${a.filas} filas`).join(' | '));
  }, 600_000);

  const estado = () => ({
    inicio,
    version: VERSION,
    simbolos: [...activos].map(([simbolo, a]): EstadoSimbolo => ({
      simbolo,
      conexion: a.pipeline.conexion,
      detalle: a.pipeline.detalleConexion,
      filasSesion: a.filas,
      ultimoCierre: a.ultimoCierre,
      cortes: a.cortes,
      tradesPerdidos: a.pipeline.tradesPerdidos,
    })),
  });
  // Bots de Paper 24/7: el mismo motor que la plataforma, con su libro en {datos}/paper.
  const avisos = crearAvisos({ datos: o.datos, log });
  // Avisos 24/7 de fallos (un mercado sin datos más de 60 s, y cuando vuelve) y de eventos fuertes.
  const vigilaAvisos = setInterval(() => avisos.revisar([...activos].map(([s, a]) => feedDe(s, a.pipeline, a.filas, a.calibrado, a.cortes))), 5_000);
  let motorBots: MotorPaper | null = null;
  const biblioteca = crearBiblioteca({ datos: o.datos, paper: () => motorBots });
  let latido: ReturnType<typeof setInterval> | null = null;
  if (o.bots !== false) {
    const dirPaper = path.join(o.datos, 'paper');
    const libro = new LibroPaperDisco(dirPaper);
    const motor = new MotorPaper({
      senales: senalesDisco(almacen, cargadorPython(o.pyodide ?? null), (s, serie, desde) => cargarVelas(o.datos, s, serie, 'todo', desde)),
      avisar: (a) => {
        log(`Bots · ${a.titulo}: ${a.texto}`);
        void avisos.enviar(a);
      },
      reloj: () => Date.now(),
      almacen: libro,
      local: almacenLocalDisco(path.join(dirPaper, 'estado.json')),
    });
    motorBots = motor;
    let ocupado = false;
    void motor.cargar().then(() => {
      log(`Bots de Paper: ${motor.bots.length} cargados.`);
      latido = setInterval(() => {
        if (ocupado) return;
        ocupado = true;
        const feeds = [...activos].map(([s, a]) => feedDe(s, a.pipeline, a.filas, a.calibrado, a.cortes));
        motor
          .alFeeds(feeds)
          .catch((e) => log(`Bots: ${e instanceof Error ? e.message : e}`))
          .finally(() => {
            ocupado = false;
          });
      }, 1_000);
    });
  }
  // Sala de agentes: el orquestador lee cada 5 s lo que hacen los motores (la historia, cada 30 s: lee el disco).
  const sala = crearSala({ datos: o.datos, log });
  const laboratorio = crearLaboratorio({
    datos: o.datos,
    pyodide: o.pyodide ?? null,
    log,
    alTerminar: (p, r) => biblioteca.guardar(p, r),
    alFin: (t) => {
      const quien = `«${t.pedido.nombre ?? 'prueba'}» ${t.pedido.simbolo} ${t.pedido.serie}`;
      if (t.resultado) {
        sala.notar('programador', `${quien}: corrió en Python (${t.resultado.combos.length} variantes, ${t.resultado.velas.total.toLocaleString('es-ES')} velas).`);
        sala.notar('juez', `${quien}: ${t.resultado.juez.veredicto}.`, t.resultado.juez.veredicto === 'RECHAZADA');
      } else sala.notar(/Error en tu código/.test(t.error ?? '') ? 'programador' : 'juez', `${quien}: ${t.error}`, true);
    },
  });
  // La historia (lee todos los días importados) y las velas, recordadas: los sondeos de cada pantalla no releen el disco.
  const historiaDisco = recordar(() => resumenHistoria(o.datos), 20_000);
  // Velas del gráfico: si la ventana cabe en la memoria de filas recientes, se arman de ahí (sin tocar el disco).
  const velasDisco = recordar((s: string, serie: Serie, n: number) => {
    if (serie === 'dollar') return [];
    const ms = MS_SERIE[serie];
    const desde = Math.floor((Date.now() - (n + 1) * ms) / ms) * ms;
    const m = almacen.leerUltimas(s, RECIENTES);
    const velas = m.length && m[0].cierre <= desde ? armarVelas(m.filter((f) => f.cierre > desde), serie) : cargarVelas(o.datos, s, serie, 'todo', Date.now() - 3 * (n + 2) * ms);
    return velas.slice(-n);
  }, 20_000);
  // Trabajos propios de los agentes (A2), en proceso aparte. Esperan a que el Juez termine: un trabajo pesado a la vez.
  const mercadosTrabajo = () => [...new Set([...o.simbolos, ...historiaDisco().map((h) => h.carpeta.replace(/^binance_/, '').toUpperCase())])];
  const turno = async () => {
    while (laboratorio.enCurso()) await new Promise((r) => setTimeout(r, 5_000));
  };
  sala.tarea({ id: 'rastreador', nombre: 'Régimen y gemelos de cada mercado', cadaMs: 15 * 60_000, primeraMs: 60_000, correr: async () => (await turno(), correrTrabajo('rastreador', o.datos, mercadosTrabajo())) });
  sala.tarea({ id: 'etiquetador', nombre: 'Etiquetar la historia para el ML', cadaMs: 24 * 3_600_000, primeraMs: 10 * 60_000, correr: async () => (await turno(), correrTrabajo('etiquetador', o.datos, mercadosTrabajo())) });
  const vigilaSala = setInterval(() => {
    try {
      const historia = historiaDisco().map((h) => ({ carpeta: h.carpeta, importando: h.importando, dia: h.progreso?.dia ?? null, hechos: h.progreso?.hechos ?? 0, total: h.progreso?.total ?? 0 }));
      const enCurso = laboratorio.enCurso();
      const bots = motorBots?.bots.filter((b) => b.origen !== 'manual') ?? [];
      sala.latir({
        mercados: estado().simbolos,
        bots: motorBots && { total: bots.length, activos: bots.filter((b) => b.estado === 'activo').length, enPosicion: bots.filter((b) => b.posicion).length, apagado: motorBots.apagado, bitacora: motorBots.bitacora },
        prueba: enCurso && { nombre: enCurso.pedido.nombre ?? 'prueba', simbolo: enCurso.pedido.simbolo, serie: enCurso.pedido.serie, paso: enCurso.pasos.at(-1) ?? 'empezando' },
        historia,
      });
    } catch (e) {
      log(`Agentes: ${e instanceof Error ? e.message : e}`);
    }
  }, 5_000);
  const servidor = crearServidor({ almacen, clave, estado, web: o.web, paper: motorBots ? crearApiPaper(motorBots) : null, historia: historiaDisco, laboratorio, avisos, biblioteca, agentes: sala, velas: velasDisco });
  const alEscuchar = () => log(`Grabadora ${VERSION} escuchando en ${o.host ?? 'todas las interfaces'}, puerto ${o.puerto} · símbolos: ${o.simbolos.join(', ')} · datos en ${o.datos}`);
  if (o.host) servidor.listen(o.puerto, o.host, alEscuchar);
  else servidor.listen(o.puerto, alEscuchar);
  void fuente.iniciar();

  const detener = () => {
    if (latido) clearInterval(latido);
    clearInterval(escritura);
    clearInterval(resumen);
    clearInterval(vigilaAvisos);
    clearInterval(vigilaSala);
    sala.guardar();
    fuente.detener();
    almacen.vaciar();
    servidor.close();
  };
  return { clave, almacen, servidor, detener, estado, motorBots, sala };
}

// Arranque como programa (no al importarlo desde las pruebas).
// Proceso hijo del Laboratorio: solo corre una prueba del Juez y termina (no graba).
if (process.argv.includes('--juez')) atenderJuez();
else if (process.argv.includes('--trabajo')) atenderTrabajo();
else if (process.argv[1] && /grabadora\.(m?js|ts)$/.test(process.argv[1])) {
  const simbolos = (process.env.SIMBOLOS ?? 'BTCUSDT').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const g = iniciarGrabadora({
    simbolos,
    puerto: Number(process.env.PUERTO ?? 8080),
    host: process.env.HOST || undefined,
    datos: process.env.DATOS ?? path.resolve('datos'),
    web: process.env.WEB && fs.existsSync(process.env.WEB) ? process.env.WEB : null,
    bots: process.env.BOTS !== '0',
    pyodide: process.env.PYODIDE || path.join(path.dirname(process.argv[1]), 'pyodide'),
    rest: process.env.BINANCE_REST || undefined,
    ws: process.env.BINANCE_WS || undefined,
  });
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      g.detener();
      process.exit(0);
    });
  }
}
