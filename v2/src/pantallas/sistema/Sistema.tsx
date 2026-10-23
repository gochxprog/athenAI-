// Sistema (v2): los avisos 24/7 se configuran DIRECTO en el VPS (Discord, Telegram, WhatsApp, ntfy). Las claves
// viven solo allí: aquí llegan tapadas (••••1234) y, si no las tocas, al guardar se quedan como estaban.
import { useEffect, useState, type ReactNode } from 'react';
import { BellRing, LogOut, Search, Send, Server } from 'lucide-react';
import { TIPOS_AVISO, type Canal, type ConfigNotificaciones } from '@/motores/notificaciones/canales';
import { pedir } from '../../api';
import { useVps } from '../../vps';
import '../laboratorio/lab.css';
import './sistema.css';

type Estado = { canales: Canal[]; config: ConfigNotificaciones };

function Campo({ et, valor, cambiar, tipo = 'text', pista }: { et: string; valor: string; cambiar: (v: string) => void; tipo?: string; pista?: string }) {
  return (
    <label className="campo-sis">
      <span className="et">{et}</span>
      <input type={tipo} value={valor} placeholder={pista} autoComplete="off" onChange={(e) => cambiar(e.target.value)} />
    </label>
  );
}

function Canal({ nombre, activo, cambiar, children }: { nombre: string; activo: boolean; cambiar: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className={`caja canal-sis ${activo ? 'on' : ''}`}>
      <label className="interruptor"><input type="checkbox" checked={activo} onChange={(e) => cambiar(e.target.checked)} /><i /><b>{nombre}</b></label>
      {children}
    </div>
  );
}

export default function Sistema() {
  const v = useVps();
  const [c, setC] = useState<ConfigNotificaciones | null>(null);
  const [activos, setActivos] = useState<Canal[]>([]);
  const [msg, setMsg] = useState('');
  const cargar = () => pedir<Estado>('/api/avisos').then((x) => (setC(x.config), setActivos(x.canales)), (e: Error) => setMsg(e.message));
  useEffect(() => void cargar(), []);
  const set = <K extends keyof ConfigNotificaciones>(k: K, x: Partial<ConfigNotificaciones[K]>) => setC((p) => p && { ...p, [k]: typeof p[k] === 'object' ? { ...(p[k] as object), ...x } : x });
  const accion = async (nombre: string, cuerpo: object, ok: (x: never) => string) => {
    setMsg('…');
    try {
      setMsg(ok((await pedir(`/api/avisos/${nombre}`, cuerpo)) as never));
    } catch (e) {
      setMsg(`No se pudo: ${(e as Error).message}`);
    }
  };
  const guardar = () => accion('guardar', c!, (x: { canales: Canal[] }) => (setActivos(x.canales), void cargar(), `Guardado en el VPS. Activos: ${x.canales.join(', ') || 'ninguno'}.`));
  const probar = () => accion('probar', {}, (x: { resultados: { canal: string; ok: boolean; detalle: string }[] }) => x.resultados.map((r) => `${r.canal} ${r.ok ? '✓' : `✗ ${r.detalle}`}`).join(' · '));
  const buscarChat = () =>
    accion('chatTelegram', { token: c!.telegram.token }, (x: { chats: { id: string; nombre: string }[] }) => {
      if (!x.chats.length) return 'Tu bot aún no tiene mensajes: ábrelo en Telegram, escríbele «hola» y busca otra vez.';
      set('telegram', { chatId: x.chats[0].id });
      return `Encontrado: ${x.chats.map((h) => `${h.nombre || 'chat'} (${h.id})`).join(' · ')}. Ahora «Guardar en el VPS».`;
    });
  const horas = v.inicio ? (Date.now() - v.inicio) / 3_600_000 : 0;

  return (
    <div className="sis">
      <div>
        <div className="et">Sistema</div>
        <h1>{activos.length ? `Avisos: ${activos.join(', ')}` : 'Avisos apagados'}</h1>
      </div>

      <section className="caja bloque-sis">
        <span className="et"><BellRing size={12} /> Avisos</span>
        {c ? (
          <>
            <div className="canales-sis">
              <Canal nombre="Telegram" activo={c.telegram.activo} cambiar={(a) => set('telegram', { activo: a })}>
                <Campo et="Token del bot" tipo="password" valor={c.telegram.token} cambiar={(x) => set('telegram', { token: x })} pista="123456:ABC…" />
                <Campo et="Chat ID" valor={c.telegram.chatId} cambiar={(x) => set('telegram', { chatId: x })} pista="123456789" />
                <button className="boton" onClick={() => void buscarChat()} disabled={!c.telegram.token}><Search size={12} /> Buscar mi chat ID</button>
              </Canal>
              <Canal nombre="Discord" activo={c.discord.activo} cambiar={(a) => set('discord', { activo: a })}>
                <Campo et="URL del webhook" tipo="password" valor={c.discord.webhook} cambiar={(x) => set('discord', { webhook: x })} pista="https://discord.com/api/webhooks/…" />
              </Canal>
              <Canal nombre="WhatsApp (CallMeBot)" activo={c.whatsapp.activo} cambiar={(a) => set('whatsapp', { activo: a })}>
                <Campo et="Tu número (+código de país)" valor={c.whatsapp.telefono} cambiar={(x) => set('whatsapp', { telefono: x })} pista="+58 412 1234567" />
                <Campo et="Apikey" tipo="password" valor={c.whatsapp.apikey} cambiar={(x) => set('whatsapp', { apikey: x })} pista="123456" />
              </Canal>
              <Canal nombre="ntfy (push)" activo={c.ntfy.activo} cambiar={(a) => set('ntfy', { activo: a })}>
                <Campo et="Tema" tipo="password" valor={c.ntfy.tema} cambiar={(x) => set('ntfy', { tema: x })} pista="athenai-tu-nombre-7f3k" />
              </Canal>
            </div>
            <div className="tipos-sis">
              <span className="et">Qué avisar</span>
              {TIPOS_AVISO.map((t) => (
                <label key={t.id}><input type="checkbox" checked={c.tipos[t.id]} onChange={(e) => setC({ ...c, tipos: { ...c.tipos, [t.id]: e.target.checked } })} /> <b>{t.nombre}</b> · {t.descripcion}</label>
              ))}
            </div>
            <div className="acciones-sis">
              <button className="boton principal" onClick={() => void guardar()}>Guardar en el VPS</button>
              <button className="boton" onClick={() => void probar()} disabled={!activos.length}><Send size={12} /> Enviar prueba</button>
              {msg && <span className="mono msg-sis">{msg}</span>}
            </div>
          </>
        ) : (
          <p className="vacio">{msg || 'Cargando…'}</p>
        )}
      </section>

      <section className="caja bloque-sis">
        <span className="et"><Server size={12} /> Grabadora</span>
        <div className="linea-sis"><b>Versión</b><span className="mono">{v.version || '—'}</span></div>
        <div className="linea-sis"><b>Encendida</b><span className="mono">{v.inicio ? `${horas < 48 ? `${Math.floor(horas)} h` : `${Math.floor(horas / 24)} días`} · desde ${new Date(v.inicio).toLocaleString('es-ES')}` : '—'}</span></div>
        <div className="linea-sis"><b>Bots</b><span className="mono">{v.bots.length} · apagado de emergencia {v.apagado ? 'ACTIVO' : 'no'}</span></div>
        <a className="boton salir" href="/salir"><LogOut size={12} /> Salir de esta sesión</a>
      </section>
    </div>
  );
}
