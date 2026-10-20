import { describe, expect, it, vi } from 'vitest';
import { Notificador, GRACIA_FALLO_MS } from './notificador';
import { CONFIG_NOTIF_POR_DEFECTO, peticion } from './canales';
import type { EstadoFeed } from '../worker/protocolo';

function montar() {
  let ahora = 1_000_000;
  const envios: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    envios.push({ url, init });
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;
  const n = new Notificador(fetchImpl, null, () => ahora);
  n.guardar({
    ...CONFIG_NOTIF_POR_DEFECTO,
    discord: { activo: true, webhook: 'https://discord.com/api/webhooks/1/abc' },
    telegram: { activo: true, token: '123:ABC', chatId: '42' },
    ntfy: { activo: true, servidor: 'https://ntfy.sh', tema: 'athenai-prueba' },
  });
  return { n, envios, avanzar: (ms: number) => (ahora += ms) };
}

const feed = (conexion: EstadoFeed['conexion'], extra: Partial<EstadoFeed> = {}) => ({ simbolo: 'BTCUSDT', proveedor: 'binance', conexion, detalle: 'Sin mensajes', memoria: null, ...extra }) as unknown as EstadoFeed;
const esperar = () => new Promise((ok) => setTimeout(ok, 0));

describe('Notificaciones', () => {
  it('arma peticiones simples para Discord, Telegram y ntfy', () => {
    const c = { ...CONFIG_NOTIF_POR_DEFECTO, discord: { activo: true, webhook: 'https://discord.com/api/webhooks/1/abc' }, telegram: { activo: true, token: 'T', chatId: '9' }, ntfy: { activo: true, servidor: 'https://ntfy.sh/', tema: 'mi tema' } };
    const a = { tipo: 'juez' as const, clave: 'x', titulo: 'Juez: «A» APROBADA', texto: 'BTCUSDT · ok', prioridad: 'alta' as const };
    const d = peticion('discord', c, a);
    expect(d.url).toBe('https://discord.com/api/webhooks/1/abc');
    expect(JSON.parse((d.init.body as FormData).get('payload_json') as string).embeds[0].title).toContain('APROBADA');
    const t = peticion('telegram', c, a);
    expect(t.url).toBe('https://api.telegram.org/botT/sendMessage');
    expect((t.init.body as URLSearchParams).get('chat_id')).toBe('9');
    const y = peticion('ntfy', c, a);
    expect(y.url).toMatch(/^https:\/\/ntfy\.sh\/mi%20tema\?title=athenAI/);
    expect(y.url).toContain('priority=high');
    expect(y.init.headers).toBeUndefined();
  });

  it('avisa de un fallo solo si dura más de la gracia, y de la recuperación', async () => {
    const { n, envios, avanzar } = montar();
    n.revisarFeeds([feed('reconectando')]);
    avanzar(GRACIA_FALLO_MS - 1);
    n.revisarFeeds([feed('reconectando')]);
    await esperar();
    expect(envios).toHaveLength(0);
    avanzar(2);
    n.revisarFeeds([feed('reconectando')]);
    await esperar();
    expect(envios).toHaveLength(3); // un envío por canal
    avanzar(5_000);
    n.revisarFeeds([feed('en-vivo')]);
    await esperar();
    expect(envios).toHaveLength(6);
    // Microcorte (< gracia): no avisa.
    n.revisarFeeds([feed('reconectando')]);
    avanzar(10_000);
    n.revisarFeeds([feed('en-vivo')]);
    await esperar();
    expect(envios).toHaveLength(6);
  });

  it('con la pestaña oculta no avisa de caídas; al volver, un solo resumen', async () => {
    let ahora = 1_000_000;
    let visible = true;
    const envios: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      envios.push(url);
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    const n = new Notificador(fetchImpl, null, () => ahora, () => visible);
    n.guardar({ ...CONFIG_NOTIF_POR_DEFECTO, ntfy: { activo: true, servidor: 'https://ntfy.sh', tema: 't' } });
    visible = false;
    for (let i = 0; i < 20; i++) {
      ahora += 60_000;
      n.revisarFeeds([feed('reconectando')]);
    }
    await esperar();
    expect(envios).toHaveLength(0);
    visible = true;
    n.revisarFeeds([feed('reconectando')]);
    await esperar();
    expect(envios).toHaveLength(1);
    expect(decodeURIComponent(envios[0])).toContain('pausa');
    // Se recupera dentro de la gracia: ningún aviso más.
    ahora += 20_000;
    n.revisarFeeds([feed('en-vivo')]);
    await esperar();
    expect(envios).toHaveLength(1);
  });

  it('el aviso de recuperado no se repite en cada microcaída', async () => {
    const { n, envios, avanzar } = montar();
    for (let i = 0; i < 3; i++) {
      n.revisarFeeds([feed('reconectando')]);
      avanzar(GRACIA_FALLO_MS + 1);
      n.revisarFeeds([feed('reconectando')]);
      avanzar(1_000);
      n.revisarFeeds([feed('en-vivo')]);
      await esperar();
    }
    expect(envios).toHaveLength(6); // un fallo y un recuperado (× 3 canales); el resto los frena el anti-spam
  });

  it('respeta el anti-spam y los tipos desactivados', async () => {
    const { n, envios, avanzar } = montar();
    const a = { tipo: 'riesgo' as const, clave: 'distinto:BTC', titulo: 'x', texto: 'y', prioridad: 'alta' as const };
    await n.enviar(a);
    await n.enviar(a);
    expect(envios).toHaveLength(3);
    avanzar(11 * 60_000);
    await n.enviar(a);
    expect(envios).toHaveLength(6);
    n.guardar({ ...n.config, tipos: { ...n.config.tipos, riesgo: false } });
    avanzar(11 * 60_000);
    await n.enviar(a);
    expect(envios).toHaveLength(6);
  });

  it('avisa 30 min antes de un evento fuerte y al entrar en su ventana, una sola vez', async () => {
    const { n, envios, avanzar } = montar();
    const ev = [{ id: 'fomc', nombre: 'FOMC', t: 1_000_000 + 40 * 60_000, impacto: 'alto' as const, antesMin: 5, despuesMin: 60 }];
    avanzar(10 * 60_000);
    n.revisarCalendario(ev);
    n.revisarCalendario(ev);
    await esperar();
    expect(envios).toHaveLength(3);
    avanzar(26 * 60_000);
    n.revisarCalendario(ev);
    n.revisarCalendario(ev);
    await esperar();
    expect(envios).toHaveLength(6);
  });

  it('registra el fallo de un canal sin romper los demás', async () => {
    const n = new Notificador(vi.fn(async (url: string) => (url.includes('telegram') ? Promise.reject(new Error('Failed to fetch')) : ({ ok: url.includes('ntfy'), status: 404 } as Response))) as unknown as typeof fetch, null);
    n.guardar({ ...CONFIG_NOTIF_POR_DEFECTO, discord: { activo: true, webhook: 'https://discord.com/api/webhooks/1/a' }, telegram: { activo: true, token: 'T', chatId: '1' }, ntfy: { activo: true, servidor: '', tema: 't' } });
    const r = await n.probar('telegram');
    expect(r[0]).toMatchObject({ canal: 'telegram', ok: false, detalle: 'Failed to fetch' });
    const d = await n.probar('discord');
    expect(d[0]).toMatchObject({ ok: false, detalle: 'HTTP 404' });
    expect((await n.probar('ntfy'))[0].ok).toBe(true);
  });
});
