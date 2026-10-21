// Web Worker del motor de Order Flow: todo el cálculo vive aquí, fuera del hilo de la interfaz.
// Un Pipeline por activo asignado y cada activo con su fuente (se pueden mezclar Binance, Rithmic y Urus).
// La UI recibe el estado del activo que mira (5 Hz) y un resumen de todos los feeds (1 Hz).
// Al aplicar una configuración se cierran todas las fuentes y se descarta todo el estado (pipeline limpio);
// las Features nuevas de cada activo se guardan en la "carpeta" de SU fuente, nunca mezcladas.
import { Pipeline } from '../nucleo/pipeline';
import { filasACsv } from '../nucleo/features';
import { featuresExtremas } from '../investigacion/extremos';
import { inferirTick, parametrosParaSimbolo, parametrosPorDefecto, type ParametrosSimbolo } from '../nucleo/parametros';
import { FuenteUrus } from '../fuentes/urusSSE';
import { FuenteBinance } from '../fuentes/binance';
import { iniciarSesionRithmic } from '../fuentes/rithmicPuente';
import { AlmacenFeatures, borrarCarpetaSintetica, PROVEEDORES, type FilaGuardada } from '../almacen/almacen';
import { detectarRegimen, MIN_BARRAS_REGIMEN } from '../memoria/regimen';
import { buscarMemoria, MIN_VENTANAS } from '../memoria/gemelos';
import { cruzarMercados, type CruceMercados, type SerieCierres } from '../memoria/cruce';
import type { EventoCalendario } from '../nucleo/calendario';
import type { IdTemporalidad, MensajeMercado } from '../nucleo/tipos';
import type { ConfigCentro, EstadoFeed, MemoriaFeed, MensajeAlMotor, MensajeDelMotor, Proveedor } from './protocolo';

const ctx = self as unknown as { postMessage: (m: MensajeDelMotor) => void; onmessage: ((e: MessageEvent<MensajeAlMotor>) => void) | null };

const HZ_ESTADO = 5;

// La plataforma solo trabaja con mercado real: se borra cualquier carpeta de datos sintéticos que quede.
borrarCarpetaSintetica();

interface Activo {
  proveedor: Proveedor;
  pipeline: Pipeline;
  calibrado: boolean;
  sesion: Promise<number> | null;
  trades: number;
  latenciaMs: number | null;
  filas: number;
  cortes: number;
  historial: number[];
  cvdHist: number[];
  ritmo: number[];
  filasVentana: number;
  segVentana: number;
  memoria: MemoriaFeed | null;
}

let activos = new Map<string, Activo>();
let calendario: EventoCalendario[] = [];
let config: ConfigCentro | null = null;
/** Una carpeta (base IndexedDB) por fuente en uso. */
let almacenes = new Map<Proveedor, AlmacenFeatures>();
let visible: string | null = null;
let temporalidad: IdTemporalidad = '1m';
let opcionesVista = { nBarras: 160, footprint: false, nivelesFootprint: 70, heatmap: false };
/** Último heatmap enviado: solo se reenvía cuando cambia (es la parte más pesada del estado). */
let ultimoHeatmap: unknown = null;
let detenerFuentes: (() => void)[] = [];
let generacion = 0;
let msAcumulados = 0;
let ultimoFeeds = Date.now();

const registrar = (texto: string) => ctx.postMessage({ tipo: 'registro', entrada: { t: Date.now(), texto } });

function crearActivo(proveedor: Proveedor, parametros: ParametrosSimbolo, calibrado: boolean): Activo {
  const pipeline = new Pipeline(parametros);
  pipeline.cambiarTemporalidad(temporalidad);
  pipeline.calendario = calendario;
  const almacen = almacenes.get(proveedor);
  const a: Activo = { proveedor, pipeline, calibrado, sesion: null, trades: 0, latenciaMs: null, filas: 0, cortes: 0, historial: [], cvdHist: [], ritmo: [], filasVentana: 0, segVentana: 0, memoria: null };
  if (calibrado && almacen && config?.guardar) a.sesion = almacen.nuevaSesion(parametros.simbolo, parametros, Date.now()).catch(() => -1);
  return a;
}

/** Sustituye el pipeline de un activo por uno calibrado (antes de recibir trades, o con el primer lote). */
function calibrar(simbolo: string, parametros: ParametrosSimbolo): Activo {
  const viejo = activos.get(simbolo);
  if (!viejo) throw new Error(`Activo desconocido: ${simbolo}`);
  const a = crearActivo(viejo.proveedor, parametros, true);
  a.pipeline.conexion = viejo.pipeline.conexion;
  a.pipeline.detalleConexion = viejo.pipeline.detalleConexion;
  a.cortes = viejo.cortes;
  a.memoria = viejo.memoria;
  activos.set(simbolo, a);
  const t = parametros.temporalidades;
  registrar(`${simbolo}: tick ${parametros.tickSize} · dollar bar ${num(t.dollar.tipo === 'dolar' ? t.dollar.usd : 0)} USD · paso Footprint 1m ${parametros.pasos['1m']}`);
  return a;
}

const num = (x: number) => x.toLocaleString('es-ES');

function procesar(simbolo: string, m: MensajeMercado, gen: number): void {
  if (gen !== generacion) return;
  let a = activos.get(simbolo);
  if (!a) return;
  if (m.tipo === 'trades') {
    if (!m.trades.length) return;
    // Fuentes sin metadatos (Urus, Rithmic): se calibra con el primer lote real.
    if (!a.calibrado) {
      const precios = m.trades.map((t) => t.price);
      a = calibrar(simbolo, parametrosParaSimbolo(simbolo, inferirTick(simbolo, precios), precios[precios.length - 1], 0));
    }
    a.trades += m.trades.length;
    // Latencia = llegada − hora del trade en el exchange.
    a.latenciaMs = Math.max(0, Date.now() - m.trades[m.trades.length - 1].timestamp);
  }
  if (m.tipo === 'conexion' && (m.estado !== a.pipeline.conexion || m.detalle !== a.pipeline.detalleConexion)) {
    if (m.estado === 'en-vivo' || m.estado === 'error' || m.estado === 'reconectando' || m.estado === 'sin-datos') registrar(`${simbolo}: ${m.estado}${m.detalle ? ` · ${m.detalle}` : ''}`);
    if ((m.estado === 'reconectando' || m.estado === 'error') && a.pipeline.conexion === 'en-vivo') a.cortes += 1;
  }
  const t0 = performance.now();
  const nuevas = a.pipeline.procesar(m);
  msAcumulados += performance.now() - t0;
  if (nuevas.length) {
    a.filas += nuevas.length;
    a.filasVentana += nuevas.length;
    const al = almacenes.get(a.proveedor);
    if (al && a.sesion) void a.sesion.then((id) => id >= 0 && al.guardar(simbolo, id, nuevas));
  }
}

function publicar(): void {
  const a = visible ? activos.get(visible) : undefined;
  if (!a) return;
  const t0 = performance.now();
  const estado = a.pipeline.estado(opcionesVista);
  if (estado.heatmap === ultimoHeatmap) estado.heatmap = null;
  else ultimoHeatmap = estado.heatmap;
  const ms = msAcumulados + (performance.now() - t0);
  msAcumulados = 0;
  ctx.postMessage({ tipo: 'estado', estado, msProceso: ms });
}

function publicarFeeds(): void {
  const ahora = Date.now();
  const seg = Math.max(0.001, (ahora - ultimoFeeds) / 1000);
  ultimoFeeds = ahora;
  const feeds: EstadoFeed[] = [...activos.entries()].map(([simbolo, a]) => {
    const p = a.pipeline;
    const dollar = p.parametros.temporalidades.dollar;
    // Muestras por segundo (historial de precio y CVD) y ritmo de dollar bars en ventanas de 10 s.
    const r = p.resumen();
    if (r.precio !== null) {
      a.historial.push(r.precio);
      if (a.historial.length > 300) a.historial.splice(0, a.historial.length - 300);
    }
    a.cvdHist.push(r.cvdSesion);
    if (a.cvdHist.length > 61) a.cvdHist.splice(0, a.cvdHist.length - 61);
    a.segVentana += 1;
    if (a.segVentana >= 10) {
      a.ritmo.push(a.filasVentana * 6);
      if (a.ritmo.length > 30) a.ritmo.shift();
      a.segVentana = 0;
      a.filasVentana = 0;
    }
    const f: EstadoFeed = {
      simbolo,
      proveedor: a.proveedor,
      guardando: !!(almacenes.get(a.proveedor) && a.sesion),
      cortes: a.cortes,
      tradesPerdidos: p.tradesPerdidos,
      historial: a.historial.slice(-120),
      ritmo: [...a.ritmo],
      cvdVelocidad: a.cvdHist.length >= 61 ? a.cvdHist[a.cvdHist.length - 1] - a.cvdHist[0] : null,
      resumen: r,
      memoria: a.memoria,
      eventos: p.mercado.eventos.ultimos(6).reverse(),
      extremas: featuresExtremas(p.features.ultimos(201), 3),
      conexion: p.conexion,
      detalle: p.detalleConexion,
      tradesPorSeg: a.trades / seg,
      latenciaMs: a.latenciaMs,
      precio: p.mercado.ultimoPrecio,
      filas: a.filas,
      tickSize: p.tickSize,
      dollarBarUsd: dollar.tipo === 'dolar' ? dollar.usd : 0,
      calibrado: a.calibrado,
    };
    a.trades = 0;
    return f;
  });
  const enCola = [...almacenes.values()].reduce((x, al) => x + al.enCola, 0);
  ctx.postMessage({ tipo: 'feeds', proveedores: [...new Set([...activos.values()].map((a) => a.proveedor))], visible, feeds, enCola, cruces });
}

function detenerTodo(): void {
  generacion += 1;
  for (const d of detenerFuentes) d();
  detenerFuentes = [];
}

const vaciarAlmacenes = () => Promise.all([...almacenes.values()].map((al) => al.vaciar().catch(() => 0)));

const NOMBRE: Record<Proveedor, string> = { binance: 'Binance USD-M Futures', rithmic: 'Rithmic (puente)', urus: 'Servidor Urus' };

async function aplicar(c: ConfigCentro): Promise<void> {
  detenerTodo();
  const gen = generacion;
  // Cerrar el chorro anterior: escribir lo pendiente y soltar sus carpetas.
  await vaciarAlmacenes();
  for (const al of almacenes.values()) al.cerrar();
  config = c;
  const lista: { simbolo: string; proveedor: Proveedor }[] = [];
  for (const x of c.activos) {
    const simbolo = x.simbolo.trim().toUpperCase();
    if (simbolo && !lista.some((y) => y.simbolo === simbolo)) lista.push({ simbolo, proveedor: x.proveedor });
  }
  lista.splice(6);
  const grupos = new Map<Proveedor, string[]>();
  for (const x of lista) grupos.set(x.proveedor, [...(grupos.get(x.proveedor) ?? []), x.simbolo]);
  almacenes = new Map(c.guardar ? [...grupos.keys()].map((p) => [p, new AlmacenFeatures(p)] as const) : []);
  // Pipeline limpio: no queda nada de la configuración anterior.
  activos = new Map();
  cruces = [];
  for (const x of lista) activos.set(x.simbolo, crearActivo(x.proveedor, parametrosPorDefecto(x.simbolo), false));
  if (!visible || !activos.has(visible)) visible = lista[0]?.simbolo ?? null;
  const descripcion = [...grupos].map(([p, ss]) => `${NOMBRE[p]}: ${ss.join(', ')}`).join(' · ');
  registrar(`Pipeline limpio · ${descripcion || 'sin activos'}${c.guardar ? ` · guardando en ${[...grupos.keys()].map((p) => `athenai-${p}`).join(', ')}` : ' · sin guardar'}`);
  for (const [p, simbolos] of grupos) void iniciarFuente(p, simbolos, c, gen);
  // Primera memoria con lo ya grabado en las carpetas (unos segundos después de arrancar).
  ultimaMemoria = Date.now() - CADA_MEMORIA_MS + 5_000;
  publicar();
  publicarFeeds();
}

async function iniciarFuente(proveedor: Proveedor, simbolos: string[], c: ConfigCentro, gen: number): Promise<void> {
  const emitir = (s: string) => (m: MensajeMercado) => procesar(s, m, gen);
  switch (proveedor) {
    case 'binance': {
      const f = new FuenteBinance({
        simbolos,
        rest: c.binance.rest || undefined,
        ws: c.binance.ws || undefined,
        onMensaje: (s, m) => procesar(s, m, gen),
        onInfo: (i) => {
          if (gen !== generacion) return;
          calibrar(i.simbolo, parametrosParaSimbolo(i.simbolo, i.tickSize, i.precio, i.volumen24hUsd));
        },
      });
      detenerFuentes.push(() => f.detener());
      void f.iniciar();
      break;
    }
    case 'urus': {
      const fs = simbolos.map((s) => new FuenteUrus({ baseUrl: c.urus.baseUrl, simbolo: s, onMensaje: emitir(s) }));
      detenerFuentes.push(() => fs.forEach((f) => f.detener()));
      fs.forEach((f) => f.iniciar());
      break;
    }
    case 'rithmic': {
      let fs: FuenteUrus[] = [];
      let cancelado = false;
      detenerFuentes.push(() => {
        cancelado = true;
        fs.forEach((f) => f.detener());
      });
      for (const s of simbolos) procesar(s, { tipo: 'conexion', estado: 'conectando', detalle: 'Iniciando sesión en Rithmic por el puente' }, gen);
      try {
        await iniciarSesionRithmic(c.rithmic.puente, c.rithmic);
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e);
        for (const s of simbolos) procesar(s, { tipo: 'conexion', estado: 'error', detalle }, gen);
        return;
      }
      if (cancelado) return;
      fs = simbolos.map((s) => new FuenteUrus({ baseUrl: c.rithmic.puente, simbolo: s, onMensaje: emitir(s) }));
      fs.forEach((f) => f.iniciar());
      break;
    }
  }
}

// --- Memoria del mercado (Bloque B) -------------------------------------------------------------
const CADA_MEMORIA_MS = 120_000;
const MAX_FILAS_MEMORIA = 20_000;
let calculandoMemoria = false;
let cruces: CruceMercados[] = [];
let ultimaMemoria = 0;

/** Recalcula régimen y memoria de todos los activos, uno detrás de otro, con lo grabado en su carpeta. */
async function calcularMemoria(): Promise<void> {
  if (calculandoMemoria) return;
  calculandoMemoria = true;
  const gen = generacion;
  const series: SerieCierres[] = [];
  try {
    for (const [simbolo, a] of [...activos]) {
      if (gen !== generacion) return;
      const al = almacenes.get(a.proveedor);
      let filas: (FilaGuardada | (ReturnType<Pipeline['todasLasFilas']>[number] & { sesion?: number }))[];
      try {
        filas = al ? await al.leer(simbolo) : a.pipeline.todasLasFilas();
      } catch (e) {
        a.memoria = { calculadoEn: Date.now(), filas: 0, regimen: null, memoria: null, faltan: null, error: e instanceof Error ? e.message : String(e) };
        continue;
      }
      if (gen !== generacion || activos.get(simbolo) !== a) continue;
      filas = filas.slice(-MAX_FILAS_MEMORIA);
      series.push({ simbolo, puntos: filas.map((f) => ({ cierre: f.cierre, close: f.close })) });
      const t0 = performance.now();
      try {
        const regimen = detectarRegimen(filas);
        const memoria = buscarMemoria(filas);
        const faltan: string[] = [];
        if (!regimen) faltan.push(`régimen: ${Math.min(filas.length, MIN_BARRAS_REGIMEN)}/${MIN_BARRAS_REGIMEN} barras`);
        if (!memoria) faltan.push(`memoria: ${Math.min(filas.length, MIN_VENTANAS + 20)}/${MIN_VENTANAS + 20} barras`);
        const antes = a.memoria;
        a.memoria = { calculadoEn: Date.now(), filas: filas.length, regimen, memoria, faltan: faltan.length ? `Faltan datos · ${faltan.join(' · ')}` : null };
        if (regimen && antes?.regimen?.actual !== regimen.actual) registrar(`${simbolo}: régimen ${regimen.actual} (${Math.round(regimen.probabilidades[regimen.actual] * 100)} %)`);
        if (memoria?.distinto.aviso && !antes?.memoria?.distinto.aviso) registrar(`${simbolo}: HOY ES DISTINTO · ${memoria.distinto.motivo}`);
      } catch (e) {
        a.memoria = { calculadoEn: Date.now(), filas: filas.length, regimen: null, memoria: null, faltan: null, error: e instanceof Error ? e.message : String(e) };
      }
      msAcumulados += performance.now() - t0;
    }
    if (gen === generacion && series.length >= 2) {
      const ahora = Math.max(...series.map((x) => x.puntos[x.puntos.length - 1]?.cierre ?? 0));
      cruces = cruzarMercados(series, ahora);
    } else if (series.length < 2) cruces = [];
  } finally {
    calculandoMemoria = false;
    ultimaMemoria = Date.now();
  }
}

function responder(id: number, trabajo: () => Promise<unknown>): void {
  trabajo().then(
    (datos) => ctx.postMessage({ tipo: 'respuesta', id, ok: true, datos }),
    (e) => ctx.postMessage({ tipo: 'respuesta', id, ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
}

setInterval(publicar, 1000 / HZ_ESTADO);
setInterval(() => {
  if (activos.size && Date.now() - ultimaMemoria > CADA_MEMORIA_MS) void calcularMemoria();
}, 10_000);
setInterval(publicarFeeds, 1000);
setInterval(() => {
  for (const al of almacenes.values()) void al.vaciar().catch((e) => registrar(`No se pudo guardar en athenai-${al.proveedor}: ${e instanceof Error ? e.message : e}`));
}, 2_000);

ctx.onmessage = (e) => {
  const m = e.data;
  try {
    switch (m.tipo) {
      case 'aplicar':
        void aplicar(m.config).catch((err) => ctx.postMessage({ tipo: 'error', mensaje: err instanceof Error ? err.message : String(err) }));
        break;
      case 'detener':
        detenerTodo();
        for (const a of activos.values()) a.pipeline.procesar({ tipo: 'conexion', estado: 'detenido', detalle: 'Detenido desde el Centro de datos' });
        registrar('Fuente detenida');
        publicar();
        publicarFeeds();
        break;
      case 'calendario':
        calendario = m.eventos;
        for (const a of activos.values()) a.pipeline.calendario = calendario;
        break;
      case 'memoria-recalcular':
        void calcularMemoria();
        break;
      case 'ver':
        if (activos.has(m.simbolo)) visible = m.simbolo;
        ultimoHeatmap = null;
        publicar();
        break;
      case 'temporalidad':
        temporalidad = m.id;
        for (const a of activos.values()) a.pipeline.cambiarTemporalidad(m.id);
        publicar();
        break;
      case 'vista':
        opcionesVista = { nBarras: m.nBarras, footprint: m.footprint, nivelesFootprint: m.nivelesFootprint, heatmap: m.heatmap };
        ultimoHeatmap = null;
        publicar();
        break;
      case 'exportar-features':
        responder(m.id, async () => {
          const a = visible ? activos.get(visible) : undefined;
          const filas = a?.pipeline.todasLasFilas() ?? [];
          return { csv: filasACsv(filas), filas: filas.length, simbolo: visible, proveedor: a?.proveedor };
        });
        break;
      case 'almacen-resumen':
        responder(m.id, async () => {
          await vaciarAlmacenes();
          const salida: Record<string, unknown> = {};
          for (const p of PROVEEDORES) {
            const propio = almacenes.get(p);
            const al = propio ?? new AlmacenFeatures(p);
            salida[p] = await al.resumen();
            if (!propio) al.cerrar();
          }
          return salida;
        });
        break;
      case 'almacen-exportar':
        responder(m.id, async () => {
          const propio = almacenes.get(m.proveedor);
          const al = propio ?? new AlmacenFeatures(m.proveedor);
          const filas = await al.leer(m.simbolo);
          if (!propio) al.cerrar();
          return { csv: csvGuardadas(filas), filas: filas.length };
        });
        break;
      case 'almacen-borrar':
        responder(m.id, async () => {
          const propio = almacenes.get(m.proveedor);
          if (propio) {
            await propio.borrar();
            // La fuente sigue activa: las sesiones de sus activos se vuelven a abrir en la carpeta nueva.
            for (const a of activos.values()) if (a.proveedor === m.proveedor && a.calibrado) a.sesion = propio.nuevaSesion(a.pipeline.simbolo, a.pipeline.parametros, Date.now()).catch(() => -1);
          } else await new AlmacenFeatures(m.proveedor).borrar();
          registrar(`Carpeta athenai-${m.proveedor} borrada`);
          return true;
        });
        break;
    }
  } catch (err) {
    ctx.postMessage({ tipo: 'error', mensaje: err instanceof Error ? err.message : String(err) });
  }
};

/** CSV de filas guardadas: añade símbolo y sesión de captura (la `n` se reinicia en cada sesión). */
function csvGuardadas(filas: FilaGuardada[]): string {
  const base = filasACsv(filas).split('\n');
  return [`simbolo,sesion,${base[0]}`, ...filas.map((f, i) => `${f.simbolo},${f.sesion},${base[i + 1]}`)].join('\n');
}
