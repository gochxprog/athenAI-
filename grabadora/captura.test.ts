import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { capturaPng } from './captura';
import { CONFIG_NOTIF_POR_DEFECTO, peticion, type Aviso } from '../src/motores/notificaciones/canales';

/** Lee el PNG de vuelta: ancho, alto y los píxeles RGB (sin el byte de filtro de cada fila). */
function leer(b: Uint8Array) {
  const buf = Buffer.from(b);
  const [ancho, alto] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  const idat: Buffer[] = [];
  for (let i = 8; i < buf.length; ) {
    const n = buf.readUInt32BE(i);
    if (buf.toString('ascii', i + 4, i + 8) === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + n));
    i += 12 + n;
  }
  const crudo = zlib.inflateSync(Buffer.concat(idat));
  const px = (x: number, y: number) => [...crudo.subarray(y * (ancho * 3 + 1) + 1 + x * 3, y * (ancho * 3 + 1) + 4 + x * 3)];
  return { ancho, alto, crudo, px };
}

describe('Captura del gráfico para los avisos', () => {
  const velas = Array.from({ length: 60 }, (_, i) => ({ open: 100 + i, high: 102 + i, low: 98 + i, close: i % 2 ? 99 + i : 101 + i }));

  it('es un PNG válido del tamaño pedido, con velas verdes y moradas y las líneas de stop y objetivo', () => {
    const img = capturaPng(velas, { lado: 1, entrada: 159, stop: 150, objetivo: 177 }, 360, 200);
    expect([...img.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const { ancho, alto, crudo, px } = leer(img);
    expect([ancho, alto]).toEqual([360, 200]);
    expect(crudo.length).toBe((360 * 3 + 1) * 200);
    const colores = new Set<string>();
    for (let y = 0; y < alto; y += 1) for (let x = 0; x < ancho; x += 1) colores.add(px(x, y).join(','));
    expect(colores.has('126,226,168')).toBe(true); // verde: velas que suben y el objetivo
    expect(colores.has('168,85,247')).toBe(true); // morado: velas que bajan
    expect(colores.has('229,132,139')).toBe(true); // rojo: el stop
    expect(colores.has('217,219,223')).toBe(true); // la entrada
  });

  it('el aviso con imagen va como foto a Telegram, adjunto a Discord y a ntfy; WhatsApp sigue en texto', () => {
    const a: Aviso = { tipo: 'bot', clave: 'x', titulo: 'Manual (tú) · BTCUSDT', texto: 'Abre largo', prioridad: 'normal', imagen: { nombre: 'captura.png', png: new Uint8Array([1, 2, 3]) } };
    const c = { ...CONFIG_NOTIF_POR_DEFECTO, telegram: { activo: true, token: 'T', chatId: '9' }, discord: { activo: true, webhook: 'https://discord.com/api/webhooks/1/x' }, ntfy: { activo: true, servidor: 'https://ntfy.sh', tema: 'tema' }, whatsapp: { activo: true, telefono: '+1', apikey: 'k' } };
    const tg = peticion('telegram', c, a);
    expect(tg.url).toMatch(/sendPhoto$/);
    expect((tg.init.body as FormData).get('photo')).toBeInstanceOf(Blob);
    const dc = peticion('discord', c, a);
    expect(String((dc.init.body as FormData).get('payload_json'))).toContain('attachment://captura.png');
    expect(peticion('ntfy', c, a).url).toContain('filename=captura.png');
    expect(peticion('whatsapp', c, a).url).toContain('callmebot');
  });
});
