import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { crearAvisos } from './avisosVps';
import type { EstadoFeed } from '../src/motores/worker/protocolo';

const carpetas: string[] = [];
const temporal = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-'));
  carpetas.push(d);
  return d;
};
afterEach(() => carpetas.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** fetch falso: guarda a dónde se mandó cada aviso. */
const espia = (ok = true) => {
  const urls: string[] = [];
  const f = (async (u: string | URL | Request) => {
    urls.push(String(u));
    return new Response('', { status: ok ? 200 : 403 });
  }) as typeof fetch;
  return { f, urls };
};

const CONFIG = {
  telegram: { activo: true, token: '123:abc', chatId: '42' },
  ntfy: { activo: true, servidor: 'https://ntfy.sh', tema: 'mi-tema' },
  discord: { activo: false, webhook: '' },
  tipos: { bot: true, juez: false },
  colado: 'no debe guardarse',
};

describe('Avisos 24/7 del VPS', () => {
  it('guarda la configuración limpia (600) y no devuelve los tokens', async () => {
    const datos = temporal();
    const a = crearAvisos({ datos, log: () => undefined, fetchImpl: espia().f });
    expect(await a.accion('guardar', CONFIG)).toEqual({ ok: true, canales: ['telegram', 'ntfy'] });
    const archivo = path.join(datos, 'avisos.json');
    expect(fs.statSync(archivo).mode & 0o777).toBe(0o600);
    const guardado = JSON.parse(fs.readFileSync(archivo, 'utf8')) as Record<string, unknown>;
    expect(guardado).not.toHaveProperty('colado');
    expect(JSON.stringify(a.estado())).not.toContain('123:abc');
    expect(a.estado().config.telegram).toMatchObject({ token: '••••:abc', chatId: '42' });
    // Guardar con la clave tapada (sin tocar) la conserva; una nueva la cambia.
    await a.accion('guardar', { ...CONFIG, telegram: { activo: true, token: '••••:abc', chatId: '43' } });
    expect((JSON.parse(fs.readFileSync(archivo, 'utf8')) as { telegram: { token: string; chatId: string } }).telegram).toEqual({ activo: true, token: '123:abc', chatId: '43' });
    // Al reiniciar la grabadora, sigue configurado.
    expect(crearAvisos({ datos, log: () => undefined }).estado().canales).toEqual(['telegram', 'ntfy']);
  });

  it('manda los avisos de los bots por cada canal activo y respeta los tipos apagados', async () => {
    const { f, urls } = espia();
    const a = crearAvisos({ datos: temporal(), log: () => undefined, fetchImpl: f });
    await a.accion('guardar', CONFIG);
    await a.enviar({ tipo: 'bot', clave: 'x', titulo: 'Bot «Ruptura» · BTCUSDT', texto: 'Cierra largo · entró 81.000 · salió 81.100 · +100 puntos', prioridad: 'normal' });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('api.telegram.org/bot123:abc/sendMessage');
    expect(urls[1]).toMatch(/^https:\/\/ntfy.sh\/mi-tema\?/);
    await a.enviar({ tipo: 'juez', clave: 'y', titulo: 'Juez', texto: '—', prioridad: 'normal' });
    expect(urls).toHaveLength(2);
  });

  it('fallos de un mercado desde el VPS: tras 60 s sin datos avisa, y avisa al volver (sin repetir)', async () => {
    const { f, urls } = espia();
    let ahora = Date.UTC(2026, 9, 22, 12);
    const a = crearAvisos({ datos: temporal(), log: () => undefined, fetchImpl: f, reloj: () => ahora });
    await a.accion('guardar', { ntfy: { activo: true, servidor: 'https://ntfy.sh', tema: 'mi-tema' } });
    const feed = (conexion: string) => ({ simbolo: 'BTCUSDT', proveedor: 'binance', conexion, detalle: '' }) as unknown as EstadoFeed;
    a.revisar([feed('reconectando')]);
    ahora += 30_000;
    a.revisar([feed('reconectando')]);
    expect(urls).toHaveLength(0); // aún en la gracia de 60 s
    ahora += 40_000;
    a.revisar([feed('reconectando')]);
    a.revisar([feed('reconectando')]);
    await new Promise((r) => setTimeout(r, 10));
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).searchParams.get('title')).toContain('sin datos');
    ahora += 5_000;
    a.revisar([feed('en-vivo')]);
    await new Promise((r) => setTimeout(r, 10));
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1]).searchParams.get('title')).toContain('recuperado');
  });

  it('la prueba dice qué canal falló; sin canales, avisa claro', async () => {
    const a = crearAvisos({ datos: temporal(), log: () => undefined, fetchImpl: espia(false).f });
    await expect(a.accion('probar', {})).rejects.toThrow(/No hay canales activos/);
    await a.accion('guardar', CONFIG);
    expect(await a.accion('probar', {})).toEqual({ resultados: [{ canal: 'telegram', ok: false, detalle: 'HTTP 403' }, { canal: 'ntfy', ok: false, detalle: 'HTTP 403' }] });
  });
});
