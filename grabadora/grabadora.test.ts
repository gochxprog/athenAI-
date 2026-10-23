import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AlmacenDisco, leerLineas } from './almacenDisco';
import { BLOQUEO_MS, COOKIE, crearServidor, LIMITE_FILAS, MAX_FALLOS } from './servidor';
import { crearVivo } from './vivoVps';
import { baseSesion, leerOCrearClave } from './grabadora';
import { MotorMercado } from '../src/motores/nucleo/motorMercado';
import { parametrosPorDefecto } from '../src/motores/nucleo/parametros';
import type { FilaFeatures } from '../src/motores/nucleo/features';

const carpetas: string[] = [];
const temporal = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'grabadora-'));
  carpetas.push(d);
  return d;
};
afterEach(() => {
  for (const d of carpetas.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const DIA = Date.UTC(2026, 9, 21);
const fila = (n: number, cierre: number): FilaFeatures => ({ n, inicio: cierre - 1_000, cierre, close: 100 + n, valores: { delta_ratio: 0.1 * n, hueco: 0 } });

describe('Almacén en disco de la grabadora', () => {
  it('guarda por símbolo y día UTC, lee en orden desde un cierre y resume', () => {
    const a = new AlmacenDisco(temporal());
    a.nuevaSesion('BTCUSDT', parametrosPorDefecto(), DIA, 7);
    a.guardar('BTCUSDT', 7, [fila(1, DIA + 1_000), fila(2, DIA + 2_000)]);
    a.guardar('BTCUSDT', 7, [fila(3, DIA + 86_400_000 + 500)]); // día siguiente
    expect(a.vaciar()).toBe(3);
    expect(a.dias('BTCUSDT')).toEqual(['2026-10-21', '2026-10-22']);
    expect(a.leer('BTCUSDT', 0, 10).filas.map((f) => f.n)).toEqual([1, 2, 3]);
    expect(a.leer('BTCUSDT', DIA + 1_000, 10).filas.map((f) => f.n)).toEqual([2, 3]);
    const pagina = a.leer('BTCUSDT', 0, 2);
    expect(pagina.filas).toHaveLength(2);
    expect(pagina.mas).toBe(true);
    expect(a.leer('BTCUSDT', 0, 10).filas[0].sesion).toBe(7);
    expect(a.leer('BTCUSDT', 0, 10).filas[0].mercado).toBe('binance:BTCUSDT');
    expect(a.resumen()).toEqual([{ mercado: 'binance:BTCUSDT', simbolo: 'BTCUSDT', filas: 3, desde: DIA + 1_000, hasta: DIA + 86_400_500, bytes: expect.any(Number) }]);
    // Al escribir más, el resumen se actualiza sin releer el disco.
    a.guardar('BTCUSDT', 7, [fila(4, DIA + 86_400_000 + 900)]);
    a.vaciar();
    expect(a.resumen()[0].filas).toBe(4);
    expect(a.sesiones('BTCUSDT').map((s) => s.id)).toEqual([7]);
  });

  it('cada mercado en su carpeta: BTC y XAU nunca comparten archivo ni sesiones', () => {
    const d = temporal();
    const a = new AlmacenDisco(d);
    a.nuevaSesion('BTCUSDT', parametrosPorDefecto(), DIA, 1);
    a.nuevaSesion('XAUUSDT', parametrosPorDefecto(), DIA, 2);
    a.guardar('BTCUSDT', 1, [fila(1, DIA + 1_000)]);
    a.guardar('XAUUSDT', 2, [fila(1, DIA + 1_000), fila(2, DIA + 2_000)]);
    a.vaciar();
    expect(fs.readdirSync(path.join(d, 'mercados')).sort()).toEqual(['binance_btcusdt', 'binance_xauusdt']);
    expect(leerLineas<{ mercado: string }>(path.join(d, 'mercados', 'binance_btcusdt', 'filas', '2026-10-21.jsonl')).map((f) => f.mercado)).toEqual(['binance:BTCUSDT']);
    expect(leerLineas<{ mercado: string }>(path.join(d, 'mercados', 'binance_xauusdt', 'filas', '2026-10-21.jsonl')).map((f) => f.mercado)).toEqual(['binance:XAUUSDT', 'binance:XAUUSDT']);
    expect(a.leer('BTCUSDT', 0, 10).filas).toHaveLength(1);
    expect(a.leer('XAUUSDT', 0, 10).filas).toHaveLength(2);
    expect(a.sesiones('BTCUSDT').map((s) => s.id)).toEqual([1]);
    expect(a.sesiones('XAUUSDT').map((s) => s.id)).toEqual([2]);
    expect(a.sesiones().map((s) => s.mercado)).toEqual(['binance:BTCUSDT', 'binance:XAUUSDT']);
  });

  it('migra el formato anterior moviendo los archivos, sin perder filas, y se puede repetir', () => {
    const d = temporal();
    // Formato anterior: filas/{SIMBOLO}/{día}.jsonl y un sesiones.jsonl común.
    fs.mkdirSync(path.join(d, 'filas', 'BTCUSDT'), { recursive: true });
    fs.mkdirSync(path.join(d, 'filas', 'XAUUSDT'), { recursive: true });
    const linea = (n: number, s: string) => JSON.stringify({ ...fila(n, DIA + n * 1_000), simbolo: s, sesion: 9 });
    fs.writeFileSync(path.join(d, 'filas', 'BTCUSDT', '2026-10-21.jsonl'), `${linea(1, 'BTCUSDT')}\n${linea(2, 'BTCUSDT')}\n`);
    fs.writeFileSync(path.join(d, 'filas', 'XAUUSDT', '2026-10-21.jsonl'), `${linea(1, 'XAUUSDT')}\n`);
    fs.writeFileSync(path.join(d, 'sesiones.jsonl'), `${JSON.stringify({ id: 9, simbolo: 'BTCUSDT', inicio: DIA, parametros: parametrosPorDefecto() })}\n${JSON.stringify({ id: 10, simbolo: 'XAUUSDT', inicio: DIA, parametros: parametrosPorDefecto() })}\n`);
    const a = new AlmacenDisco(d);
    expect(a.migracion).toEqual({ filas: 2, sesiones: 2 });
    expect(fs.existsSync(path.join(d, 'filas'))).toBe(false);
    expect(fs.existsSync(path.join(d, 'sesiones.jsonl.migrado'))).toBe(true);
    expect(a.leer('BTCUSDT', 0, 10).filas.map((f) => [f.n, f.mercado])).toEqual([[1, 'binance:BTCUSDT'], [2, 'binance:BTCUSDT']]);
    expect(a.leer('XAUUSDT', 0, 10).filas.map((f) => f.mercado)).toEqual(['binance:XAUUSDT']);
    expect(a.sesiones('BTCUSDT').map((s) => s.id)).toEqual([9]);
    expect(a.sesiones('XAUUSDT').map((s) => s.id)).toEqual([10]);
    // Arrancar otra vez no cambia nada.
    const b = new AlmacenDisco(d);
    expect(b.migracion).toBeNull();
    expect(b.leer('BTCUSDT', 0, 10).filas).toHaveLength(2);
  });

  it('una línea cortada por un apagón se ignora al leer', () => {
    const d = temporal();
    const f = path.join(d, 'x.jsonl');
    fs.writeFileSync(f, '{"cierre":1}\n{"cierre":2}\n{"cier');
    expect(leerLineas<{ cierre: number }>(f).map((x) => x.cierre)).toEqual([1, 2]);
  });

  it('no deja leer fuera de su carpeta con un símbolo raro', () => {
    const a = new AlmacenDisco(temporal());
    expect(a.leer('../../etc', 0, 10).filas).toEqual([]);
  });

  it('la clave se crea una vez y se reutiliza', () => {
    const d = temporal();
    const k = leerOCrearClave(d);
    expect(k.length).toBeGreaterThanOrEqual(20);
    expect(leerOCrearClave(d)).toBe(k);
  });
});

describe('API de la grabadora', () => {
  it('sin clave no da datos; con clave da estado y filas', async () => {
    const a = new AlmacenDisco(temporal());
    a.guardar('BTCUSDT', 1, [fila(1, DIA + 1_000), fila(2, DIA + 2_000)]);
    a.vaciar();
    const srv = crearServidor({ almacen: a, clave: 'secreta', estado: () => ({ inicio: 1, version: 't', simbolos: [] }) });
    await new Promise<void>((ok) => srv.listen(0, ok));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/api/salud`)).status).toBe(200);
      expect((await fetch(`${base}/api/estado`)).status).toBe(401);
      expect((await fetch(`${base}/api/estado`, { headers: { Authorization: 'Bearer otra' } })).status).toBe(401);
      const auth = { headers: { Authorization: 'Bearer secreta' } };
      const e = (await (await fetch(`${base}/api/estado`, auth)).json()) as { almacen: { filas: number }[] };
      expect(e.almacen[0].filas).toBe(2);
      const r = (await (await fetch(`${base}/api/filas?simbolo=btcusdt&desde=${DIA + 1_000}`, auth)).json()) as { filas: { n: number }[]; mas: boolean };
      expect(r.filas.map((x) => x.n)).toEqual([2]);
      expect(r.mas).toBe(false);
      // Por market_id: el mismo mercado da sus filas; otro mercado o proveedor no da nada.
      const m = (await (await fetch(`${base}/api/filas?mercado=binance:BTCUSDT`, auth)).json()) as { filas: { mercado: string }[] };
      expect(m.filas.map((x) => x.mercado)).toEqual(['binance:BTCUSDT', 'binance:BTCUSDT']);
      expect(((await (await fetch(`${base}/api/filas?mercado=binance:XAUUSDT`, auth)).json()) as { filas: unknown[] }).filas).toEqual([]);
      expect(((await (await fetch(`${base}/api/filas?mercado=rithmic:BTCUSDT`, auth)).json()) as { filas: unknown[] }).filas).toEqual([]);
      const pre = await fetch(`${base}/api/filas`, { method: 'OPTIONS' });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization');
      expect(LIMITE_FILAS).toBe(5_000);
    } finally {
      srv.close();
    }
  });

  it('precio en vivo (/api/vivo): con clave, el último al conectar y luego cada cambio, juntado cada 100 ms', async () => {
    const vivo = crearVivo();
    const srv = crearServidor({ almacen: new AlmacenDisco(temporal()), clave: 'secreta', estado: () => ({ inicio: 1, version: 't', simbolos: [] }), vivo });
    await new Promise<void>((ok) => srv.listen(0, ok));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const corte = new AbortController();
    try {
      expect((await fetch(`${base}/api/vivo?simbolo=BTCUSDT`)).status).toBe(401);
      vivo.actualizar('BTCUSDT', { t: 1, p: 100, b: 99.9, a: 100.1 });
      const r = await fetch(`${base}/api/vivo?simbolo=BTCUSDT`, { headers: { Authorization: 'Bearer secreta' }, signal: corte.signal });
      expect(r.headers.get('content-type')).toBe('text/event-stream');
      const lector = r.body!.getReader();
      let texto = '';
      const leerHasta = async (n: number) => {
        while ((texto.match(/^data: /gm) ?? []).length < n) texto += new TextDecoder().decode((await lector.read()).value);
      };
      await leerHasta(1);
      // Varios cambios en menos de 100 ms: llega solo el último.
      vivo.actualizar('BTCUSDT', { t: 2, p: 101, b: 100.9, a: 101.1 });
      vivo.actualizar('BTCUSDT', { t: 3, p: 102, b: 101.9, a: 102.1 });
      await leerHasta(2);
      const datos = texto.match(/^data: (.*)$/gm)!.map((l) => JSON.parse(l.slice(6)) as { p: number });
      expect(datos.map((d) => d.p)).toEqual([100, 102]);
    } finally {
      corte.abort();
      vivo.detener();
      srv.close();
    }
  });
});

describe('Entrada con contraseña a la plataforma', () => {
  const WEB_ACTUAL = { dir: '' };
  async function montar() {
    const a = new AlmacenDisco(temporal());
    a.guardar('BTCUSDT', 1, [fila(1, DIA + 1_000)]);
    a.vaciar();
    const web = temporal();
    WEB_ACTUAL.dir = web;
    fs.writeFileSync(path.join(web, 'index.html'), '<html>PLATAFORMA-SECRETA</html>');
    fs.writeFileSync(path.join(web, 'app.js'), 'console.log("codigo")');
    let t = DIA;
    const srv = crearServidor({ almacen: a, clave: 'clave-larga-de-prueba', estado: () => ({ inicio: 1, version: 't', simbolos: [] }), web, reloj: () => t });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const entrar = (clave: string, extra: Record<string, string> = {}) =>
      fetch(`${base}/entrar`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams({ clave }).toString() });
    return { srv, base, entrar, avanzar: (ms: number) => (t += ms) };
  }

  it('con la versión 2 instalada, la dirección principal (y cualquier otra) lleva a /v2/', async () => {
    const { srv, base, entrar } = await montar();
    try {
      const sesion = { headers: { Cookie: (((await entrar('clave-larga-de-prueba')).headers.get('set-cookie')) ?? '').split(';')[0] }, redirect: 'manual' as const };
      // Sin v2 instalada, la raíz sigue sirviendo lo que haya.
      expect((await fetch(`${base}/`, sesion)).status).toBe(200);
      fs.mkdirSync(path.join(WEB_ACTUAL.dir, 'v2'), { recursive: true });
      fs.writeFileSync(path.join(WEB_ACTUAL.dir, 'v2', 'index.html'), '<html>V2</html>');
      for (const ruta of ['/', '/orderflow', '/app.js']) {
        const r = await fetch(`${base}${ruta}`, sesion);
        expect([r.status, r.headers.get('location')]).toEqual([302, '/v2/']);
      }
      expect(await (await fetch(`${base}/v2/`, sesion)).text()).toContain('V2');
      expect((await fetch(`${base}/api/estado`, sesion)).status).toBe(200);
    } finally {
      srv.close();
    }
  });

  it('sin sesión no se ve nada de la plataforma ni los datos; con la clave entra y la API responde sin Bearer', async () => {
    const { srv, base, entrar } = await montar();
    try {
      for (const ruta of ['/', '/app.js', '/orderflow']) {
        const r = await (await fetch(`${base}${ruta}`)).text();
        expect(r).not.toContain('PLATAFORMA-SECRETA');
        expect(r).not.toContain('codigo');
        expect(r).toContain('Escribe la clave de tu grabadora');
      }
      expect((await fetch(`${base}/api/estado`)).status).toBe(401);
      expect(await (await fetch(`${base}/api/salud`)).json()).toEqual({ ok: true, grabadora: 'athenAI', sesion: false });
      const r = await entrar('clave-larga-de-prueba');
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe('/');
      // Vuelve a la página pedida; nada de redirigir fuera de la plataforma.
      expect((await fetch(`${base}/entrar`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'clave=clave-larga-de-prueba&volver=%23%2Forderflow' })).headers.get('location')).toBe('/#/orderflow');
      expect((await fetch(`${base}/entrar`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'clave=clave-larga-de-prueba&volver=%2F%2Fmalo.com' })).headers.get('location')).toBe('/');
      const galleta = r.headers.get('set-cookie') ?? '';
      expect(galleta).toMatch(new RegExp(`^${COOKIE}=[0-9a-f]{64}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000$`));
      const sesion = { headers: { Cookie: galleta.split(';')[0] } };
      expect(await (await fetch(`${base}/`, sesion)).text()).toContain('PLATAFORMA-SECRETA');
      expect((await fetch(`${base}/api/estado`, sesion)).status).toBe(200);
      expect(await (await fetch(`${base}/api/salud`, sesion)).json()).toMatchObject({ sesion: true });
      // Salir cierra la sesión: la misma cookie ya no sirve.
      expect((await fetch(`${base}/salir`, { ...sesion, redirect: 'manual' })).status).toBe(303);
      expect(await (await fetch(`${base}/`, sesion)).text()).not.toContain('PLATAFORMA-SECRETA');
      expect((await fetch(`${base}/api/estado`, sesion)).status).toBe(401);
      // Una cookie inventada no sirve.
      expect((await fetch(`${base}/api/estado`, { headers: { Cookie: `${COOKIE}=${'a'.repeat(64)}` } })).status).toBe(401);
    } finally {
      srv.close();
    }
  });

  it('detrás de HTTPS (Caddy) la cookie lleva Secure; la sesión caduca a los 30 días', async () => {
    const { srv, base, entrar, avanzar } = await montar();
    try {
      const r = await entrar('clave-larga-de-prueba', { 'X-Forwarded-Proto': 'https' });
      const galleta = r.headers.get('set-cookie') ?? '';
      expect(galleta).toContain('; Secure');
      const sesion = { headers: { Cookie: galleta.split(';')[0] } };
      avanzar(29 * 86_400_000);
      expect((await fetch(`${base}/api/estado`, sesion)).status).toBe(200);
      avanzar(2 * 86_400_000);
      expect((await fetch(`${base}/api/estado`, sesion)).status).toBe(401);
    } finally {
      srv.close();
    }
  });

  it('fuerza bruta: tras 5 claves malas desde una IP queda bloqueada 15 min (ni la buena entra); otra IP no', async () => {
    const { srv, entrar, avanzar } = await montar();
    try {
      for (let i = 0; i < MAX_FALLOS - 1; i += 1) expect((await entrar('mala')).status).toBe(401);
      const quinto = await entrar('mala');
      expect(quinto.status).toBe(401);
      expect(await quinto.text()).toContain('Demasiados intentos');
      expect((await entrar('clave-larga-de-prueba')).status).toBe(429);
      // Detrás de Caddy, otra IP real (X-Forwarded-For) no está bloqueada.
      expect((await entrar('clave-larga-de-prueba', { 'X-Forwarded-For': '10.0.0.9' })).status).toBe(303);
      avanzar(BLOQUEO_MS + 1);
      expect((await entrar('clave-larga-de-prueba')).status).toBe(303);
      expect((await entrar('mala')).status).toBe(401); // cuenta otra vez desde cero
      expect((await entrar('clave-larga-de-prueba')).status).toBe(303);
    } finally {
      srv.close();
    }
  });
});

describe('CVD de la sesión y VWAP del día tras un reinicio', () => {
  // Sesión de Londres (07:00 UTC). Lo grabado desde las 00:00 completa el VWAP y desde las 07:00 el CVD.
  const dia = Date.UTC(2026, 9, 22);
  const londres = dia + 7 * 3_600_000;
  const grabar = (xs: FilaFeatures[], sesion = 1) => {
    const a = new AlmacenDisco(temporal());
    a.nuevaSesion('BTCUSDT', parametrosPorDefecto('BTCUSDT'), xs[0].inicio, sesion);
    a.guardar('BTCUSDT', sesion, xs);
    a.vaciar();
    return a;
  };
  const filas = (n: number, desde: number) => Array.from({ length: n }, (_, i): FilaFeatures => ({ n: i, inicio: desde + i * 60_000, cierre: desde + i * 60_000 + 59_000, open: 100, close: i < 420 ? 100 : 110, volumen: 2, delta: i % 2 ? -0.5 : 1, valores: { hueco: 0, cvd_sesion_ratio: 0.1 } }));
  const trade = (m: MotorMercado, t: number) => m.trade({ symbol: 'BTCUSDT', price: 110, quantity: 1, timestamp: t, aggTradeId: 1, buyerIsMaker: false });

  it('suma lo grabado desde el inicio y el motor lo usa en el primer trade', () => {
    // Desde las 00:00 hasta las 08:30: 510 barras (420 a 100 y 90 a 110).
    const b = baseSesion(grabar(filas(510, dia)), 'BTCUSDT', dia + 510 * 60_000 + 20_000)!;
    expect(b.cvd).toEqual({ inicioSesion: londres, delta: 45 * 1 - 45 * 0.5, volumen: 180 });
    expect(b.dia).toEqual({ inicio: dia, apertura: 100, nocional: 420 * 200 + 90 * 220, volumen: 1_020 });
    const m = new MotorMercado('BTCUSDT', 0.1);
    m.sembrar(b);
    trade(m, b.hasta + 10_000);
    expect(m.cvdCompleto).toBe(true);
    expect(m.cvdSesion).toBeCloseTo(23.5);
    expect(m.cvdVolumenSesion).toBeCloseTo(181);
    expect(m.vwapCompleto).toBe(true);
    expect(m.vwapSesion).toBeCloseTo((420 * 200 + 90 * 220 + 110) / 1_021);
    expect(m.aperturaSesion).toBe(100);
  });

  it('no inventa: si lo grabado empieza tarde, tiene un corte o el reinicio fue largo, espera', () => {
    const tarde = baseSesion(grabar(filas(60, londres + 30 * 60_000)), 'BTCUSDT', londres + 95 * 60_000)!;
    expect([tarde.cvd, tarde.dia]).toEqual([null, null]);
    // Faltó un trade a las 08:00 (el motor dejó el CVD vacío desde ahí): ni CVD ni VWAP.
    const conHueco = filas(510, dia).map((f, i) => (i >= 480 ? { ...f, valores: { hueco: i === 480 ? 1 : 0, cvd_sesion_ratio: null } } : f));
    expect(baseSesion(grabar(conHueco), 'BTCUSDT', dia + 515 * 60_000)!.cvd).toBeNull();
    // Una resincronización del libro (hueco = 1 pero el CVD siguió completo) no corta nada.
    const libro = filas(510, dia);
    libro[480].valores.hueco = 1;
    expect(baseSesion(grabar(libro), 'BTCUSDT', dia + 510 * 60_000 + 20_000)!.cvd?.volumen).toBe(180);
    const b = baseSesion(grabar(filas(510, dia)), 'BTCUSDT', dia + 515 * 60_000)!;
    const m = new MotorMercado('BTCUSDT', 0.1);
    m.sembrar(b);
    trade(m, b.hasta + 5 * 60_000);
    expect([m.cvdCompleto, m.vwapCompleto]).toEqual([false, false]);
  });

  it('varios reinicios cortos seguidos (instalar dos veces) siguen sumando; uno que no pudo seguir corta la cadena', () => {
    // Corrida 1 hasta las 07:59; corrida 2 arranca 1 s después (su primera fila marca hueco), hasta las 08:30.
    const dosCorridas = (siguio: boolean) => {
      const a = new AlmacenDisco(temporal());
      const xs = filas(510, dia);
      const otra = xs.slice(480).map((f, i) => ({ ...f, inicio: f.inicio + 1_000, cierre: f.cierre + 1_000, valores: { hueco: i === 0 ? 1 : 0, cvd_sesion_ratio: siguio ? 0.1 : null } }));
      a.nuevaSesion('BTCUSDT', parametrosPorDefecto('BTCUSDT'), dia, 1);
      a.guardar('BTCUSDT', 1, xs.slice(0, 480));
      a.nuevaSesion('BTCUSDT', parametrosPorDefecto('BTCUSDT'), otra[0].inicio, 2_000_000);
      a.guardar('BTCUSDT', 2_000_000, otra);
      a.vaciar();
      return baseSesion(a, 'BTCUSDT', otra.at(-1)!.cierre + 5_000)!;
    };
    const corta = dosCorridas(true);
    expect(corta.cvd?.volumen).toBe(180);
    expect(corta.dia?.volumen).toBe(1_020);
    const larga = dosCorridas(false);
    expect([larga.cvd, larga.dia]).toEqual([null, null]);
  });
});
