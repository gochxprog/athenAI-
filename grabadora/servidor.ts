// API de la grabadora para la plataforma (y, si está compilada, la propia plataforma como página web).
//   GET /api/salud                     → { ok: true }               (sin clave: solo dice que está viva)
//   GET /api/estado                    → símbolos, conexión, filas  (con clave)
//   GET /api/sesiones?simbolo=BTCUSDT  → sesiones de grabación      (con clave)
//   GET /api/filas?simbolo=BTCUSDT&desde=<ms>&limite=<n>  → filas con cierre > desde (máx. 5.000)
// La clave va en la cabecera «Authorization: Bearer <clave>». CORS abierto: la clave es la que protege los datos.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { AlmacenDisco } from './almacenDisco';

export interface EstadoSimbolo {
  simbolo: string;
  conexion: string;
  detalle: string;
  filasSesion: number;
  ultimoCierre: number | null;
  cortes: number;
  tradesPerdidos: number;
}

export interface OpcionesServidor {
  almacen: AlmacenDisco;
  clave: string;
  estado: () => { inicio: number; version: string; simbolos: EstadoSimbolo[] };
  /** Carpeta con la plataforma compilada (dist/) para servirla en «/». Opcional. */
  web?: string | null;
}

export const LIMITE_FILAS = 5_000;

const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };

function claveCorrecta(recibida: string | undefined, clave: string): boolean {
  if (!recibida) return false;
  const a = Buffer.from(recibida);
  const b = Buffer.from(clave);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function crearServidor(o: OpcionesServidor): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (codigo: number, cuerpo: unknown) => {
      res.writeHead(codigo, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(cuerpo));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' });
      res.end();
      return;
    }
    if (req.method !== 'GET') return json(405, { error: 'Solo GET' });
    if (url.pathname === '/api/salud') return json(200, { ok: true, grabadora: 'athenAI' });
    if (url.pathname.startsWith('/api/')) {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!claveCorrecta(token, o.clave)) return json(401, { error: 'Clave incorrecta' });
      try {
        if (url.pathname === '/api/estado') {
          const e = o.estado();
          return json(200, { ...e, almacen: o.almacen.resumen() });
        }
        if (url.pathname === '/api/sesiones') return json(200, { sesiones: o.almacen.sesiones(url.searchParams.get('simbolo') ?? undefined) });
        if (url.pathname === '/api/filas') {
          const simbolo = (url.searchParams.get('simbolo') ?? '').toUpperCase();
          const desde = Number(url.searchParams.get('desde') ?? 0);
          const limite = Math.min(LIMITE_FILAS, Math.max(1, Number(url.searchParams.get('limite') ?? LIMITE_FILAS) || LIMITE_FILAS));
          return json(200, o.almacen.leer(simbolo, Number.isFinite(desde) ? desde : 0, limite));
        }
      } catch (e) {
        return json(500, { error: e instanceof Error ? e.message : String(e) });
      }
      return json(404, { error: 'No existe' });
    }
    // La plataforma compilada (si se instaló junto a la grabadora).
    if (o.web) {
      const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      let archivo = path.resolve(o.web, `.${rel === '/' || rel === '\\' ? '/index.html' : rel}`);
      if (!archivo.startsWith(path.resolve(o.web)) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) archivo = path.join(o.web, 'index.html');
      if (fs.existsSync(archivo)) {
        res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] ?? 'application/octet-stream' });
        fs.createReadStream(archivo).pipe(res);
        return;
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Grabadora de athenAI funcionando. Conéctala desde la plataforma: Datos → Grabadora 24/7.');
  });
}
