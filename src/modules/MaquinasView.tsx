import { useEffect, useState } from 'react';
import { Cpu, HardDrive, Server } from 'lucide-react';
import Encabezado from '@/components/ui/Encabezado';
import Panel from '@/components/ui/Panel';
import { useEstadoMotor, useFeeds } from '@/components/orderflow/OrderFlowChart';
import { num } from '@/lib/format';

const mb = (b: number) => `${num(b / 1_048_576, 0)} MB`;

/** Telemetría real del equipo donde corre la plataforma (este navegador). El VPS se añadirá cuando exista. */
export default function MaquinasView() {
  const { feeds } = useFeeds();
  const { estado, msProceso } = useEstadoMotor();
  const [espacio, setEspacio] = useState<{ usado: number; total: number } | null>(null);
  const [memoria, setMemoria] = useState<number | null>(null);
  useEffect(() => {
    const leer = () => {
      void navigator.storage?.estimate?.().then((e) => setEspacio({ usado: e.usage ?? 0, total: e.quota ?? 0 }));
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      setMemoria(m ? m.usedJSHeapSize : null);
    };
    leer();
    const id = setInterval(leer, 5_000);
    return () => clearInterval(id);
  }, []);
  const lat = feeds.feeds.map((f) => f.latenciaMs).filter((x): x is number => x !== null);
  const datos: [string, string, string][] = [
    ['Cálculo del motor', `${num(msProceso, 1)} ms`, 'cada 200 ms (5 veces por segundo)'],
    ['Latencia media de los datos', lat.length ? `${num(lat.reduce((a, b) => a + b, 0) / lat.length)} ms` : '—', 'del exchange a la plataforma'],
    ['Mercados conectados', `${feeds.feeds.filter((f) => f.conexion === 'en-vivo').length}/${feeds.feeds.length}`, 'en vivo / configurados'],
    ['Filas por escribir', num(feeds.enCola), 'cola hacia las carpetas de datos'],
    ['Trades en memoria', estado ? num(estado.memoria.cinta ?? 0) : '—', 'cinta del mercado visible'],
    ['Memoria del navegador', memoria === null ? 'no disponible' : mb(memoria), 'solo Chrome/Edge la informan'],
    ['Espacio usado (carpetas)', espacio ? `${mb(espacio.usado)} de ${mb(espacio.total)}` : '—', 'IndexedDB de este navegador'],
    ['Núcleos del procesador', num(navigator.hardwareConcurrency ?? 0), 'disponibles para los workers'],
  ];
  return (
    <div className="space-y-4">
      <Encabezado modulo="Máquinas" titulo="Estado del equipo" descripcion="Lo que mide la plataforma de la máquina donde corre ahora: tu navegador. Cuando exista el VPS 24/7, aparecerá aquí también." />
      <Panel titulo="Este navegador" icono={Cpu} cuerpo="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {datos.map(([k, v, nota]) => (
          <div key={k} className="rounded-lg border border-borde-suave p-3" data-telemetria>
            <p className="text-[10px] uppercase tracking-[0.12em] text-plata-500">{k}</p>
            <p className="cifra text-lg font-light text-white">{v}</p>
            <p className="text-[10.5px] text-plata-400">{nota}</p>
          </div>
        ))}
      </Panel>
      <Panel titulo="Procesos" icono={HardDrive} cuerpo="p-4 text-[12px] text-plata-300">
        <ul className="list-disc space-y-1 pl-4">
          <li>Motor de datos (worker): fuentes, barras, Order Flow, Features y memoria del mercado.</li>
          <li>Laboratorio (worker): Python, el Juez y el Etiquetador; se crea al probar una estrategia.</li>
          <li>Señales en vivo (worker): calcula la posición actual de tus estrategias juzgadas cada 30 s.</li>
          <li>Notificador: Discord, Telegram y ntfy, mientras la pestaña está abierta.</li>
        </ul>
      </Panel>
      <Panel titulo="VPS 24/7" icono={Server} cuerpo="p-4 text-[12px] text-plata-400">
        Aún no hay VPS conectado. Cuando exista, grabará y correrá los bots aunque tu computador esté apagado, y sus datos aparecerán aquí.
      </Panel>
    </div>
  );
}
