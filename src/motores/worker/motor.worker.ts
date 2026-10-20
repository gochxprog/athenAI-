// Web Worker del motor de Order Flow: todo el cálculo vive aquí, fuera del hilo de la interfaz.
// Un Pipeline por activo asignado; la UI recibe el estado del activo que mira (5 Hz) y un resumen de los feeds (1 Hz).
// Al aplicar una configuración se descarta todo el estado anterior (pipeline limpio) y las Features nuevas se
// guardan en la "carpeta" de la fuente activa, nunca mezcladas con las de otra fuente.
import { Pipeline } from '../nucleo/pipeline';
import { filasACsv } from '../nucleo/features';
import { inferirTick, parametrosParaSimbolo, parametrosPorDefecto, type ParametrosSimbolo } from '../nucleo/parametros';
import { GeneradorDemo } from '../fuentes/demo';
import { FuenteUrus } from '../fuentes/urusSSE';
import { FuenteBinance } from '../fuentes/binance';
import { iniciarSesionRithmic } from '../fuentes/rithmicPuente';
import { AlmacenFeatures, type FilaGuardada } from '../almacen/almacen';
import type { IdTemporalidad, MensajeMercado } from '../nucleo/tipos';
import type { ConfigCentro, EstadoFeed, MensajeAlMotor, MensajeDelMotor, Proveedor } from './protocolo';

const ctx = self as unknown as { postMessage: (m: MensajeDelMotor) => void; onmessage: ((e: MessageEvent<MensajeAlMotor>) => void) | null };

const HZ_ESTADO = 5;

interface Activo {
  pipeline: Pipeline;
  calibrado: boolean;
  sesion: Promise<number> | null;
  trades: number;
  latenciaMs: number | null;
  filas: number;
}

let activos = new Map<string, Activo>();
let config: ConfigCentro | null = null;
let almacen: AlmacenFeatures | null = null;
let visible: string | null = null;
let temporalidad: IdTemporalidad = '1m';
let opcionesVista = { nBarras: 160, footprint: false, nivelesFootprint: 70 };
let detenerFuente: (() => void) | null = null;
let generacion = 0;
let msAcumulados = 0;
let ultimoFeeds = Date.now();

const registrar = (texto: string) => ctx.postMessage({ tipo: 'registro', entrada: { t: Date.now(), texto } });

function crearActivo(parametros: ParametrosSimbolo, calibrado: boolean): Activo {
  const pipeline = new Pipeline(parametros);
  pipeline.cambiarTemporalidad(temporalidad);
  const a: Activo = { pipeline, calibrado, sesion: null, trades: 0, latenciaMs: null, filas: 0 };
  if (calibrado && almacen && config?.guardar) a.sesion = almacen.nuevaSesion(parametros.simbolo, parametros, Date.now()).catch(() => -1);
  return a;
}

/** Sustituye el pipeline de un activo por uno calibrado (antes de recibir trades, o con el primer lote). */
function calibrar(simbolo: string, parametros: ParametrosSimbolo): Activo {
  const viejo = activos.get(simbolo);
  const a = crearActivo(parametros, true);
  if (viejo) {
    a.pipeline.conexion = viejo.pipeline.conexion;
    a.pipeline.detalleConexion = viejo.pipeline.detalleConexion;
  }
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
    // Latencia = llegada − hora del trade en el exchange (en Simulación no aplica).
    if (config?.proveedor !== 'simulacion') a.latenciaMs = Math.max(0, Date.now() - m.trades[m.trades.length - 1].timestamp);
  }
  if (m.tipo === 'conexion' && (m.estado !== a.pipeline.conexion || m.detalle !== a.pipeline.detalleConexion)) {
    if (m.estado === 'en-vivo' || m.estado === 'error' || m.estado === 'reconectando') registrar(`${simbolo}: ${m.estado}${m.detalle ? ` · ${m.detalle}` : ''}`);
  }
  const t0 = performance.now();
  const nuevas = a.pipeline.procesar(m);
  msAcumulados += performance.now() - t0;
  if (nuevas.length) {
    a.filas += nuevas.length;
    if (almacen && a.sesion) {
      const al = almacen;
      void a.sesion.then((id) => id >= 0 && al.guardar(simbolo, id, nuevas));
    }
  }
}

function publicar(): void {
  const a = visible ? activos.get(visible) : undefined;
  if (!a) return;
  const t0 = performance.now();
  const estado = a.pipeline.estado(opcionesVista);
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
    const f: EstadoFeed = {
      simbolo,
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
  ctx.postMessage({ tipo: 'feeds', proveedor: config?.proveedor ?? null, visible, feeds, enCola: almacen?.enCola ?? 0 });
}

function detenerTodo(): void {
  generacion += 1;
  detenerFuente?.();
  detenerFuente = null;
}

const NOMBRE: Record<Proveedor, string> = { binance: 'Binance USD-M Futures', rithmic: 'Rithmic (puente)', urus: 'Servidor Urus', simulacion: 'Simulación' };

async function aplicar(c: ConfigCentro): Promise<void> {
  detenerTodo();
  const gen = generacion;
  await almacen?.vaciar().catch(() => 0);
  almacen?.cerrar();
  config = c;
  almacen = c.guardar ? new AlmacenFeatures(c.proveedor) : null;
  const simbolos = [...new Set(c.simbolos.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 6);
  // Pipeline limpio: no queda nada de la fuente anterior.
  activos = new Map();
  const calibradoInicial = c.proveedor === 'simulacion';
  for (const s of simbolos) activos.set(s, crearActivo(parametrosPorDefecto(s), calibradoInicial));
  if (!visible || !activos.has(visible)) visible = simbolos[0] ?? null;
  registrar(`Fuente: ${NOMBRE[c.proveedor]} · activos: ${simbolos.join(', ') || '—'} · pipeline limpio${c.guardar ? ` · guardando en la carpeta athenai-${c.proveedor}` : ' · sin guardar'}`);
  const emitir = (s: string) => (m: MensajeMercado) => procesar(s, m, gen);

  switch (c.proveedor) {
    case 'simulacion': {
      const gens = simbolos.map((s, i) => {
        // Precarga de historia (≈ 6 s de cálculo por hora): 60 min para el primer activo, 15 min para el resto.
        const precarga = (i === 0 ? 60 : 15) * 60_000;
        const g = new GeneradorDemo((Date.now() + i * 7919) % 1_000_000, Date.now() - precarga);
        for (const m of g.avanzar(precarga, true)) procesar(s, m, gen);
        procesar(s, { tipo: 'conexion', estado: 'en-vivo', detalle: 'Datos sintéticos (solo pruebas)' }, gen);
        return g;
      });
      let ultimo = Date.now();
      const id = setInterval(() => {
        const ahora = Date.now();
        gens.forEach((g, i) => {
          for (const m of g.avanzar(ahora - ultimo)) procesar(simbolos[i], m, gen);
        });
        ultimo = ahora;
      }, 100);
      detenerFuente = () => clearInterval(id);
      break;
    }
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
      void f.iniciar();
      detenerFuente = () => f.detener();
      break;
    }
    case 'urus': {
      const fs = simbolos.map((s) => new FuenteUrus({ baseUrl: c.urus.baseUrl, simbolo: s, onMensaje: emitir(s) }));
      fs.forEach((f) => f.iniciar());
      detenerFuente = () => fs.forEach((f) => f.detener());
      break;
    }
    case 'rithmic': {
      let fs: FuenteUrus[] = [];
      let cancelado = false;
      detenerFuente = () => {
        cancelado = true;
        fs.forEach((f) => f.detener());
      };
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
  publicar();
  publicarFeeds();
}

function responder(id: number, trabajo: () => Promise<unknown>): void {
  trabajo().then(
    (datos) => ctx.postMessage({ tipo: 'respuesta', id, ok: true, datos }),
    (e) => ctx.postMessage({ tipo: 'respuesta', id, ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
}

setInterval(publicar, 1000 / HZ_ESTADO);
setInterval(publicarFeeds, 1000);
setInterval(() => void almacen?.vaciar().catch((e) => registrar(`No se pudo guardar: ${e instanceof Error ? e.message : e}`)), 2_000);

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
      case 'ver':
        if (activos.has(m.simbolo)) visible = m.simbolo;
        publicar();
        break;
      case 'temporalidad':
        temporalidad = m.id;
        for (const a of activos.values()) a.pipeline.cambiarTemporalidad(m.id);
        publicar();
        break;
      case 'vista':
        opcionesVista = { nBarras: m.nBarras, footprint: m.footprint, nivelesFootprint: m.nivelesFootprint };
        publicar();
        break;
      case 'exportar-features':
        responder(m.id, async () => {
          const a = visible ? activos.get(visible) : undefined;
          const filas = a?.pipeline.todasLasFilas() ?? [];
          return { csv: filasACsv(filas), filas: filas.length, simbolo: visible, proveedor: config?.proveedor };
        });
        break;
      case 'almacen-resumen':
        responder(m.id, async () => {
          await almacen?.vaciar();
          const salida: Record<string, unknown> = {};
          for (const p of ['binance', 'rithmic', 'urus', 'simulacion'] as Proveedor[]) {
            const al = almacen?.proveedor === p ? almacen : new AlmacenFeatures(p);
            salida[p] = await al.resumen();
            if (al !== almacen) al.cerrar();
          }
          return salida;
        });
        break;
      case 'almacen-exportar':
        responder(m.id, async () => {
          const al = almacen?.proveedor === m.proveedor ? almacen : new AlmacenFeatures(m.proveedor);
          const filas = await al.leer(m.simbolo);
          if (al !== almacen) al.cerrar();
          return { csv: csvGuardadas(filas), filas: filas.length };
        });
        break;
      case 'almacen-borrar':
        responder(m.id, async () => {
          if (almacen?.proveedor === m.proveedor) {
            await almacen.borrar();
            // La fuente sigue activa: las sesiones de cada activo se vuelven a abrir en la carpeta nueva.
            for (const a of activos.values()) if (a.calibrado) a.sesion = almacen.nuevaSesion(a.pipeline.simbolo, a.pipeline.parametros, Date.now()).catch(() => -1);
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
