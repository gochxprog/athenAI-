import { useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import Panel from '@/components/ui/Panel';
import Insignia from '@/components/ui/Insignia';
import { motorOrderFlow } from '@/motores/worker/motorCliente';
import type { EventoCalendario } from '@/motores/nucleo/calendario';
import { faltaPara, useCalendario } from '@/hooks/useCalendario';

const aLocal = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Calendario de eventos fuertes: ventanas de no operar y Feature `ventana_evento` para los modelos. */
export default function CalendarioEventos() {
  const { eventos, enCurso, ahora } = useCalendario();
  const [nombre, setNombre] = useState('');
  const [fecha, setFecha] = useState(aLocal(Date.now() + 86_400_000));
  const [impacto, setImpacto] = useState<EventoCalendario['impacto']>('alto');
  const [antes, setAntes] = useState(30);
  const [despues, setDespues] = useState(60);

  const agregar = () => {
    const t = new Date(fecha).getTime();
    if (!nombre.trim() || !Number.isFinite(t)) return;
    motorOrderFlow.usarCalendario([...eventos, { id: `ev-${t}-${Math.round(Math.random() * 1e6)}`, nombre: nombre.trim(), t, impacto, antesMin: antes, despuesMin: despues }]);
    setNombre('');
  };
  const quitar = (id: string) => motorOrderFlow.usarCalendario(eventos.filter((e) => e.id !== id));
  const futuros = eventos.filter((e) => e.t + e.despuesMin * 60_000 >= ahora - 86_400_000);

  return (
    <Panel
      titulo="Calendario de eventos fuertes"
      icono={CalendarClock}
      accion={enCurso ? <Insignia variante="solida">Ventana de no operar: {enCurso.nombre}</Insignia> : <span className="text-[10px] text-plata-500">ventanas de no operar</span>}
    >
      <p className="mb-3 text-[10.5px] text-plata-500">
        Durante la ventana de un evento de alto impacto las barras llevan <span className="font-mono text-plata-300">ventana_evento = 1</span>: los modelos aprenden a tratarlas aparte y el Guardián (Bloque E) no dejará operar. Las reuniones de la Fed vienen
        precargadas; confirma las fechas en federalreserve.gov y añade CPI, nóminas, etc.
      </p>
      <table className="w-full text-left text-xs" data-calendario>
        <tbody>
          {futuros.map((e) => (
            <tr key={e.id} className="border-b border-borde-suave last:border-0">
              <td className="py-1.5 text-plata-100">{e.nombre}</td>
              <td className="cifra py-1.5 text-plata-300">{new Date(e.t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td className="py-1.5 text-[10.5px] text-plata-500">{faltaPara(e.t, ahora)}</td>
              <td className="py-1.5 text-[10.5px] text-plata-400">
                {e.impacto} · −{e.antesMin}/+{e.despuesMin} min
              </td>
              <td className="py-1.5 text-right">
                <button onClick={() => quitar(e.id)} aria-label={`Quitar ${e.nombre}`} className="text-plata-500 hover:text-white">
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
          {!futuros.length && (
            <tr>
              <td className="py-3 text-center text-plata-500">Sin eventos próximos.</td>
            </tr>
          )}
        </tbody>
      </table>
      <form
        className="mt-3 grid gap-2 border-t border-borde-suave pt-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_auto_auto_auto_auto]"
        onSubmit={(ev) => {
          ev.preventDefault();
          agregar();
        }}
      >
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="CPI EE. UU." aria-label="Nombre del evento" className="rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100 outline-none focus:border-plata-400" />
        <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha y hora (hora local)" className="rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100 outline-none focus:border-plata-400" />
        <select value={impacto} onChange={(e) => setImpacto(e.target.value as EventoCalendario['impacto'])} aria-label="Impacto" className="rounded-md border border-borde bg-black px-2 py-1.5 text-[11px] text-plata-100">
          <option value="alto">alto</option>
          <option value="medio">medio</option>
        </select>
        <input type="number" min={0} value={antes} onChange={(e) => setAntes(Number(e.target.value))} aria-label="Minutos antes" title="Minutos antes" className="w-16 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
        <input type="number" min={0} value={despues} onChange={(e) => setDespues(Number(e.target.value))} aria-label="Minutos después" title="Minutos después" className="w-16 rounded-md border border-borde bg-black px-2 py-1.5 font-mono text-[11px] text-plata-100" />
        <button type="submit" className="flex items-center justify-center gap-1 rounded-md border border-borde px-2.5 py-1.5 text-[11px] text-plata-200 hover:border-plata-400">
          <Plus size={12} /> Añadir
        </button>
      </form>
    </Panel>
  );
}
