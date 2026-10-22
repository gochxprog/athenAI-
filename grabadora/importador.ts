// Importador de la historia de Binance USD-M (data.binance.vision, gratis) para el VPS.
// Baja, día por día, los aggTrades y las métricas (Open Interest cada 5 min) y, por mes, el funding; los pasa por los
// MISMOS motores que la grabadora (Vigía → dollar bars → 39 Features) y guarda las filas en una carpeta APARTE:
//   {datos}/historia/mercados/{binance_btcusdt}/filas/{AAAA-MM-DD}.jsonl   (mismo formato que lo grabado)
//   {datos}/historia/mercados/{binance_btcusdt}/importados.json            días ya terminados
// No toca lo que graba la grabadora ({datos}/mercados) ni lo que baja el navegador.
//
// Sin libro de órdenes en la historia: icebergs, OBI, MicroPrice y pools quedan vacíos (null); sin liquidaciones
// (Binance dejó de publicarlas). El OI llega cada 5 min y el funding es el liquidado cada 8 h.
// Sin mirar al futuro: cada dato entra al motor recién cuando el flujo de trades llega a su hora.
//
// Uso en el VPS:  sudo bash importar.sh BTCUSDT 2026-04-01 2026-10-20
//   (por dentro: DATOS=/var/lib/athenai-grabadora node importar.mjs BTCUSDT 2026-04-01 2026-10-20)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline as encadenar } from 'node:stream/promises';
import { Pipeline } from '../src/motores/nucleo/pipeline';
import { parametrosPorDefecto, type ParametrosSimbolo } from '../src/motores/nucleo/parametros';
import { EVENTOS_PREDEFINIDOS } from '../src/motores/nucleo/calendario';
import type { AggTrade, OpenInterestSnapshot } from '../src/motores/nucleo/tipos';
import { carpetaMercado, mercadoId } from '../src/motores/mercado/mercadoId';
import { AlmacenDisco } from './almacenDisco';

/** Se puede cambiar solo para pruebas (servidor propio). */
export const BASE_BINANCE = process.env.BINANCE_HISTORIA || 'https://data.binance.vision/data/futures/um';
/** Igual que la fuente en vivo: los trades se entregan al motor en lotes de 100 ms. */
const LOTE_MS = 100;
/** Se detiene si el disco del VPS queda con menos de esto libre. */
const MINIMO_LIBRE = 3 * 1024 ** 3;

const DIA_MS = 86_400_000;
export const diaDe = (t: number) => new Date(t).toISOString().slice(0, 10);
const inicioDia = (dia: string) => Date.parse(`${dia}T00:00:00Z`);

/** Días entre dos fechas (incluidas), en orden. */
export function diasEntre(desde: string, hasta: string): string[] {
  const a = inicioDia(desde);
  const b = inicioDia(hasta);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) throw new Error(`Fechas no válidas: ${desde} → ${hasta} (formato AAAA-MM-DD)`);
  const out: string[] = [];
  for (let t = a; t <= b; t += DIA_MS) out.push(diaDe(t));
  return out;
}

export const urlTrades = (s: string, dia: string) => `${BASE_BINANCE}/daily/aggTrades/${s}/${s}-aggTrades-${dia}.zip`;
export const urlMetricas = (s: string, dia: string) => `${BASE_BINANCE}/daily/metrics/${s}/${s}-metrics-${dia}.zip`;
export const urlFunding = (s: string, mes: string) => `${BASE_BINANCE}/monthly/fundingRate/${s}/${s}-fundingRate-${mes}.zip`;

// ---------------------------------------------------------------------------------------------------------------
// ZIP (una sola entrada, como los de Binance) leído en streaming, sin dependencias.

/** Dónde empiezan los datos comprimidos de la primera entrada del zip y cuánto miden. */
export function entradaZip(archivo: string): { inicio: number; tamano: number; metodo: number } {
  const fd = fs.openSync(archivo, 'r');
  try {
    const total = fs.fstatSync(fd).size;
    const cola = Math.min(total, 65_557);
    const b = Buffer.alloc(cola);
    fs.readSync(fd, b, 0, cola, total - cola);
    const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('zip dañado (sin directorio central)');
    const dirCentral = b.readUInt32LE(eocd + 16);
    const c = Buffer.alloc(46);
    fs.readSync(fd, c, 0, 46, dirCentral);
    if (c.readUInt32LE(0) !== 0x02014b50) throw new Error('zip dañado (entrada central)');
    const metodo = c.readUInt16LE(10);
    const tamano = c.readUInt32LE(20);
    const local = c.readUInt32LE(42);
    if (tamano === 0xffffffff || local === 0xffffffff) throw new Error('zip de más de 4 GB: no soportado');
    const l = Buffer.alloc(30);
    fs.readSync(fd, l, 0, 30, local);
    if (l.readUInt32LE(0) !== 0x04034b50) throw new Error('zip dañado (cabecera local)');
    return { inicio: local + 30 + l.readUInt16LE(26) + l.readUInt16LE(28), tamano, metodo };
  } finally {
    fs.closeSync(fd);
  }
}

/** Líneas del CSV que trae el zip, sin cargarlo entero en memoria. */
export async function* lineasZip(archivo: string): AsyncGenerator<string> {
  const e = entradaZip(archivo);
  if (e.metodo !== 0 && e.metodo !== 8) throw new Error(`zip con compresión no soportada (${e.metodo})`);
  if (e.tamano === 0) return;
  const crudo = fs.createReadStream(archivo, { start: e.inicio, end: e.inicio + e.tamano - 1 });
  const flujo = e.metodo === 8 ? crudo.pipe(zlib.createInflateRaw()) : crudo;
  const rl = readline.createInterface({ input: flujo, crlfDelay: Infinity });
  for await (const l of rl) if (l) yield l;
}

// ---------------------------------------------------------------------------------------------------------------
// CSV de Binance → mensajes del motor (las cabeceras se saltan: los archivos viejos no las traen).

/** agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker */
export function tradeDeCsv(simbolo: string, l: string): AggTrade | null {
  const c = l.split(',');
  const aggTradeId = Number(c[0]);
  const price = Number(c[1]);
  const quantity = Number(c[2]);
  const timestamp = Number(c[5]);
  if (!Number.isFinite(aggTradeId) || !(price > 0) || !(quantity > 0) || !Number.isFinite(timestamp)) return null;
  return { symbol: simbolo, price, quantity, timestamp, aggTradeId, buyerIsMaker: c[6]?.trim().toLowerCase() === 'true' };
}

/** create_time,symbol,sum_open_interest,sum_open_interest_value,… (create_time en UTC, «AAAA-MM-DD hh:mm:ss»). */
export function oiDeCsv(simbolo: string, l: string): OpenInterestSnapshot | null {
  const c = l.split(',');
  const time = Date.parse(`${c[0]?.trim().replace(' ', 'T')}Z`);
  const oi = Number(c[2]);
  const valor = Number(c[3]);
  if (!Number.isFinite(time) || !(oi > 0)) return null;
  return { symbol: simbolo, time, oiContracts: oi, oiValue: Number.isFinite(valor) ? valor : null, markPrice: null, source: 'hist' };
}

/** calc_time,funding_interval_hours,last_funding_rate */
export function fundingDeCsv(l: string): { t: number; tasa: number } | null {
  const c = l.split(',');
  const t = Number(c[0]);
  const tasa = Number(c[2]);
  if (!Number.isFinite(t) || !Number.isFinite(tasa)) return null;
  return { t, tasa };
}

// ---------------------------------------------------------------------------------------------------------------
// Descargas (con su CHECKSUM sha256 cuando Binance lo publica).

/** Baja `url` a `destino`. Devuelve false si Binance no tiene ese archivo (404: día sin publicar o mercado nuevo). */
export async function descargar(url: string, destino: string): Promise<boolean> {
  const r = await fetch(url);
  if (r.status === 404) return false;
  if (!r.ok || !r.body) throw new Error(`${url}: HTTP ${r.status}`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  await encadenar(Readable.fromWeb(r.body as never), fs.createWriteStream(destino));
  const s = await fetch(`${url}.CHECKSUM`).catch(() => null);
  if (s?.ok) {
    const esperado = (await s.text()).trim().split(/\s+/)[0]?.toLowerCase();
    const h = createHash('sha256');
    await encadenar(fs.createReadStream(destino), h);
    if (esperado && h.digest('hex') !== esperado) {
      fs.rmSync(destino, { force: true });
      throw new Error(`${url}: el archivo llegó dañado (CHECKSUM distinto)`);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------

export interface OpcionesImportador {
  simbolo: string;
  desde: string;
  hasta: string;
  /** Carpeta de datos de la grabadora (la historia va en {datos}/historia). */
  datos: string;
  /** Para probar sin internet: baja una URL a un archivo (false = no existe). */
  bajar?: (url: string, destino: string) => Promise<boolean>;
  log?: (texto: string) => void;
  /** Espacio libre en disco (bytes); por defecto el real del VPS. */
  libre?: () => number;
}

export interface ResultadoImportacion {
  dias: number;
  saltados: string[];
  filas: number;
  trades: number;
}

/** Parámetros del mercado: los de la última sesión grabada en vivo (mismo tamaño de dollar bar) o los por defecto. */
export function parametrosDe(datos: string, simbolo: string): ParametrosSimbolo {
  const f = path.join(datos, 'mercados', carpetaMercado(mercadoId('binance', simbolo)), 'sesiones.jsonl');
  if (fs.existsSync(f)) {
    const lineas = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    for (let i = lineas.length - 1; i >= 0; i -= 1) {
      try {
        const p = (JSON.parse(lineas[i]) as { parametros?: ParametrosSimbolo }).parametros;
        if (p?.temporalidades) return p;
      } catch {
        // línea a medio escribir: se prueba la anterior
      }
    }
  }
  return parametrosPorDefecto(simbolo, simbolo === 'BTCUSDT' ? 0.1 : 0.01);
}

const libreReal = (dir: string) => {
  const s = fs.statfsSync(dir);
  return s.bavail * s.bsize;
};

/**
 * Importa los días pedidos que aún no estén hechos. Los días seguidos se procesan con UN motor (como en vivo); si hay
 * un hueco (día ya importado o que Binance no tiene), el tramo siguiente empieza una sesión nueva.
 */
export async function importar(o: OpcionesImportador): Promise<ResultadoImportacion> {
  const log = o.log ?? ((t: string) => console.log(`[${new Date().toISOString()}] ${t}`));
  const simbolo = o.simbolo.toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(simbolo)) throw new Error(`Símbolo no válido: ${o.simbolo}`);
  const bajar = o.bajar ?? descargar;
  const raiz = path.join(o.datos, 'historia');
  const almacen = new AlmacenDisco(raiz);
  const dirMercado = path.join(raiz, 'mercados', carpetaMercado(mercadoId('binance', simbolo)));
  const tmp = path.join(raiz, 'tmp');
  fs.mkdirSync(path.join(dirMercado, 'filas'), { recursive: true });
  const archivoHechos = path.join(dirMercado, 'importados.json');
  const hechos = new Set<string>(fs.existsSync(archivoHechos) ? (JSON.parse(fs.readFileSync(archivoHechos, 'utf8')) as string[]) : []);
  const guardarHechos = () => fs.writeFileSync(archivoHechos, JSON.stringify([...hechos].sort()));
  const libre = o.libre ?? (() => libreReal(raiz));
  const parametros = parametrosDe(o.datos, simbolo);

  const pendientes = diasEntre(o.desde, o.hasta).filter((d) => !hechos.has(d));
  // Lo que haya de días no terminados es de una importación cortada: se borra y se rehace.
  for (const d of pendientes) fs.rmSync(path.join(dirMercado, 'filas', `${d}.jsonl`), { force: true });

  const res: ResultadoImportacion = { dias: 0, saltados: [], filas: 0, trades: 0 };
  let tramo: { pipeline: Pipeline; sesion: number; ultimo: string } | null = null;
  const funding = new Map<string, { t: number; tasa: number }[]>();

  const progreso = (dia: string | null, fin = false) =>
    fs.writeFileSync(path.join(dirMercado, 'progreso.json'), JSON.stringify({ desde: o.desde, hasta: o.hasta, dia, hechos: res.dias, total: pendientes.length, fin, t: Date.now() }));
  for (const dia of pendientes) {
    progreso(dia);
    if (libre() < MINIMO_LIBRE) {
      log(`Me detengo: queda poco disco libre en el VPS. Importado hasta ${tramo?.ultimo ?? '—'}.`);
      break;
    }
    const t0 = Date.now();
    const zTrades = path.join(tmp, `${simbolo}-aggTrades-${dia}.zip`);
    const zMetricas = path.join(tmp, `${simbolo}-metrics-${dia}.zip`);
    try {
      if (!(await bajar(urlTrades(simbolo, dia), zTrades))) {
        log(`${dia}: Binance no tiene trades de ese día; se salta.`);
        res.saltados.push(dia);
        tramo = null;
        continue;
      }
      // Métricas (OI) y funding son opcionales: sin ellos esas Features quedan vacías.
      const oi: OpenInterestSnapshot[] = [];
      if (await bajar(urlMetricas(simbolo, dia), zMetricas).catch(() => false)) {
        for await (const l of lineasZip(zMetricas)) {
          const x = oiDeCsv(simbolo, l);
          if (x) oi.push(x);
        }
      }
      const mes = dia.slice(0, 7);
      if (!funding.has(mes)) {
        const zFunding = path.join(tmp, `${simbolo}-fundingRate-${mes}.zip`);
        const lista: { t: number; tasa: number }[] = [];
        if (await bajar(urlFunding(simbolo, mes), zFunding).catch(() => false)) {
          for await (const l of lineasZip(zFunding)) {
            const x = fundingDeCsv(l);
            if (x) lista.push(x);
          }
          fs.rmSync(zFunding, { force: true });
        }
        funding.set(mes, lista);
      }
      const eventos = [
        ...oi.map((x) => ({ t: x.time, m: { tipo: 'oi' as const, snapshot: x } })),
        ...funding.get(mes)!.filter((x) => diaDe(x.t) === dia).map((x) => ({ t: x.t, m: { tipo: 'funding' as const, tasa: x.tasa, t: x.t } })),
      ].sort((a, b) => a.t - b.t);

      if (!tramo || inicioDia(dia) - inicioDia(tramo.ultimo) !== DIA_MS) {
        const pipeline = new Pipeline(parametros);
        pipeline.calendario = EVENTOS_PREDEFINIDOS;
        pipeline.procesar({ tipo: 'conexion', estado: 'en-vivo', detalle: 'historia de Binance' });
        const sesion = inicioDia(dia);
        almacen.nuevaSesion(simbolo, parametros, sesion, sesion);
        tramo = { pipeline, sesion, ultimo: dia };
        log(`${dia}: empieza un tramo nuevo (los primeros minutos calientan los motores).`);
      }
      const { pipeline, sesion } = tramo;
      let filasDia = 0;
      let tradesDia = 0;
      let iEvento = 0;
      let lote: AggTrade[] = [];
      const entregar = () => {
        if (!lote.length) return;
        const nuevas = pipeline.procesar({ tipo: 'trades', trades: lote });
        lote = [];
        if (nuevas.length) {
          almacen.guardar(simbolo, sesion, nuevas);
          filasDia += nuevas.length;
          if (filasDia % 2_000 < nuevas.length) almacen.vaciar();
        }
      };
      for await (const l of lineasZip(zTrades)) {
        const t = tradeDeCsv(simbolo, l);
        if (!t) continue;
        // Antes de este trade, lo que ya se sabía a su hora (OI, funding): nunca un dato antes de su momento.
        if (iEvento < eventos.length && eventos[iEvento].t <= t.timestamp) {
          entregar();
          while (iEvento < eventos.length && eventos[iEvento].t <= t.timestamp) pipeline.procesar(eventos[iEvento++].m);
        }
        if (lote.length && t.timestamp - lote[0].timestamp >= LOTE_MS) entregar();
        lote.push(t);
        tradesDia += 1;
      }
      entregar();
      almacen.vaciar();
      hechos.add(dia);
      guardarHechos();
      tramo.ultimo = dia;
      res.dias += 1;
      res.filas += filasDia;
      res.trades += tradesDia;
      log(`${dia}: ${tradesDia.toLocaleString('es')} trades → ${filasDia.toLocaleString('es')} filas · OI ${oi.length} · ${Math.round((Date.now() - t0) / 1000)} s`);
    } finally {
      fs.rmSync(zTrades, { force: true });
      fs.rmSync(zMetricas, { force: true });
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  progreso(null, true);
  log(`Listo: ${res.dias} días, ${res.filas.toLocaleString('es')} filas${res.saltados.length ? ` · sin datos: ${res.saltados.join(', ')}` : ''}.`);
  return res;
}

/** Resumen de la historia importada por mercado (para la plataforma): días hechos, rango, disco y progreso. */
export function resumenHistoria(datos: string) {
  const raiz = path.join(datos, 'historia', 'mercados');
  if (!fs.existsSync(raiz)) return [];
  return fs.readdirSync(raiz).map((carpeta) => {
    const dir = path.join(raiz, carpeta);
    const leer = <T>(f: string, x: T): T => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
      } catch {
        return x;
      }
    };
    const dias = leer<string[]>('importados.json', []).sort();
    const filas = path.join(dir, 'filas');
    const bytes = fs.existsSync(filas) ? fs.readdirSync(filas).reduce((s, f) => s + fs.statSync(path.join(filas, f)).size, 0) : 0;
    const p = leer<{ fin: boolean; t: number; dia: string | null; hechos: number; total: number } | null>('progreso.json', null);
    // «Importando» si no terminó y escribió progreso hace poco (un día de BTC tarda ~1–2 min).
    const importando = !!p && !p.fin && Date.now() - p.t < 10 * 60_000;
    return { carpeta, dias: dias.length, desde: dias[0] ?? null, hasta: dias[dias.length - 1] ?? null, bytes, importando, progreso: p };
  });
}

// Arranque como programa: node importar.mjs BTCUSDT 2026-04-01 2026-10-20
if (process.argv[1] && /importa(dor|r)\.(m?js|ts)$/.test(process.argv[1])) {
  const [simbolo, desde, hasta] = process.argv.slice(2);
  if (!simbolo || !desde) {
    console.log('Uso: node importar.mjs SIMBOLO DESDE [HASTA]   (fechas AAAA-MM-DD; HASTA por defecto = ayer)');
    process.exit(1);
  }
  importar({ simbolo, desde, hasta: hasta ?? diaDe(Date.now() - DIA_MS), datos: process.env.DATOS ?? path.resolve('datos') }).then(
    () => process.exit(0),
    (e) => {
      console.error(`Error: ${e instanceof Error ? e.message : e}`);
      process.exit(1);
    },
  );
}
