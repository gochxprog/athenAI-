// Avisos 24/7 desde el VPS (Discord, Telegram, ntfy): los bots avisan aunque la plataforma esté cerrada.
// Mismas peticiones que la plataforma (src/motores/notificaciones/canales.ts). La configuración (tokens de los
// canales) se guarda solo en el VPS, en {datos}/avisos.json con permisos 600, y nunca se devuelve por la API.
import fs from 'node:fs';
import path from 'node:path';
import { canalesActivos, CONFIG_NOTIF_POR_DEFECTO, peticion, type Aviso, type ConfigNotificaciones } from '../src/motores/notificaciones/canales';

export interface ApiAvisos {
  accion(nombre: string, cuerpo: Record<string, unknown>): Promise<unknown>;
  /** Qué canales están activos (sin credenciales). */
  estado(): { canales: string[]; tipos: ConfigNotificaciones['tipos'] };
  enviar(a: Aviso): Promise<void>;
}

const texto = (x: unknown, max = 500) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

/** Solo los campos conocidos, con su tipo: lo que llega por la API no puede meter otra cosa en el archivo. */
function limpiar(c: Record<string, unknown>): ConfigNotificaciones {
  const d = CONFIG_NOTIF_POR_DEFECTO;
  const o = (k: string) => (typeof c[k] === 'object' && c[k] ? (c[k] as Record<string, unknown>) : {});
  const [di, te, nt, ti] = [o('discord'), o('telegram'), o('ntfy'), o('tipos')];
  return {
    discord: { activo: di.activo === true, webhook: texto(di.webhook) },
    telegram: { activo: te.activo === true, token: texto(te.token, 200), chatId: texto(te.chatId, 100) },
    ntfy: { activo: nt.activo === true, servidor: texto(nt.servidor) || d.ntfy.servidor, tema: texto(nt.tema, 200) },
    tipos: Object.fromEntries(Object.keys(d.tipos).map((k) => [k, typeof ti[k] === 'boolean' ? ti[k] : d.tipos[k as keyof typeof d.tipos]])) as ConfigNotificaciones['tipos'],
    antiSpamMin: Number.isFinite(Number(c.antiSpamMin)) ? Math.max(0, Number(c.antiSpamMin)) : d.antiSpamMin,
  };
}

export function crearAvisos(o: { datos: string; log: (t: string) => void; fetchImpl?: typeof fetch }): ApiAvisos {
  const archivo = path.join(o.datos, 'avisos.json');
  const pedir = o.fetchImpl ?? fetch;
  let config: ConfigNotificaciones;
  try {
    config = limpiar(JSON.parse(fs.readFileSync(archivo, 'utf8')) as Record<string, unknown>);
  } catch {
    config = CONFIG_NOTIF_POR_DEFECTO;
  }
  /** Envía por cada canal activo; devuelve el resultado de cada uno. */
  const mandar = (a: Aviso) =>
    Promise.all(
      canalesActivos(config).map(async (canal) => {
        try {
          const { url, init } = peticion(canal, config, a);
          const r = await pedir(url, { ...init, signal: AbortSignal.timeout(10_000) });
          if (!r.ok) o.log(`Avisos · ${canal}: HTTP ${r.status}`);
          return { canal, ok: r.ok, detalle: r.ok ? 'Enviado' : `HTTP ${r.status}` };
        } catch (e) {
          o.log(`Avisos · ${canal}: ${e instanceof Error ? e.message : e}`);
          return { canal, ok: false, detalle: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  return {
    estado: () => ({ canales: canalesActivos(config), tipos: config.tipos }),
    async enviar(a) {
      if (config.tipos[a.tipo]) await mandar(a);
    },
    async accion(nombre, cuerpo) {
      if (nombre === 'guardar') {
        config = limpiar(cuerpo);
        fs.mkdirSync(o.datos, { recursive: true });
        fs.writeFileSync(archivo, JSON.stringify(config), { mode: 0o600 });
        return { ok: true, canales: canalesActivos(config) };
      }
      if (nombre === 'probar') {
        if (!canalesActivos(config).length) throw new Error('No hay canales activos en el VPS: guarda primero la configuración.');
        return { resultados: await mandar({ tipo: 'bot', clave: `prueba:${Date.now()}`, titulo: 'Prueba desde el VPS', texto: 'Los avisos de los bots salen del VPS las 24 horas, aunque la plataforma esté cerrada.', prioridad: 'normal' }) };
      }
      throw new Error(`Acción desconocida: ${nombre}`);
    },
  };
}
