import { useEffect, useState } from 'react';
import { BellRing, Send } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import Insignia from '@/components/ui/Insignia';
import { notificador } from '@/motores/notificaciones/notificador';
import { canalesActivos, chatsTelegram, TIPOS_AVISO, type Canal, type ConfigNotificaciones } from '@/motores/notificaciones/canales';
import { hora } from '@/lib/format';

const NOMBRE: Record<Canal, string> = { discord: 'Discord', telegram: 'Telegram', ntfy: 'ntfy (push al teléfono)', whatsapp: 'WhatsApp (CallMeBot)' };

function useNotificador() {
  const [, setN] = useState(0);
  useEffect(() => notificador.suscribir(() => setN((x) => x + 1)), []);
  return notificador;
}

function Activo({ canal, valor, onChange }: { canal: Canal; valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-white">
      <input type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} className="accent-white" aria-label={`Activar ${NOMBRE[canal]}`} />
      {NOMBRE[canal]}
    </label>
  );
}

function Campo({ etiqueta, valor, onChange, tipo = 'text', placeholder }: { etiqueta: string; valor: string; onChange: (v: string) => void; tipo?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="etiqueta">{etiqueta}</span>
      <input type={tipo} value={valor} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-md border border-borde bg-black px-2.5 py-1.5 font-mono text-[11px] text-plata-100 outline-none placeholder:text-plata-600 focus:border-plata-400" />
    </label>
  );
}

/** Configuración de avisos: Discord, Telegram y ntfy, qué se avisa y el historial de envíos. */
export default function PanelNotificaciones() {
  const n = useNotificador();
  const [c, setC] = useState<ConfigNotificaciones>(n.config);
  const [probando, setProbando] = useState<Canal | null>(null);
  const activos = canalesActivos(n.config);
  const cambios = JSON.stringify(c) !== JSON.stringify(n.config);

  const [vps, setVps] = useState('');
  const [chats, setChats] = useState('');
  // Busca a quién le escribió tu bot (getUpdates) y pone el primer Chat ID: sin adivinar ni otras apps.
  const buscarChat = async () => {
    setChats('Buscando…');
    try {
      const xs = await chatsTelegram(c.telegram.token);
      if (!xs.length) return setChats('Tu bot aún no tiene mensajes: ábrelo en Telegram, escríbele «hola» y vuelve a buscar.');
      set({ telegram: { ...c.telegram, chatId: xs[0].id } });
      setChats(`Encontrado: ${xs.map((x) => `${x.nombre || 'chat'} (${x.id})`).join(' · ')}. Guarda y envía una prueba.`);
    } catch (e) {
      setChats(`Telegram dice: ${e instanceof Error ? e.message : e}. Revisa el token.`);
    }
  };
  const set = (x: Partial<ConfigNotificaciones>) => setC((v) => ({ ...v, ...x }));
  // Copia esta configuración a la grabadora (misma dirección) y manda una prueba: los bots del VPS avisan 24/7.
  const alVps = async () => {
    n.guardar(c);
    setVps('Enviando al VPS…');
    try {
      const pedir = async (accion: string, cuerpo: unknown) => {
        const r = await fetch(`/api/avisos/${accion}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
        const x = (await r.json().catch(() => ({}))) as { error?: string; resultados?: { canal: string; ok: boolean; detalle: string }[] };
        if (!r.ok) throw new Error(x.error ?? `HTTP ${r.status}`);
        return x;
      };
      await pedir('guardar', c);
      const { resultados = [] } = await pedir('probar', {});
      setVps(`VPS: ${resultados.map((x) => `${x.canal} ${x.ok ? '✓' : `✗ (${x.detalle})`}`).join(' · ')}`);
    } catch (e) {
      setVps(`No se pudo: ${e instanceof Error ? e.message : e}. Abre la plataforma desde la dirección de tu VPS.`);
    }
  };
  const probar = async (canal: Canal) => {
    n.guardar(c);
    setProbando(canal);
    try {
      await n.probar(canal);
    } finally {
      setProbando(null);
    }
  };

  const probarBoton = (canal: Canal) => (
    <button onClick={() => probar(canal)} disabled={probando !== null} className="flex items-center gap-1 rounded-md border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:border-plata-400 disabled:opacity-40" aria-label={`Enviar prueba a ${NOMBRE[canal]}`}>
      <Send size={10} /> {probando === canal ? 'Enviando…' : 'Enviar prueba'}
    </button>
  );

  return (
    <Panel titulo="Notificaciones" icono={BellRing} accion={<Insignia variante={activos.length ? 'solida' : 'tenue'}>{activos.length ? activos.map((x) => NOMBRE[x].split(' ')[0]).join(' · ') : 'sin canales'}</Insignia>} cuerpo="space-y-4 p-4">
      <p className="rounded-lg border border-borde-suave bg-white/[0.02] p-2.5 text-[10.5px] leading-relaxed text-plata-400">
        Avisos al teléfono de fallos, «hoy es distinto», eventos fuertes, decisiones del Juez y (cuando existan) operaciones de los bots. Mientras athenAI corra en el navegador, <span className="text-plata-200">los avisos solo salen con la pestaña abierta</span>: para avisos 24/7 hace falta el VPS (Bloque F). Las claves se guardan solo en este navegador.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-borde-suave p-3" data-canal="discord">
          <div className="flex items-center justify-between">
            <Activo canal="discord" valor={c.discord.activo} onChange={(v) => set({ discord: { ...c.discord, activo: v } })} />
            {probarBoton('discord')}
          </div>
          <Campo etiqueta="URL del webhook" valor={c.discord.webhook} placeholder="https://discord.com/api/webhooks/…" onChange={(v) => set({ discord: { ...c.discord, webhook: v } })} />
          <p className="text-[10px] text-plata-500">Discord → tu canal → Editar canal → Integraciones → Webhooks → Nuevo webhook → Copiar URL.</p>
        </div>
        <div className="space-y-2 rounded-lg border border-borde-suave p-3" data-canal="telegram">
          <div className="flex items-center justify-between">
            <Activo canal="telegram" valor={c.telegram.activo} onChange={(v) => set({ telegram: { ...c.telegram, activo: v } })} />
            {probarBoton('telegram')}
          </div>
          <Campo etiqueta="Token del bot" tipo="password" valor={c.telegram.token} placeholder="123456:ABC…" onChange={(v) => set({ telegram: { ...c.telegram, token: v } })} />
          <Campo etiqueta="Chat ID" valor={c.telegram.chatId} placeholder="123456789" onChange={(v) => set({ telegram: { ...c.telegram, chatId: v } })} />
          <button onClick={() => void buscarChat()} disabled={!c.telegram.token.trim()} className="rounded-md border border-borde px-2 py-1 text-[10.5px] text-plata-200 hover:border-plata-400 disabled:opacity-40">Buscar mi chat ID</button>
          {chats && <p className="text-[10.5px] text-plata-200" data-chats-telegram>{chats}</p>}
          <p className="text-[10px] text-plata-500">1) @BotFather → /newbot y copia el token. 2) Abre TU bot y escríbele «hola» (si no, Telegram no le deja escribirte). 3) «Buscar mi chat ID».</p>
        </div>
        <div className="space-y-2 rounded-lg border border-borde-suave p-3" data-canal="ntfy">
          <div className="flex items-center justify-between">
            <Activo canal="ntfy" valor={c.ntfy.activo} onChange={(v) => set({ ntfy: { ...c.ntfy, activo: v } })} />
            {probarBoton('ntfy')}
          </div>
          <Campo etiqueta="Tema" valor={c.ntfy.tema} placeholder="athenai-tu-nombre-7f3k" onChange={(v) => set({ ntfy: { ...c.ntfy, tema: v } })} />
          <Campo etiqueta="Servidor" valor={c.ntfy.servidor} onChange={(v) => set({ ntfy: { ...c.ntfy, servidor: v } })} />
          <p className="text-[10px] text-plata-500">Instala la app ntfy (Android / iPhone), suscríbete al mismo tema y listo. El tema es público: usa un nombre difícil de adivinar.</p>
        </div>
        <div className="space-y-2 rounded-lg border border-borde-suave p-3" data-canal="whatsapp">
          <div className="flex items-center justify-between">
            <Activo canal="whatsapp" valor={c.whatsapp.activo} onChange={(v) => set({ whatsapp: { ...c.whatsapp, activo: v } })} />
            {probarBoton('whatsapp')}
          </div>
          <Campo etiqueta="Tu número (con +código de país)" valor={c.whatsapp.telefono} placeholder="+58 412 1234567" onChange={(v) => set({ whatsapp: { ...c.whatsapp, telefono: v } })} />
          <Campo etiqueta="Apikey de CallMeBot" tipo="password" valor={c.whatsapp.apikey} placeholder="123456" onChange={(v) => set({ whatsapp: { ...c.whatsapp, apikey: v } })} />
          <p className="text-[10px] text-plata-500">
            CallMeBot es un servicio externo gratis: los avisos pasan por él. En <a className="underline" href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noreferrer">callmebot.com</a> sale su número: guárdalo en tus contactos y mándale por WhatsApp «I allow callmebot to send me messages». Te responde con tu apikey.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <p className="etiqueta">Qué avisar</p>
          {TIPOS_AVISO.map((t) => (
            <label key={t.id} className={`flex items-start gap-2 text-[11px] ${t.disponible ? 'text-plata-200' : 'text-plata-500'}`}>
              <input type="checkbox" checked={c.tipos[t.id]} disabled={!t.disponible} onChange={(e) => set({ tipos: { ...c.tipos, [t.id]: e.target.checked } })} className="mt-0.5 accent-white" />
              <span>
                <span className="text-white">{t.nombre}</span> · {t.descripcion}
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 pt-1 text-[11px] text-plata-300">
            No repetir el mismo aviso antes de
            <input type="number" min={0} value={c.antiSpamMin} onChange={(e) => set({ antiSpamMin: Math.max(0, Number(e.target.value)) })} aria-label="Minutos anti-spam" className="w-16 rounded-md border border-borde bg-black px-2 py-1 font-mono text-[11px] text-plata-100" />
            min
          </label>
          <div className="flex items-center gap-2 pt-2">
            <button onClick={() => n.guardar(c)} disabled={!cambios} className="rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black disabled:opacity-40">
              Guardar
            </button>
            {cambios && <span className="text-[10.5px] text-plata-400">Cambios sin guardar</span>}
            <button onClick={() => void alVps()} className="rounded-lg border border-borde px-3.5 py-2 text-xs text-plata-100 hover:border-plata-400" title="Los bots del VPS avisan aunque cierres la plataforma">
              Usar también en el VPS (24/7)
            </button>
          </div>
          {vps && <p className="text-[10.5px] text-plata-300" data-avisos-vps>{vps}</p>}
        </div>
        <div>
          <p className="etiqueta mb-1.5">Últimos envíos</p>
          <div className="max-h-[220px] overflow-y-auto rounded-lg border border-borde-suave" data-historial-avisos>
            {!n.historial.length && <p className="p-3 text-[11px] text-plata-500">Todavía no se ha enviado nada.</p>}
            {n.historial.map((e, i) => (
              <p key={`${e.t}-${i}`} className="border-b border-borde-suave px-2.5 py-1.5 text-[10.5px] last:border-0">
                <span className="cifra mr-1.5 text-plata-500">{hora(new Date(e.t))}</span>
                <span className={e.ok ? 'text-white' : 'text-plata-400'}>{e.ok ? '✓' : '✗'}</span> <span className="text-plata-300">{e.canal ? NOMBRE[e.canal].split(' ')[0] : '—'}</span> · <span className="text-plata-200">{e.aviso.titulo}</span>
                {!e.ok && <span className="text-plata-500"> · {e.detalle}</span>}
              </p>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
