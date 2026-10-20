import { useEffect, useState } from 'react';
import { BellRing, Send } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import Insignia from '@/components/ui/Insignia';
import { notificador } from '@/motores/notificaciones/notificador';
import { canalesActivos, TIPOS_AVISO, type Canal, type ConfigNotificaciones } from '@/motores/notificaciones/canales';
import { hora } from '@/lib/format';

const NOMBRE: Record<Canal, string> = { discord: 'Discord', telegram: 'Telegram', ntfy: 'ntfy (push al teléfono)' };

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

  const set = (x: Partial<ConfigNotificaciones>) => setC((v) => ({ ...v, ...x }));
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

      <div className="grid gap-4 xl:grid-cols-3">
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
          <p className="text-[10px] text-plata-500">Habla con @BotFather → /newbot y copia el token. Escribe algo a tu bot y saca tu Chat ID con @userinfobot.</p>
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
          </div>
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
