// Canales de notificación: Discord (webhook), Telegram (bot), ntfy (push al teléfono) y WhatsApp (CallMeBot,
// un servicio externo gratuito). Los cuatro aceptan peticiones desde el navegador y desde el VPS. Las credenciales se guardan solo en este navegador.

export type TipoAviso = 'fallo' | 'riesgo' | 'regimen' | 'evento' | 'juez' | 'bot';

export const TIPOS_AVISO: { id: TipoAviso; nombre: string; descripcion: string; disponible: boolean }[] = [
  { id: 'fallo', nombre: 'Fallos', descripcion: 'Un mercado se desconecta, deja de recibir datos o el motor da error (y cuando se recupera).', disponible: true },
  { id: 'riesgo', nombre: '"Hoy es distinto"', descripcion: 'La data de ahora no se parece a nada de lo grabado.', disponible: true },
  { id: 'evento', nombre: 'Eventos fuertes', descripcion: '30 min antes y al entrar en la ventana de no operar (FOMC, CPI…).', disponible: true },
  { id: 'regimen', nombre: 'Cambio de régimen', descripcion: 'Rango, tendencia o día raro en cada mercado.', disponible: true },
  { id: 'juez', nombre: 'Decisiones del Juez', descripcion: 'Cada veredicto: aprobada, rechazada (y por qué) o datos insuficientes.', disponible: true },
  { id: 'bot', nombre: 'Bots', descripcion: 'Aperturas y cierres de los bots de Paper, pausas del Guardián y apagado de emergencia.', disponible: true },
];

export interface ConfigNotificaciones {
  discord: { activo: boolean; webhook: string };
  telegram: { activo: boolean; token: string; chatId: string };
  ntfy: { activo: boolean; servidor: string; tema: string };
  /** WhatsApp por CallMeBot: tu número (con +código de país) y la apikey que te manda CallMeBot. */
  whatsapp: { activo: boolean; telefono: string; apikey: string };
  tipos: Record<TipoAviso, boolean>;
  /** No repetir el mismo aviso antes de estos minutos. */
  antiSpamMin: number;
}

export const CONFIG_NOTIF_POR_DEFECTO: ConfigNotificaciones = {
  discord: { activo: false, webhook: '' },
  telegram: { activo: false, token: '', chatId: '' },
  ntfy: { activo: false, servidor: 'https://ntfy.sh', tema: '' },
  whatsapp: { activo: false, telefono: '', apikey: '' },
  tipos: { fallo: true, riesgo: true, evento: true, regimen: false, juez: true, bot: true },
  antiSpamMin: 10,
};

export interface Aviso {
  tipo: TipoAviso;
  /** Clave para el anti-spam (el mismo aviso con la misma clave no se repite). */
  clave: string;
  titulo: string;
  texto: string;
  /** Prioridad: alta (fallos, riesgo) suena en el teléfono. */
  prioridad: 'alta' | 'normal';
}

export type Canal = 'discord' | 'telegram' | 'ntfy' | 'whatsapp';

const ICONO: Record<TipoAviso, string> = { fallo: '⚠️', riesgo: '🚨', regimen: '🧭', evento: '📅', juez: '⚖️', bot: '🤖' };

/**
 * Construye la petición HTTP de cada canal (función pura, probada).
 * Todas son peticiones "simples" para el navegador (formulario o texto, sin cabeceras propias): no necesitan
 * permiso previo (CORS preflight) y funcionan desde la app.
 */
export function peticion(canal: Canal, c: ConfigNotificaciones, a: Aviso): { url: string; init: RequestInit } {
  switch (canal) {
    case 'discord': {
      const form = new FormData();
      form.append(
        'payload_json',
        JSON.stringify({
          username: 'athenAI',
          embeds: [{ title: `${ICONO[a.tipo]} ${a.titulo}`.slice(0, 256), description: a.texto.slice(0, 4000), color: a.prioridad === 'alta' ? 0xffffff : 0x8e929a, timestamp: new Date().toISOString() }],
        }),
      );
      return { url: c.discord.webhook.trim(), init: { method: 'POST', body: form } };
    }
    case 'telegram':
      return {
        url: `https://api.telegram.org/bot${c.telegram.token.trim()}/sendMessage`,
        init: {
          method: 'POST',
          body: new URLSearchParams({ chat_id: c.telegram.chatId.trim(), text: `${ICONO[a.tipo]} ${a.titulo}\n\n${a.texto}`.slice(0, 4000), disable_notification: String(a.prioridad !== 'alta') }),
        },
      };
    case 'ntfy': {
      const base = `${(c.ntfy.servidor.trim() || 'https://ntfy.sh').replace(/\/+$/, '')}/${encodeURIComponent(c.ntfy.tema.trim())}`;
      const q = new URLSearchParams({ title: `athenAI · ${a.titulo}`, priority: a.prioridad === 'alta' ? 'high' : 'default', tags: a.tipo });
      return { url: `${base}?${q}`, init: { method: 'POST', body: a.texto } };
    }
    case 'whatsapp':
      return whatsapp(c, `${ICONO[a.tipo]} *${a.titulo}*\n${a.texto}`);
  }
}

/**
 * WhatsApp por CallMeBot (GET). Desde el navegador va «no-cors»: CallMeBot no deja leer su respuesta, así que el
 * envío sale pero sin confirmación (en el VPS sí se lee).
 */
function whatsapp(c: ConfigNotificaciones, texto: string): { url: string; init: RequestInit } {
  const q = new URLSearchParams({ phone: c.whatsapp.telefono.replace(/[^\d+]/g, ''), text: texto.slice(0, 1500), apikey: c.whatsapp.apikey.trim() });
  return { url: `https://api.callmebot.com/whatsapp.php?${q}`, init: typeof window === 'undefined' ? {} : { mode: 'no-cors' } };
}

/** Resultado legible de un envío: el motivo real que da el servicio (p. ej. Telegram «chat not found»). */
export async function resultadoEnvio(r: Response): Promise<{ ok: boolean; detalle: string }> {
  if (r.type === 'opaque') return { ok: true, detalle: 'Enviado (sin confirmación del servicio)' };
  if (r.ok) return { ok: true, detalle: 'Enviado' };
  const cuerpo = await Promise.resolve()
    .then(() => r.text())
    .catch(() => '');
  let motivo = cuerpo.slice(0, 160);
  try {
    motivo = (JSON.parse(cuerpo) as { description?: string; message?: string }).description ?? (JSON.parse(cuerpo) as { message?: string }).message ?? motivo;
  } catch {
    // no era JSON: va el texto tal cual
  }
  return { ok: false, detalle: `HTTP ${r.status}${motivo ? ` · ${motivo}` : ''}${/chat not found/i.test(motivo) ? ' → escríbele primero a tu bot y usa «Buscar mi chat ID»' : ''}` };
}

/** Chats que le escribieron a tu bot de Telegram (getUpdates): así se encuentra el Chat ID sin adivinar. */
export async function chatsTelegram(token: string, pedir: typeof fetch = fetch): Promise<{ id: string; nombre: string }[]> {
  const r = await pedir(`https://api.telegram.org/bot${token.trim()}/getUpdates`);
  const x = (await r.json()) as { ok: boolean; description?: string; result?: { message?: { chat: { id: number; first_name?: string; title?: string; username?: string } } }[] };
  if (!x.ok) throw new Error(x.description ?? `HTTP ${r.status}`);
  const chats = new Map<string, string>();
  for (const u of x.result ?? []) if (u.message) chats.set(String(u.message.chat.id), u.message.chat.title ?? u.message.chat.first_name ?? u.message.chat.username ?? '');
  return [...chats].map(([id, nombre]) => ({ id, nombre }));
}

/** Canales configurados y activos. */
export function canalesActivos(c: ConfigNotificaciones): Canal[] {
  const out: Canal[] = [];
  if (c.discord.activo && /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(c.discord.webhook.trim())) out.push('discord');
  if (c.telegram.activo && c.telegram.token.trim() && c.telegram.chatId.trim()) out.push('telegram');
  if (c.ntfy.activo && c.ntfy.tema.trim()) out.push('ntfy');
  if (c.whatsapp?.activo && c.whatsapp.telefono.trim() && c.whatsapp.apikey.trim()) out.push('whatsapp');
  return out;
}

/** Petición para enviar un archivo (papers): adjunto en Discord y Telegram, enlace descargable en ntfy. */
export function peticionArchivo(canal: Canal, c: ConfigNotificaciones, nombre: string, contenido: string, texto: string): { url: string; init: RequestInit } {
  // Sin tipo: el navegador no añade cabeceras especiales y la petición sigue siendo "simple".
  const archivo = new Blob([contenido]);
  switch (canal) {
    case 'discord': {
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ username: 'athenAI', content: texto.slice(0, 1900) }));
      form.append('files[0]', archivo, nombre);
      return { url: c.discord.webhook.trim(), init: { method: 'POST', body: form } };
    }
    case 'telegram': {
      const form = new FormData();
      form.append('chat_id', c.telegram.chatId.trim());
      form.append('caption', texto.slice(0, 1000));
      form.append('document', archivo, nombre);
      return { url: `https://api.telegram.org/bot${c.telegram.token.trim()}/sendDocument`, init: { method: 'POST', body: form } };
    }
    case 'ntfy': {
      const base = `${(c.ntfy.servidor.trim() || 'https://ntfy.sh').replace(/\/+$/, '')}/${encodeURIComponent(c.ntfy.tema.trim())}`;
      const q = new URLSearchParams({ filename: nombre, title: 'athenAI · paper', message: texto.slice(0, 900) });
      return { url: `${base}?${q}`, init: { method: 'POST', body: archivo } };
    }
    case 'whatsapp':
      // CallMeBot solo manda texto: el aviso y que el archivo está en la plataforma.
      return whatsapp(c, `📄 *Paper: ${nombre}*\n${texto}\n(el archivo está en la plataforma)`);
  }
}
