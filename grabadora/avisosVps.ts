// Avisos 24/7 desde el VPS (Discord, Telegram, ntfy, WhatsApp): los bots avisan aunque la plataforma esté cerrada.
// Mismas peticiones que la plataforma (src/motores/notificaciones/canales.ts). La configuración (tokens de los
// canales) se guarda solo en el VPS, en {datos}/avisos.json con permisos 600, y nunca se devuelve por la API.
import fs from 'node:fs';
import path from 'node:path';
import { canalesActivos, chatsTelegram, conLimite, CONFIG_NOTIF_POR_DEFECTO, peticion, resultadoEnvio, type Aviso, type ConfigNotificaciones } from '../src/motores/notificaciones/canales';
import { Notificador } from '../src/motores/notificaciones/notificador';
import { EVENTOS_PREDEFINIDOS } from '../src/motores/nucleo/calendario';
import type { EstadoFeed } from '../src/motores/worker/protocolo';

export interface ApiAvisos {
  accion(nombre: string, cuerpo: Record<string, unknown>): Promise<unknown>;
  /** Qué canales están activos y la configuración con las claves TAPADAS (••••1234). */
  estado(): { canales: string[]; tipos: ConfigNotificaciones['tipos']; config: ConfigNotificaciones };
  enviar(a: Aviso): Promise<void>;
  /** Fallos de los mercados (y su recuperación) y eventos fuertes: llamar cada pocos segundos con los feeds. */
  revisar(feeds: readonly EstadoFeed[]): void;
}

const texto = (x: unknown, max = 500) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const TAPA = '••••';
/** Clave tapada: se ve que existe y sus últimos 4 caracteres, nunca entera. */
const tapar = (x: string) => (x ? `${TAPA}${x.slice(-4)}` : '');
/** Configuración para mostrar: las claves (webhook, token, tema de ntfy, apikey) van tapadas. */
export const tapada = (c: ConfigNotificaciones): ConfigNotificaciones => ({
  ...c,
  discord: { ...c.discord, webhook: tapar(c.discord.webhook) },
  telegram: { ...c.telegram, token: tapar(c.telegram.token) },
  ntfy: { ...c.ntfy, tema: tapar(c.ntfy.tema) },
  whatsapp: { ...c.whatsapp, apikey: tapar(c.whatsapp.apikey) },
});
/** Al guardar, una clave que llega tapada (sin tocar) se queda como estaba. */
const conservar = (nueva: string, vieja: string) => (nueva.startsWith(TAPA) ? vieja : nueva);

/** Solo los campos conocidos, con su tipo: lo que llega por la API no puede meter otra cosa en el archivo. */
function limpiar(c: Record<string, unknown>): ConfigNotificaciones {
  const d = CONFIG_NOTIF_POR_DEFECTO;
  const o = (k: string) => (typeof c[k] === 'object' && c[k] ? (c[k] as Record<string, unknown>) : {});
  const [di, te, nt, wa, ti] = [o('discord'), o('telegram'), o('ntfy'), o('whatsapp'), o('tipos')];
  return {
    discord: { activo: di.activo === true, webhook: texto(di.webhook) },
    telegram: { activo: te.activo === true, token: texto(te.token, 200), chatId: texto(te.chatId, 100) },
    ntfy: { activo: nt.activo === true, servidor: texto(nt.servidor) || d.ntfy.servidor, tema: texto(nt.tema, 200) },
    whatsapp: { activo: wa.activo === true, telefono: texto(wa.telefono, 30), apikey: texto(wa.apikey, 100) },
    tipos: Object.fromEntries(Object.keys(d.tipos).map((k) => [k, typeof ti[k] === 'boolean' ? ti[k] : d.tipos[k as keyof typeof d.tipos]])) as ConfigNotificaciones['tipos'],
    antiSpamMin: Number.isFinite(Number(c.antiSpamMin)) ? Math.max(0, Number(c.antiSpamMin)) : d.antiSpamMin,
  };
}

export function crearAvisos(o: { datos: string; log: (t: string) => void; fetchImpl?: typeof fetch; reloj?: () => number }): ApiAvisos {
  const archivo = path.join(o.datos, 'avisos.json');
  // Discord en fila y respetando su límite (429): una ráfaga de avisos no se pierde.
  const pedir = conLimite(o.fetchImpl ?? fetch);
  let config: ConfigNotificaciones;
  try {
    config = limpiar(JSON.parse(fs.readFileSync(archivo, 'utf8')) as Record<string, unknown>);
  } catch {
    config = CONFIG_NOTIF_POR_DEFECTO;
  }
  // El mismo notificador de la plataforma (tipos, anti-spam, gracia de 60 s en los fallos), siempre «visible».
  const n = new Notificador(pedir, null, o.reloj ?? Date.now, () => true);
  n.guardar(config);
  /** Envía por cada canal activo; devuelve el resultado de cada uno. */
  const mandar = (a: Aviso) =>
    Promise.all(
      canalesActivos(config).map(async (canal) => {
        try {
          const { url, init } = peticion(canal, config, a);
          const res = await resultadoEnvio(await pedir(url, { ...init, signal: AbortSignal.timeout(10_000) }));
          if (!res.ok) o.log(`Avisos · ${canal}: ${res.detalle}`);
          return { canal, ...res };
        } catch (e) {
          o.log(`Avisos · ${canal}: ${e instanceof Error ? e.message : e}`);
          return { canal, ok: false, detalle: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  return {
    estado: () => ({ canales: canalesActivos(config), tipos: config.tipos, config: tapada(config) }),
    async enviar(a) {
      await n.enviar(a);
    },
    revisar(feeds) {
      n.revisarFeeds(feeds);
      n.revisarCalendario(EVENTOS_PREDEFINIDOS);
    },
    async accion(nombre, cuerpo) {
      if (nombre === 'guardar') {
        const c = limpiar(cuerpo);
        config = {
          ...c,
          discord: { ...c.discord, webhook: conservar(c.discord.webhook, config.discord.webhook) },
          telegram: { ...c.telegram, token: conservar(c.telegram.token, config.telegram.token) },
          ntfy: { ...c.ntfy, tema: conservar(c.ntfy.tema, config.ntfy.tema) },
          whatsapp: { ...c.whatsapp, apikey: conservar(c.whatsapp.apikey, config.whatsapp.apikey) },
        };
        n.guardar(config);
        fs.mkdirSync(o.datos, { recursive: true });
        fs.writeFileSync(archivo, JSON.stringify(config), { mode: 0o600 });
        return { ok: true, canales: canalesActivos(config) };
      }
      if (nombre === 'chatTelegram') {
        // Con el token que ya está en el VPS (o uno nuevo sin guardar): a quién le escribió tu bot.
        const token = conservar(texto(cuerpo.token, 200), config.telegram.token);
        if (!token) throw new Error('Falta el token del bot de Telegram.');
        return { chats: await chatsTelegram(token, pedir) };
      }
      if (nombre === 'probar') {
        if (!canalesActivos(config).length) throw new Error('No hay canales activos en el VPS: guarda primero la configuración.');
        return { resultados: await mandar({ tipo: 'bot', clave: `prueba:${Date.now()}`, titulo: 'Prueba desde el VPS', texto: 'Los avisos de los bots salen del VPS las 24 horas, aunque la plataforma esté cerrada.', prioridad: 'normal' }) };
      }
      throw new Error(`Acción desconocida: ${nombre}`);
    },
  };
}
