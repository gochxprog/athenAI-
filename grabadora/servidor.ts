// API de la grabadora para la plataforma (y, si está compilada, la propia plataforma como página web).
//   GET /api/salud                     → { ok: true }               (sin clave: solo dice que está viva)
//   GET /api/estado                    → símbolos, conexión, filas  (con clave)
//   GET /api/sesiones?mercado=binance:BTCUSDT  → sesiones de grabación de ESE mercado   (con clave)
//   GET /api/filas?mercado=binance:BTCUSDT&desde=<ms>&limite=<n>  → filas con cierre > desde (máx. 5.000)
//   (también acepta `simbolo=BTCUSDT`, que equivale a binance:BTCUSDT)
//   GET  /api/paper                    → bots, bitácora, apagado y reglas del Guardián          (con clave)
//   GET  /api/paper/operaciones?bot=   → operaciones cerradas (de un bot o de todos)          (con clave)
//   POST /api/paper/{crear|pausar|reanudar|borrar|apagar|rearmar|reglas|orden|cerrar}  cuerpo JSON (con clave)
//   GET  /api/avisos                   → canales activos de los avisos 24/7 (sin credenciales)  (con clave)
//   POST /api/avisos/{guardar|probar}  configuración de Discord/Telegram/ntfy en el VPS        (con clave)
//   GET  /api/velas?simbolo=&serie=5m&n=500 → velas [inicio, o, h, l, c, vol] (historia + grabado) (con clave)
//   GET  /api/vivo?simbolo=            → precio en vivo (Server-Sent Events, cada 100 ms) {t,p,b,a}  (con clave)
//   GET  /api/biblioteca               → pruebas guardadas e intentos totales                   (con clave)
//   GET  /api/biblioteca/resultado?id= → resultado completo de una prueba                      (con clave)
//   POST /api/biblioteca/{paper|borrar} cuerpo { id, capital?, exposicion? }                   (con clave)
//   GET  /api/agentes                  → estado de los 10 agentes, notas, fila y recursos del VPS (con clave)
//   POST /api/agentes/{pausar|reanudar|correr} cuerpo { id }                                  (con clave)
// La clave va en la cabecera «Authorization: Bearer <clave>». CORS abierto: la clave es la que protege los datos.
// La PLATAFORMA (web) pide contraseña antes de mostrar nada: /entrar (la clave de la grabadora) crea una sesión
// con cookie HttpOnly + SameSite=Strict (+ Secure detrás de HTTPS), válida 30 días; /salir la cierra. Con
// sesión, la API también responde sin Bearer (la plataforma servida desde aquí no necesita escribir la clave).
// Fuerza bruta: 5 claves malas desde una IP → 15 min bloqueada.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AlmacenDisco } from './almacenDisco';
import type { ApiPaper } from './botsVps';
import type { ApiLaboratorio } from './laboratorioVps';
import type { ApiAvisos } from './avisosVps';
import type { ApiBiblioteca } from './bibliotecaVps';
import type { ApiAgentes } from './agentesVps';
import type { ApiVivo, Tick } from './vivoVps';
import { SERIES, type Serie, type VelaLab } from '../src/motores/laboratorio/velas';
import { esMercadoId, partesMercado } from '../src/motores/mercado/mercadoId';

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
  /** Bots de Paper 24/7 (botsVps.ts). */
  paper?: ApiPaper | null;
  /** Resumen de la historia importada (importador.ts). */
  historia?: () => unknown;
  /** Pruebas del Juez en el VPS (laboratorioVps.ts). */
  laboratorio?: ApiLaboratorio | null;
  /** Avisos 24/7 de los bots (avisosVps.ts). */
  avisos?: ApiAvisos | null;
  /** Pruebas guardadas y paso a Paper (bibliotecaVps.ts). */
  biblioteca?: ApiBiblioteca | null;
  /** Sala de agentes: el orquestador (agentesVps.ts). */
  agentes?: ApiAgentes | null;
  /** Últimas `n` velas de una serie (historia + grabado) para el gráfico. */
  velas?: (simbolo: string, serie: Serie, n: number) => VelaLab[];
  /** Precio en vivo cada 100 ms (vivoVps.ts). */
  vivo?: ApiVivo | null;
  /** Reloj (pruebas). */
  reloj?: () => number;
}

export const LIMITE_FILAS = 5_000;
export const MAX_VELAS_GRAFICO = 1_500;
export const COOKIE = 'athenai_sesion';
export const DURACION_SESION_MS = 30 * 86_400_000;
export const MAX_FALLOS = 5;
export const BLOQUEO_MS = 15 * 60_000;
/** Tamaño máximo del cuerpo de una acción de Paper (el bot lleva su código y los retornos del Juez). */
export const MAX_CUERPO = 2_000_000;

/** Página de entrada (sin recursos externos: no revela nada de la plataforma). */
function paginaEntrar(mensaje = '', volver = ''): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AthenAI · Entrar</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#d9dbdf;font:14px system-ui,sans-serif}form{width:min(320px,88vw);border:1px solid #2a2a2e;border-radius:14px;padding:24px;background:#0b0b0d}h1{margin:0 0 4px;font-size:18px;color:#fff;font-weight:500}p{margin:0 0 16px;color:#8e929a;font-size:12px}input{box-sizing:border-box;width:100%;padding:10px;border-radius:8px;border:1px solid #2a2a2e;background:#000;color:#fff;font:13px ui-monospace,monospace}button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:8px;background:#fff;color:#000;font-weight:600}.m{margin-top:12px;color:#fff;font-size:12px}</style></head>
<body><form method="post" action="/entrar"><h1>AthenAI</h1><p>Escribe la clave de tu grabadora para entrar.</p><input type="password" name="clave" autocomplete="current-password" autofocus required aria-label="Clave"><input type="hidden" name="volver" id="volver" value="${volver}"><button type="submit">Entrar</button>${mensaje ? `<div class="m">${mensaje}</div>` : ''}</form><script>if(location.hash)document.getElementById('volver').value=location.hash</script></body></html>`;
}

const leerCookies = (h: string | undefined) => Object.fromEntries((h ?? '').split(';').map((x) => x.trim().split('=')).filter((x) => x.length === 2).map(([k, v]) => [k, decodeURIComponent(v)]));


const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };

function claveCorrecta(recibida: string | undefined, clave: string): boolean {
  if (!recibida) return false;
  const a = Buffer.from(recibida);
  const b = Buffer.from(clave);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function crearServidor(o: OpcionesServidor): http.Server {
  /** Sesiones abiertas: token al azar → caducidad (en memoria: reiniciar la grabadora pide entrar otra vez). */
  const sesiones = new Map<string, number>();
  const fallos = new Map<string, { n: number; hasta: number }>();
  const ahora = o.reloj ?? Date.now;
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // Detrás de Caddy (127.0.0.1) la IP real viene en X-Forwarded-For; de nadie más se cree esa cabecera.
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
    const ip = (local && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
    const https = String(req.headers['x-forwarded-proto'] ?? '') === 'https';
    const token = leerCookies(req.headers.cookie)[COOKIE];
    const exp = token ? sesiones.get(token) : undefined;
    const conSesion = exp !== undefined && exp > ahora();
    if (token && exp !== undefined && !conSesion) sesiones.delete(token);
    const cookie = (valor: string, maxAge: number) => `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
    const html = (codigo: number, cuerpo: string, extra: Record<string, string> = {}) => {
      res.writeHead(codigo, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', ...extra });
      res.end(cuerpo);
    };
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const json = (codigo: number, cuerpo: unknown) => {
      const texto = JSON.stringify(cuerpo);
      const cab = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
      // Las respuestas grandes (filas, velas, operaciones) van comprimidas: 5–10 veces menos datos al celular.
      if (gzip && texto.length > 2_048) {
        const gz = zlib.gzipSync(texto, { level: 5 });
        res.writeHead(codigo, { ...cab, 'Content-Encoding': 'gzip', 'Content-Length': String(gz.length) });
        res.end(gz);
        return;
      }
      res.writeHead(codigo, cab);
      res.end(texto);
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' });
      res.end();
      return;
    }
    if (url.pathname === '/entrar' && req.method === 'POST') {
      const f = fallos.get(ip);
      if (f && f.hasta > ahora()) return html(429, paginaEntrar(`Demasiados intentos. Espera ${Math.ceil((f.hasta - ahora()) / 60_000)} min.`));
      let cuerpo = '';
      req.on('data', (c: Buffer) => {
        cuerpo += c.toString();
        if (cuerpo.length > 4_096) req.destroy();
      });
      req.on('end', () => {
        const datos = new URLSearchParams(cuerpo);
        const clave = datos.get('clave') ?? '';
        // Vuelve a la página que se pidió (solo rutas internas de la plataforma: «#/orderflow»).
        const volver = /^#\/[a-z0-9-]{0,40}$/.test(datos.get('volver') ?? '') ? datos.get('volver') : '';
        if (!claveCorrecta(clave.trim(), o.clave)) {
          // Fallos seguidos desde esta IP (un bloqueo ya vencido empieza de cero).
          const n = (f && f.hasta === 0 ? f.n : 0) + 1;
          if (fallos.size > 10_000) fallos.clear();
          fallos.set(ip, n >= MAX_FALLOS ? { n: 0, hasta: ahora() + BLOQUEO_MS } : { n, hasta: 0 });
          return html(401, paginaEntrar(n >= MAX_FALLOS ? 'Demasiados intentos. Espera 15 min.' : 'Clave incorrecta.', volver ?? ''));
        }
        fallos.delete(ip);
        const nuevo = randomBytes(32).toString('hex');
        sesiones.set(nuevo, ahora() + DURACION_SESION_MS);
        html(303, '', { Location: `/${volver}`, 'Set-Cookie': cookie(nuevo, DURACION_SESION_MS / 1000) });
      });
      return;
    }
    if (url.pathname === '/salir') {
      if (token) sesiones.delete(token);
      return html(303, '', { Location: '/entrar', 'Set-Cookie': cookie('', 0) });
    }
    if (url.pathname === '/entrar') return conSesion ? html(303, '', { Location: '/' }) : html(200, paginaEntrar());
    // Acciones (POST, solo JSON): bots de Paper, pruebas del Laboratorio y avisos.
    const modulo = req.method === 'POST' ? (['paper', 'laboratorio', 'avisos', 'biblioteca', 'agentes'] as const).find((m) => url.pathname.startsWith(`/api/${m}/`)) : undefined;
    if (modulo) {
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!conSesion && !claveCorrecta(bearer, o.clave)) return json(401, { error: 'Clave incorrecta' });
      const destino = o[modulo];
      if (!destino) return json(503, { error: `${{ paper: 'Los bots', laboratorio: 'El Laboratorio', avisos: 'Los avisos', biblioteca: 'La Biblioteca', agentes: 'Los agentes' }[modulo]} no están activos en esta grabadora` });
      // Solo JSON: un formulario de otra página no puede disparar acciones con la cookie.
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'Solo JSON' });
      const accion = url.pathname.slice(`/api/${modulo}/`.length);
      let cuerpo = '';
      req.on('data', (c: Buffer) => {
        cuerpo += c.toString();
        if (cuerpo.length > MAX_CUERPO) req.destroy();
      });
      req.on('end', () => {
        let datos: Record<string, unknown>;
        try {
          datos = cuerpo ? (JSON.parse(cuerpo) as Record<string, unknown>) : {};
        } catch {
          return json(400, { error: 'JSON no válido' });
        }
        destino
          .accion(accion, datos)
          .then((r) => json(200, r))
          .catch((e) => json(400, { error: e instanceof Error ? e.message : String(e) }));
      });
      return;
    }
    if (req.method !== 'GET') return json(405, { error: 'Solo GET' });
    if (url.pathname === '/api/salud') return json(200, { ok: true, grabadora: 'athenAI', sesion: conSesion });
    if (url.pathname.startsWith('/api/')) {
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!conSesion && !claveCorrecta(bearer, o.clave)) return json(401, { error: 'Clave incorrecta' });
      // Precio en vivo (Server-Sent Events): un mensaje cada vez que cambia, como mucho cada 100 ms.
      if (url.pathname === '/api/vivo') {
        const simbolo = simboloPedido(url) ?? '';
        if (!o.vivo || !/^[A-Z0-9]{2,20}$/.test(simbolo)) return json(400, { error: 'Pide simbolo (y que la grabadora tenga el precio en vivo).' });
        const enviar = (t: Tick) => res.write(`data: ${JSON.stringify(t)}\n\n`);
        const dejar = o.vivo.escuchar(simbolo, enviar);
        if (!dejar) return json(503, { error: 'Demasiadas conexiones en vivo abiertas.' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n');
        const u = o.vivo.ultimo(simbolo);
        if (u) enviar(u);
        // Un comentario cada 15 s: ningún proxy corta la conexión por silencio.
        const latido = setInterval(() => res.write(': \n\n'), 15_000);
        req.on('close', () => (dejar(), clearInterval(latido)));
        return;
      }
      try {
        if (url.pathname === '/api/estado') {
          const e = o.estado();
          return json(200, { ...e, almacen: o.almacen.resumen() });
        }
        if (url.pathname === '/api/historia') return json(200, { mercados: o.historia?.() ?? [] });
        if (url.pathname === '/api/biblioteca') return o.biblioteca ? json(200, o.biblioteca.lista()) : json(503, { error: 'La Biblioteca no está activa en esta grabadora' });
        if (url.pathname === '/api/biblioteca/resultado') {
          const r = o.biblioteca?.resultado(url.searchParams.get('id') ?? '');
          return r ? json(200, r) : json(404, { error: 'Ese resultado ya no está guardado.' });
        }
        if (url.pathname === '/api/agentes') return o.agentes ? json(200, o.agentes.estado()) : json(503, { error: 'Los agentes no están activos en esta grabadora' });
        if (url.pathname === '/api/avisos') return o.avisos ? json(200, o.avisos.estado()) : json(503, { error: 'Los avisos no están activos en esta grabadora' });
        if (url.pathname === '/api/laboratorio/trabajo') return o.laboratorio ? json(200, o.laboratorio.trabajo(url.searchParams.get('id') ?? '')) : json(503, { error: 'El Laboratorio no está activo en esta grabadora' });
        if (url.pathname === '/api/sesiones') {
          const simbolo = simboloPedido(url);
          return json(200, { sesiones: o.almacen.sesiones(simbolo === null ? undefined : simbolo) });
        }
        if (url.pathname === '/api/paper') {
          if (!o.paper) return json(503, { error: 'Los bots no están activos en esta grabadora' });
          return json(200, o.paper.estado());
        }
        if (url.pathname === '/api/paper/operaciones') {
          if (!o.paper) return json(503, { error: 'Los bots no están activos en esta grabadora' });
          void o.paper.operaciones(url.searchParams.get('bot') || undefined).then((ops) => json(200, { operaciones: ops }), (e) => json(500, { error: e instanceof Error ? e.message : String(e) }));
          return;
        }
        if (url.pathname === '/api/velas') {
          const simbolo = simboloPedido(url) ?? '';
          const serie = url.searchParams.get('serie') as Serie;
          if (!o.velas || !/^[A-Z0-9]{2,20}$/.test(simbolo) || !SERIES.includes(serie) || serie === 'dollar') return json(400, { error: 'Pide simbolo y serie (1m, 5m, 15m, 1h o 4h).' });
          const n = Math.min(MAX_VELAS_GRAFICO, Math.max(10, Number(url.searchParams.get('n')) || 500));
          // Compacto: [inicio, open, high, low, close, volumen] por vela.
          return json(200, { velas: o.velas(simbolo, serie, n).map((v) => [v.inicio, v.open, v.high, v.low, v.close, Math.round(v.volumen * 1e4) / 1e4]) });
        }
        if (url.pathname === '/api/filas') {
          const simbolo = simboloPedido(url) ?? '';
          // `ultimas=N`: las N filas más recientes (primera carga de una pantalla), de la memoria de la grabadora.
          const ultimas = Number(url.searchParams.get('ultimas'));
          if (ultimas > 0) return json(200, { filas: o.almacen.leerUltimas(simbolo, Math.min(LIMITE_FILAS, ultimas)), mas: false });
          const desde = Number(url.searchParams.get('desde') ?? 0);
          const limite = Math.min(LIMITE_FILAS, Math.max(1, Number(url.searchParams.get('limite') ?? LIMITE_FILAS) || LIMITE_FILAS));
          return json(200, o.almacen.leer(simbolo, Number.isFinite(desde) ? desde : 0, limite));
        }
      } catch (e) {
        return json(500, { error: e instanceof Error ? e.message : String(e) });
      }
      return json(404, { error: 'No existe' });
    }
    // La plataforma compilada (si se instaló junto a la grabadora): solo con sesión.
    if (o.web && !conSesion) return html(200, paginaEntrar());
    if (o.web) {
      const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      // Con la versión 2 instalada, todo lo que no es /v2/… lleva ahí (la versión vieja ya no se instala).
      if (!/^[/\\]v2([/\\]|$)/.test(rel) && fs.existsSync(path.join(o.web, 'v2', 'index.html'))) return html(302, '', { Location: '/v2/' });
      let archivo = path.resolve(o.web, `.${rel === '/' || rel === '\\' ? '/index.html' : rel}`);
      // Carpeta con su propio index.html (p. ej. /v2/, la versión nueva): se sirve ese.
      if (archivo.startsWith(path.resolve(o.web)) && fs.existsSync(archivo) && fs.statSync(archivo).isDirectory()) archivo = path.join(archivo, 'index.html');
      const falta = !archivo.startsWith(path.resolve(o.web)) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory();
      // Un archivo con hash que ya no existe (otra versión): 404, no la página (el navegador recarga la nueva).
      if (falta && CON_HASH.test(rel)) return json(404, { error: 'No existe' });
      if (falta) archivo = path.join(o.web, 'index.html');
      if (fs.existsSync(archivo)) return servirArchivo(archivo, req, res);
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Grabadora de athenAI funcionando. Conéctala desde la plataforma: Datos → Grabadora 24/7.');
  });
}

/** Archivos con hash en el nombre (assets/…-abc123.js): no cambian nunca, el navegador los guarda un año. */
const CON_HASH = /[\\/]assets[\\/][^\\/]+-[\w-]{6,}\.\w+$/;
const TEXTO = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.wasm']);
const comprimidos = new Map<string, { mtime: number; gz: Buffer }>();

/**
 * Sirve un archivo de la plataforma: comprimido con gzip (una vez, guardado en memoria) y con caché larga si tiene
 * hash. Sin esto el celular bajaba varios MB sin comprimir cada vez que abría una pantalla.
 */
function servirArchivo(archivo: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const ext = path.extname(archivo);
  const cabeceras: Record<string, string> = { 'Content-Type': TIPOS[ext] ?? 'application/octet-stream', 'Cache-Control': CON_HASH.test(archivo) ? 'public, max-age=31536000, immutable' : 'no-cache', Vary: 'Accept-Encoding' };
  if (TEXTO.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    const mtime = fs.statSync(archivo).mtimeMs;
    let c = comprimidos.get(archivo);
    if (!c || c.mtime !== mtime) {
      c = { mtime, gz: zlib.gzipSync(fs.readFileSync(archivo), { level: 9 }) };
      comprimidos.set(archivo, c);
    }
    res.writeHead(200, { ...cabeceras, 'Content-Encoding': 'gzip', 'Content-Length': String(c.gz.length) });
    res.end(c.gz);
    return;
  }
  res.writeHead(200, cabeceras);
  fs.createReadStream(archivo).pipe(res);
}

/** Símbolo pedido por `mercado=binance:X` o `simbolo=X`. Un mercado de otro proveedor o mal escrito no da datos (''). */
function simboloPedido(url: URL): string | null {
  const m = url.searchParams.get('mercado');
  if (m !== null) {
    if (!esMercadoId(m)) return '';
    const p = partesMercado(m);
    return p.proveedor === 'binance' ? p.simbolo : '';
  }
  const s = url.searchParams.get('simbolo');
  return s === null ? null : s.toUpperCase();
}
