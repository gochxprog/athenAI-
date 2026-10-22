import { describe, expect, it } from 'vitest';
import { canalesActivos, chatsTelegram, CONFIG_NOTIF_POR_DEFECTO, peticion, resultadoEnvio, type Aviso } from './canales';

const aviso: Aviso = { tipo: 'bot', clave: 'x', titulo: 'Bot «Ruptura» · BTCUSDT', texto: 'Cierra largo · +100 puntos', prioridad: 'normal' };
const conWa = { ...CONFIG_NOTIF_POR_DEFECTO, whatsapp: { activo: true, telefono: '+58 412-123 4567', apikey: ' 987654 ' } };

describe('Canales: WhatsApp, errores claros y chat de Telegram', () => {
  it('WhatsApp por CallMeBot: número limpio, apikey y texto; cuenta como canal activo', () => {
    const { url } = peticion('whatsapp', conWa, aviso);
    const q = new URL(url).searchParams;
    expect(url).toMatch(/^https:\/\/api\.callmebot\.com\/whatsapp\.php\?/);
    expect(q.get('phone')).toBe('+584121234567');
    expect(q.get('apikey')).toBe('987654');
    expect(q.get('text')).toContain('+100 puntos');
    expect(canalesActivos(conWa)).toEqual(['whatsapp']);
  });

  it('el error dice el motivo real del servicio (y qué hacer si Telegram no encuentra el chat)', async () => {
    const r = new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 });
    const x = await resultadoEnvio(r);
    expect(x.ok).toBe(false);
    expect(x.detalle).toContain('chat not found');
    expect(x.detalle).toContain('Buscar mi chat ID');
    expect(await resultadoEnvio(new Response('', { status: 200 }))).toEqual({ ok: true, detalle: 'Enviado' });
  });

  it('busca los chats que le escribieron al bot (getUpdates)', async () => {
    const respuesta = { ok: true, result: [{ message: { chat: { id: 111, first_name: 'Ana' } } }, { message: { chat: { id: 111, first_name: 'Ana' } } }, { message: { chat: { id: -222, title: 'Grupo' } } }] };
    const pedir = (async () => new Response(JSON.stringify(respuesta))) as typeof fetch;
    expect(await chatsTelegram('t', pedir)).toEqual([{ id: '111', nombre: 'Ana' }, { id: '-222', nombre: 'Grupo' }]);
    const mal = (async () => new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 })) as typeof fetch;
    await expect(chatsTelegram('t', mal)).rejects.toThrow('Unauthorized');
  });
});
