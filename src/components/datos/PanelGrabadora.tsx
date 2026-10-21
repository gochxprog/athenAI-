import { useEffect, useState } from 'react';
import { HardDrive, RefreshCw, Unplug } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import Insignia from '@/components/ui/Insignia';
import { Explicacion } from '@/components/laboratorio/graficos';
import { grabadora } from '@/motores/grabadora/cliente';
import { hora, num } from '@/lib/format';

function useGrabadora() {
  const [, setN] = useState(0);
  useEffect(() => grabadora.suscribir(() => setN((x) => x + 1)), []);
  return grabadora;
}

const fecha = (t: number | null) => (t ? new Date(t).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const ESTADO: Record<string, string> = { 'en-vivo': 'En vivo', conectando: 'Conectando', reconectando: 'Reconectando', 'sin-datos': 'Sin datos', error: 'Error', detenido: 'Detenido' };
const tamaño = (b: number) => (b >= 1e9 ? `${num(b / 1e9, 1)} GB` : `${num(b / 1e6, 1)} MB`);

/** Grabadora 24/7 en el VPS: conexión, estado y descarga de lo grabado a este navegador. */
export default function PanelGrabadora() {
  const g = useGrabadora();
  const e = g.estado;
  const [url, setUrl] = useState(e.config?.url ?? '');
  const [clave, setClave] = useState(e.config?.clave ?? '');
  const [probando, setProbando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  // Si la plataforma se abrió desde el propio VPS (la grabadora la sirve), la dirección es esta misma.
  useEffect(() => {
    if (url || typeof location === 'undefined') return;
    void fetch(`${location.origin}/api/salud`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { grabadora?: string } | null) => j?.grabadora === 'athenAI' && setUrl(location.origin))
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const conectar = async () => {
    setProbando(true);
    setMensaje(null);
    try {
      await g.probar({ url, clave });
      g.guardarConfig({ url, clave });
      await g.sincronizar();
    } catch (err) {
      setMensaje(err instanceof Error ? err.message : String(err));
    } finally {
      setProbando(false);
    }
  };

  const r = e.remoto;
  return (
    <Panel titulo="Grabadora 24/7 (VPS)" icono={HardDrive} accion={<Insignia variante={e.config ? 'solida' : 'contorno'}>{e.config ? (e.error ? 'con error' : 'conectada') : 'sin conectar'}</Insignia>} cuerpo="space-y-3 p-4">
      <Explicacion
        que="un programa en tu VPS que graba el mercado las 24 horas con los mismos motores de la plataforma, aunque tu computador esté apagado."
        sirve="tener semanas de historia continua para el Juez, el Etiquetador y la Memoria. Al abrir la plataforma se descarga sola lo nuevo (y luego cada 5 minutos)."
        mirar="que diga «En vivo» y que las filas en el VPS crezcan. Lo descargado aparece como «Grabadora 24/7 (VPS)» al elegir datos en el Laboratorio."
      />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]" data-grabadora>
        <label className="block">
          <span className="etiqueta">Dirección del VPS</span>
          <input value={url} onChange={(x) => setUrl(x.target.value)} placeholder="http://IP-de-tu-VPS:8080" aria-label="Dirección de la grabadora" className="mt-1 w-full rounded-md border border-borde bg-black px-2.5 py-1.5 font-mono text-[11px] text-plata-100 outline-none placeholder:text-plata-600 focus:border-plata-400" />
        </label>
        <label className="block">
          <span className="etiqueta">Clave (la muestra el instalador)</span>
          <input type="password" value={clave} onChange={(x) => setClave(x.target.value)} aria-label="Clave de la grabadora" autoComplete="off" className="mt-1 w-full rounded-md border border-borde bg-black px-2.5 py-1.5 font-mono text-[11px] text-plata-100 outline-none focus:border-plata-400" />
        </label>
        <div className="flex items-end gap-2">
          <button onClick={conectar} disabled={probando || !url || !clave} className="rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-black disabled:opacity-40">
            {probando ? 'Conectando…' : 'Conectar'}
          </button>
          {e.config && (
            <>
              <button onClick={() => void g.sincronizar()} disabled={e.enCurso} className="flex items-center gap-1 rounded-lg border border-borde px-3 py-2 text-xs text-plata-200 hover:text-white disabled:opacity-40">
                <RefreshCw size={12} /> {e.enCurso ? 'Descargando…' : 'Sincronizar'}
              </button>
              <button onClick={() => g.guardarConfig(null)} title="Desconectar" className="rounded-lg border border-borde px-2.5 py-2 text-plata-400 hover:text-white">
                <Unplug size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      {(mensaje || e.error) && <p className="text-xs text-white" data-error-grabadora>{mensaje ?? e.error}</p>}
      {e.config && (
        <p className="text-[11px] text-plata-400">
          Última sincronización: {e.ultima ? hora(new Date(e.ultima)) : '—'}
          {Object.keys(e.nuevas).length > 0 && ` · nuevas: ${Object.entries(e.nuevas).map(([s, n]) => `${s} ${num(n)}`).join(' · ')}`}
        </p>
      )}
      {r && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[11px]" data-grabadora-simbolos>
            <thead>
              <tr className="text-[9.5px] uppercase tracking-[0.12em] text-plata-500">
                <th className="py-1 font-normal">Activo</th>
                <th className="py-1 font-normal">Estado en el VPS</th>
                <th className="py-1 text-right font-normal">Filas grabadas</th>
                <th className="py-1 font-normal">Desde → hasta</th>
                <th className="py-1 text-right font-normal">Disco</th>
                <th className="py-1 text-right font-normal">Cortes · trades perdidos</th>
              </tr>
            </thead>
            <tbody>
              {r.almacen.map((a) => {
                const s = r.simbolos.find((x) => x.simbolo === a.simbolo);
                return (
                  <tr key={a.simbolo} className="border-t border-borde-suave">
                    <td className="py-1 font-mono text-white">{a.simbolo}</td>
                    <td className="py-1 text-plata-200">{s ? (ESTADO[s.conexion] ?? s.conexion) : 'ya no se graba'}</td>
                    <td className="cifra py-1 text-right text-white">{num(a.filas)}</td>
                    <td className="py-1 text-plata-400">{fecha(a.desde)} → {fecha(a.hasta)}</td>
                    <td className="cifra py-1 text-right text-plata-300">{tamaño(a.bytes)}</td>
                    <td className="cifra py-1 text-right text-plata-300">{s ? `${s.cortes} · ${s.tradesPerdidos}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[10.5px] text-plata-500">Grabadora {r.version} · encendida desde {fecha(r.inicio)}</p>
        </div>
      )}
      <details className="rounded-lg border border-borde-suave px-3 py-2 text-[11px] text-plata-300">
        <summary className="cursor-pointer text-plata-100">Cómo instalarla en tu VPS</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Sube el archivo <span className="font-mono">athenai-grabadora.zip</span> a tu VPS (en Windows: <span className="font-mono">scp athenai-grabadora.zip root@IP:/root/</span>).</li>
          <li>Entra al VPS y ejecuta: <span className="font-mono">cd /root && apt-get install -y unzip && unzip -o athenai-grabadora.zip -d athenai-grabadora && sudo bash athenai-grabadora/instalar.sh</span></li>
          <li>Al terminar, el instalador muestra la dirección y la clave: pégalas aquí arriba y pulsa «Conectar».</li>
          <li>Si el VPS se reinicia, la grabadora arranca sola. Para cambiar los activos: <span className="font-mono">sudo bash athenai-grabadora/instalar.sh BTCUSDT,ETHUSDT</span></li>
        </ol>
      </details>
    </Panel>
  );
}
